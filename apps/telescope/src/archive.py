"""The archive at home: every file from the ASIAIR, byte for byte, by night and target.

    <root>/<YYYY>/<night>/<target>/Light_….fit     light frames (target = the ASIAIR's folder name)
    <root>/<YYYY>/<night>/<Bias|Dark|Flat>/….fit    Autorun calibration frames
    <root>/<YYYY>/<night>/Autorun_Log_….txt          logs (Autorun, PHD2 guide logs)

`night` is the local date of the evening (times before noon belong to the previous evening). Files
are written to a temporary name and renamed, with the ASIAIR's modification time, so a file in the
archive is always complete and `size`/`mtime` tell whether it matches the ASIAIR's copy. Nothing is
ever deleted, here or on the ASIAIR.
"""

from __future__ import annotations

import os
import threading
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo


def night_of(ts: float, tz: ZoneInfo) -> str:
    return (datetime.fromtimestamp(ts, tz) - timedelta(hours=12)).date().isoformat()


def safe(name: str) -> str:
    return name.replace("/", "_").replace("\0", "").strip() or "_"


class Archive:
    def __init__(self, root: str, tz: ZoneInfo):
        self.root = root
        self.tz = tz
        self.lock = threading.Lock()
        self.files: dict[str, tuple[int, float]] = {}  # relative path → (size, mtime)
        self.scan()

    def scan(self) -> None:
        files = {}
        for folder, _, names in os.walk(self.root):
            for name in names:
                if name.startswith(".tmp-"):
                    os.unlink(os.path.join(folder, name))  # an interrupted copy
                    continue
                path = os.path.join(folder, name)
                st = os.stat(path)
                files[os.path.relpath(path, self.root)] = (st.st_size, st.st_mtime)
        with self.lock:
            self.files = files

    def rel(self, ts: float, folder: str | None, name: str) -> str:
        night = night_of(ts, self.tz)
        parts = [night[:4], night] + ([safe(folder)] if folder else []) + [safe(name)]
        return os.path.join(*parts)

    def has(self, rel: str, size: int, mtime: float | None = None) -> bool:
        with self.lock:
            entry = self.files.get(rel)
        if entry is None or entry[0] != size:
            return False
        return mtime is None or entry[1] >= mtime - 1

    def path(self, rel: str) -> str:
        return os.path.join(self.root, rel)

    def read(self, rel: str) -> bytes:
        with open(self.path(rel), "rb") as f:
            return f.read()

    def write(self, rel: str, data: bytes, mtime: float) -> None:
        path = self.path(rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = os.path.join(os.path.dirname(path), f".tmp-{os.path.basename(path)}")
        with open(tmp, "wb") as f:
            f.write(data)
        os.utime(tmp, (mtime, mtime))
        os.replace(tmp, path)
        with self.lock:
            self.files[rel] = (len(data), mtime)

    def totals(self) -> tuple[int, int]:
        with self.lock:
            return len(self.files), sum(size for size, _ in self.files.values())
