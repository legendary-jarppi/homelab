"""The ASIAIR's image storage over SMB (Samba on the ASIAIR, guest login, read only here).

Shares: `EMMC Images` (internal storage; folders at the share root) and `Udisk Images` (a USB disk;
folders under `ASIAIR\\`). Inside each: `Autorun|Plan|Live\\Light\\<target>\\Light_<target>_….fit`
(plus a 200 px `_thn.jpg` per frame) and `log\\Autorun_Log_<date>_<time>.txt`.

Frame names, two layouts seen (camera angle before or after the time):
    Light_NGC 1499_30deg_180.0s_Bin1_20260213-195809_0001.fit
    Light_M 31_180.0s_Bin1_20260903-021110_93deg_0001.fit
The time is when the ASIAIR saved the frame, on its local clock.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

import smbclient
from smbprotocol.exceptions import SMBOSError

MODES = ("Autorun", "Plan", "Live")
FRAME = re.compile(
    r"^Light_(?P<target>.+?)_(?:-?\d+deg_)?(?P<exp>[\d.]+)(?P<unit>m?s)_Bin(?P<bin>\d+)_"
    r"(?P<ts>\d{8}-\d{6})(?:_-?\d+deg)?_(?P<n>\d+)\.fit$"
)
LOG = re.compile(r"^Autorun_Log_(\d{4}-\d{2}-\d{2}_\d{6})\.txt$")
# Guest sessions cannot sign or encrypt; the traffic stays inside the site-to-site VPN.
SMB = {"require_signing": False, "encrypt": False}


@dataclass(frozen=True)
class FrameFile:
    path: str
    root: str
    mode: str
    target: str
    number: int
    exposure_s: float
    saved_at: float
    size: int
    mtime: float


@dataclass(frozen=True)
class LogFile:
    path: str
    size: int
    started: str


class Asiair:
    def __init__(self, host: str, roots: list[tuple[str, str]], tz: ZoneInfo, timeout_s: int = 30):
        self.host = host
        self.roots = roots
        self.tz = tz
        self.timeout_s = timeout_s
        # The guest login with an empty password is accepted only as client-wide defaults: an empty
        # per-call password counts as "none given".
        smbclient.ClientConfig(username="guest", password="", require_secure_negotiate=False)
        logging.getLogger("smbprotocol").setLevel(logging.WARNING)
        logging.getLogger("spnego").setLevel(logging.WARNING)

    def _unc(self, share: str, *parts: str) -> str:
        return "\\".join([f"\\\\{self.host}", share, *[p for p in parts if p]])

    def _entries(self, path: str):
        try:
            return list(smbclient.scandir(path, connection_timeout=self.timeout_s, **SMB))
        except SMBOSError as e:
            if e.errno == 2:  # missing folder (no Live frames yet, no USB disk, …)
                return []
            raise

    def frames(self) -> list[FrameFile]:
        """Every light frame on every root."""
        found: list[FrameFile] = []
        for share, root in self.roots:
            for mode in MODES:
                for target_dir in self._entries(self._unc(share, root, mode, "Light")):
                    if not target_dir.is_dir():
                        continue
                    for entry in self._entries(target_dir.path):
                        m = FRAME.match(entry.name)
                        if not m or not entry.is_file():
                            continue
                        # Size and time from the directory listing itself: stat() costs a round
                        # trip per file over the VPN.
                        info = entry.smb_info
                        exposure = float(m["exp"]) / (1000 if m["unit"] == "ms" else 1)
                        saved = datetime.strptime(m["ts"], "%Y%m%d-%H%M%S").replace(tzinfo=self.tz).timestamp()
                        found.append(
                            FrameFile(entry.path, f"{share}\\{root}".rstrip("\\"), mode, target_dir.name,
                                      int(m["n"]), exposure, saved, info.end_of_file, info.last_write_time.timestamp())
                        )
        return found

    def newest_log(self) -> LogFile | None:
        logs: list[LogFile] = []
        for share, root in self.roots:
            for entry in self._entries(self._unc(share, root, "log")):
                if m := LOG.match(entry.name):
                    logs.append(LogFile(entry.path, entry.smb_info.end_of_file, m[1]))
        return max(logs, key=lambda l: l.started, default=None)

    def read(self, path: str) -> bytes:
        with smbclient.open_file(path, mode="rb", connection_timeout=self.timeout_s, **SMB) as f:
            return f.read()

    def reset(self) -> None:
        """Drop pooled connections after a failure, so the next poll starts clean."""
        try:
            smbclient.reset_connection_cache()
        except Exception:  # noqa: BLE001 - a dead connection may fail to close; nothing to do
            pass
