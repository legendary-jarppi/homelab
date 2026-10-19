"""The ASIAIR's image storage over SMB (Samba on the ASIAIR, guest login, read only here).

Shares: `EMMC Images` (internal storage; folders at the share root) and `Udisk Images` (a USB disk;
folders under `ASIAIR\\`). Inside each: `Autorun|Plan|Live\\Light\\<target>\\Light_<target>_….fit`
(plus a 200 px `_thn.jpg` per frame), calibration frames under `Autorun|Plan|Live\\Bias|Dark|Flat\\`
and `log\\Autorun_Log_<date>_<time>.txt` (PHD2 guide logs beside them, if any). Only listings,
reads and the shares' free space (a volume query) are used.

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
# Logs worth keeping: the Autorun logs and PHD2's guide logs (not its much larger debug logs).
ARCHIVED_LOG = re.compile(r"^(?:Autorun_Log|PHD2_GuideLog)_(\d{4}-\d{2}-\d{2}_\d{6})\.txt$")
CALIBRATION = ("Bias", "Dark", "Flat")
STAMP = re.compile(r"(\d{8}-\d{6})")
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
    mtime: float = 0.0

    @property
    def name(self) -> str:
        return self.path.rsplit("\\", 1)[-1]


@dataclass(frozen=True)
class OtherFile:
    """A file that is only archived: a calibration frame (kind Bias/Dark/Flat) or a log (kind None)."""

    path: str
    kind: str | None
    taken_at: float
    size: int
    mtime: float

    @property
    def name(self) -> str:
        return self.path.rsplit("\\", 1)[-1]


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

    def logs(self) -> list[LogFile]:
        """Autorun logs and PHD2 guide logs (`started` is the time in the name, ASIAIR clock)."""
        logs: list[LogFile] = []
        for share, root in self.roots:
            for entry in self._entries(self._unc(share, root, "log")):
                if (m := ARCHIVED_LOG.match(entry.name)) and entry.is_file():
                    info = entry.smb_info
                    logs.append(LogFile(entry.path, info.end_of_file, m[1], info.last_write_time.timestamp()))
        return logs

    @staticmethod
    def newest_log(logs: list[LogFile]) -> LogFile | None:
        return max((l for l in logs if LOG.match(l.name)), key=lambda l: l.started, default=None)

    def log_time(self, log: LogFile) -> float:
        return datetime.strptime(log.started, "%Y-%m-%d_%H%M%S").replace(tzinfo=self.tz).timestamp()

    def calibration(self) -> list[OtherFile]:
        """Autorun calibration frames: <mode>\\<Bias|Dark|Flat>\\[<folder>\\]….fit."""
        found: list[OtherFile] = []

        def add(entry, kind: str) -> None:
            info = entry.smb_info
            m = STAMP.search(entry.name)
            taken = (datetime.strptime(m[1], "%Y%m%d-%H%M%S").replace(tzinfo=self.tz).timestamp()
                     if m else info.last_write_time.timestamp())
            found.append(OtherFile(entry.path, kind, taken, info.end_of_file, info.last_write_time.timestamp()))

        for share, root in self.roots:
            for mode in MODES:
                for kind in CALIBRATION:
                    for entry in self._entries(self._unc(share, root, mode, kind)):
                        if entry.is_dir():
                            for inner in self._entries(entry.path):
                                if inner.is_file() and inner.name.lower().endswith(".fit"):
                                    add(inner, kind)
                        elif entry.is_file() and entry.name.lower().endswith(".fit"):
                            add(entry, kind)
        return found

    def storage(self) -> list[dict]:
        """Free and total space of each share (one query per share; read only)."""
        out = []
        for share in dict.fromkeys(s for s, _ in self.roots):
            try:
                result = smbclient.stat_volume(self._unc(share), connection_timeout=self.timeout_s, **SMB)
            except SMBOSError:
                continue  # no USB disk in the ASIAIR
            out.append({"name": share, "freeBytes": result.caller_available_size, "totalBytes": result.total_size})
        return out

    def read(self, path: str) -> bytes:
        with smbclient.open_file(path, mode="rb", connection_timeout=self.timeout_s, **SMB) as f:
            return f.read()

    def reset(self) -> None:
        """Drop pooled connections after a failure, so the next poll starts clean."""
        try:
            smbclient.reset_connection_cache()
        except Exception:  # noqa: BLE001 - a dead connection may fail to close; nothing to do
            pass
