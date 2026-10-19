"""The live history: everything the ASIAIR's control ports say over a night, appended to
<data>/live/<night>.jsonl (one JSON record per line, "t" in unix seconds, "k" the kind):

    guide  every guide step (~3 s): ra, dec (″), s (1 while settling or dithering), snr
    gev    guider events: e = dither, settle, lost, start, stop
    tel    telemetry once a minute: sensor, cooler (%), board (°C), wifi (dBm), uv, ot
    act    what the ASIAIR started doing: a (Exposing, Auto focus, Meridian flip, GoTo, …, Idle)
    plan   plan progress changed: target, index, targets, done, total, ended

Recording does not depend on sessions: a session's guiding, telemetry and live timeline are the
records inside its time window, so GoTo, centering and auto focus before its first frame count too.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections import OrderedDict
from zoneinfo import ZoneInfo

from archive import night_of

log = logging.getLogger("journal")

SAMPLE_S = 5
TELEMETRY_S = 60
CACHED_NIGHTS = 4  # parsed nights kept in memory (~5 MB each with guiding all night)


class Journal:
    def __init__(self, folder: str, tz: ZoneInfo):
        self.folder = folder
        self.tz = tz
        os.makedirs(folder, exist_ok=True)
        self.lock = threading.Lock()
        self.cache: OrderedDict[str, tuple[int, list[dict]]] = OrderedDict()  # night → (bytes parsed, records)

    def path(self, night: str) -> str:
        return os.path.join(self.folder, f"{night}.jsonl")

    def append(self, record: dict) -> None:
        line = json.dumps(record, separators=(",", ":")) + "\n"
        with self.lock:
            try:
                with open(self.path(night_of(record["t"], self.tz)), "a") as f:
                    f.write(line)
            except OSError as e:
                log.error("journal: %s", e)

    def _records(self, night: str) -> list[dict]:
        path = self.path(night)
        with self.lock:
            done, records = self.cache.get(night, (0, []))
            try:
                size = os.path.getsize(path)
            except OSError:
                return []
            if size > done:
                with open(path, "rb") as f:
                    f.seek(done)
                    chunk = f.read(size - done)
                end = chunk.rfind(b"\n") + 1  # a line being written stays for next time
                records.extend(json.loads(l) for l in chunk[:end].splitlines() if l.strip())
                self.cache[night] = (done + end, records)
            if night in self.cache:
                self.cache.move_to_end(night)
                while len(self.cache) > CACHED_NIGHTS:
                    self.cache.popitem(last=False)
            return records

    def read(self, start: float, end: float, kinds: set[str] | None = None) -> list[dict]:
        nights = sorted({night_of(start, self.tz), night_of(end, self.tz)})
        out = []
        for night in nights:
            for r in self._records(night):
                if start <= r["t"] <= end and (kinds is None or r["k"] in kinds):
                    out.append(r)
        return out


class Recorder:
    """Samples the live snapshot: activity and plan changes as they happen, telemetry once a minute."""

    def __init__(self, journal: Journal, snapshot):
        self.journal = journal
        self.snapshot = snapshot
        threading.Thread(target=self.run, name="recorder", daemon=True).start()

    def run(self) -> None:
        activity = plan_key = None
        telemetry_at = 0.0
        while True:
            try:
                live = self.snapshot()
                now = round(time.time(), 1)
                if live is None:
                    activity = plan_key = None
                else:
                    if live["activity"] != activity:
                        activity = live["activity"]
                        self.journal.append({"t": now, "k": "act", "a": activity})
                    plan = live.get("plan")
                    key = (plan["target"], plan["targetIndex"], plan["targetDone"], plan["ended"]) if plan else None
                    if plan and key != plan_key:
                        self.journal.append({"t": now, "k": "plan", "target": plan["target"], "index": plan["targetIndex"],
                                             "targets": plan["targets"], "done": plan["targetDone"],
                                             "total": plan["targetTotal"], "ended": plan["ended"]})
                    plan_key = key
                    if now - telemetry_at >= TELEMETRY_S:
                        telemetry_at = now
                        self.journal.append({"t": now, "k": "tel", "sensor": live["sensorTempC"],
                                             "cooler": live["coolerPowerPct"], "board": live["controllerTempC"],
                                             "wifi": live["wifiDbm"], "uv": live["underVoltage"], "ot": live["overTemp"]})
            except Exception:  # noqa: BLE001 - never let the recorder die
                log.exception("recorder")
            time.sleep(SAMPLE_S)
