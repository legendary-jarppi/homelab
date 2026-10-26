"""Auto focus runs from the archived Autorun logs, and the focuser position of archived frames.

An auto focus run in the Autorun log (ASIAIR firmware 13.41, times the ASIAIR's clock):

    2026/10/17 22:06:20 [AutoFocus|Begin] Run AF before Autorun start, exposure 2.0s Bin1, temperature 11.0℃
    2026/10/17 22:06:26 Find Focus Star: detect and calculate star size 6.8 ,  EAF position 6300
    2026/10/17 22:06:42 Calculate V-Curve: detect and calculate star size 17.5 ,  EAF position 6450
    …
    2026/10/17 22:08:29 Calculate Focus Point: detect and calculate star size 4.5 ,  EAF position 6198
    2026/10/17 22:08:54 Auto focus succeeded, the focused position is 6138
    2026/10/17 22:08:55 [AutoFocus|End] Auto focus succeeded

or, cancelled: `Cancel AF Manually` then `[AutoFocus|End] Auto focus failed`. The reason is what
follows "Run AF" ("before Autorun start", "1 hours later", "after Auto Meridian filpped", "when
temperature changed 2 degrees, -10.0℃ changed to -13.0℃"); the temperature is the focuser's
(the EAF's sensor, whole degrees). A measured star size of 0 means no star was found at that
position: such points are left out.
"""

from __future__ import annotations

import os
import re
import threading
from datetime import datetime
from zoneinfo import ZoneInfo

import fits
from archive import Archive
from autorun import LINE, STEP

BEGIN = re.compile(r"^Run AF\s*(.*?),\s*exposure ([\d.]+)s.*?temperature (-?[\d.]+)\s*℃")
POINT = re.compile(r"^(Find Focus Star|Calculate V-Curve|Calculate Focus Point): detect and calculate star size "
                   r"([\d.]+)\s*,\s*EAF position (-?\d+)")
RESULT = re.compile(r"^Auto focus succeeded, the focused position is (-?\d+)")
# Point kinds in `points`: [position, star size, step].
STEPS = {"Find Focus Star": 0, "Calculate V-Curve": 1, "Calculate Focus Point": 2}
# FITS headers are read block by block up to this many 2880-byte blocks (the ASIAIR's take 2–3).
HEADER_MAX_BLOCKS = 20


def parse(text: str, tz: ZoneInfo) -> list[dict]:
    """The auto focus runs in one Autorun log, in order."""
    runs: list[dict] = []
    run: dict | None = None
    target: str | None = None
    last_at: float | None = None

    def close(at: float | None, success: bool) -> None:
        nonlocal run
        if run is None:
            return
        run["endedAt"] = at if at is not None else run["at"]
        run["success"] = success and run["position"] is not None
        sizes = [p[1] for p in run["points"] if p[2] > 0]
        run["bestSize"] = min(sizes) if sizes else None
        runs.append(run)
        run = None

    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("Log disabled"):
            if run is not None:
                run["failure"] = run["failure"] or "log ended during the run"
            close(last_at, False)
            continue
        m = LINE.match(line)
        if not m:
            continue
        at = datetime.strptime(m[1], "%Y/%m/%d %H:%M:%S").replace(tzinfo=tz).timestamp()
        body = m[2].strip()
        last_at = at
        if s := STEP.match(body):
            name, edge, rest = s[1], s[2], s[3]
            if name == "Autorun" and edge == "Begin":
                target = rest.removesuffix(" Start").strip() or target
            elif name == "AutoFocus" and edge == "Begin":
                close(at, False)
                b = BEGIN.match(rest)
                run = {"at": at, "endedAt": None, "target": target,
                       "reason": b[1].strip() if b else rest or None,
                       "exposureS": float(b[2]) if b else None,
                       "temperatureC": float(b[3]) if b else None,
                       "success": False, "position": None, "points": [], "bestSize": None, "failure": None}
            elif name == "AutoFocus" and run is not None:
                if "succeeded" not in rest and run["failure"] is None:
                    run["failure"] = rest or "failed"
                close(at, "succeeded" in rest)
            continue
        if run is None:
            continue
        if p := POINT.match(body):
            size = float(p[2])
            if size > 0:
                run["points"].append([int(p[3]), size, STEPS[p[1]]])
        elif r := RESULT.match(body):
            run["position"] = int(r[1])
        elif not body.startswith(("Find Focus", "Calculate", "Exposure", "Start Tracking")):
            run["failure"] = body  # e.g. "Cancel AF Manually"; kept only if the run fails
    if run is not None:
        close(last_at, False)
    for r in runs:
        if r["success"]:
            r["failure"] = None
    return runs


def focus_position(path: str) -> float | None:
    """FOCUSPOS from a FITS file's header (reads only the header blocks)."""
    data = b""
    with open(path, "rb") as f:
        for _ in range(HEADER_MAX_BLOCKS):
            block = f.read(fits.BLOCK)
            if len(block) < fits.BLOCK:
                return None
            data += block
            try:
                header, _ = fits.parse_header(data)
            except fits.IncompleteFrame:
                continue
            return fits.number(header, "FOCUSPOS")
    return None


class Focus:
    """Every archived Autorun log's auto focus runs, parsed again when a log's size changes."""

    def __init__(self, archive: Archive, tz: ZoneInfo):
        self.archive, self.tz = archive, tz
        self.lock = threading.Lock()
        self.parsed: dict[str, tuple[int, list[dict]]] = {}

    def runs(self) -> tuple[list[dict], float | None]:
        """All runs (oldest first) and the newest log's modification time."""
        with self.archive.lock:
            logs = [(rel, size, mtime) for rel, (size, mtime) in self.archive.files.items()
                    if os.path.basename(rel).startswith("Autorun_Log_")]
        out: list[dict] = []
        with self.lock:
            for rel, size, _ in logs:
                cached = self.parsed.get(rel)
                if cached is None or cached[0] != size:
                    try:
                        text = self.archive.read(rel).decode("utf-8", "replace")
                    except OSError:
                        continue
                    night = rel.split(os.sep)[1] if rel.count(os.sep) >= 2 else None
                    cached = (size, [{**r, "night": night} for r in parse(text, self.tz)])
                    self.parsed[rel] = cached
                out += cached[1]
        out.sort(key=lambda r: r["at"])
        return out, max((m for _, _, m in logs), default=None)

    def json(self) -> dict:
        runs, updated = self.runs()
        return {"runs": runs, "updatedAt": updated}

    def between(self, start: float, end: float) -> list[dict]:
        return [r for r in self.runs()[0] if start <= r["at"] <= end]
