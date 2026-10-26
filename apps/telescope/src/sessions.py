"""Sessions: every light frame grouped by target, analysed, judged, registered and stacked.

A session is a target folder's frames without a gap over 2 h (as in the status), assigned when a
frame is first seen and never regrouped. Its id is the local time of its first frame and the target,
e.g. `20261017-2034-c-9`. Per session, <data>/sessions/<id>/:

    session.json        frames (file, numbers, transform, automatic and manual decision), the
                        reference frame's stars and plate solve, the stack's numbers
    stack.fits          the stack: 32-bit float, superpixel size (1504×1504×3 for the ASI533MC)
    stack.jpg, stack-small.jpg

and <data>/previews/<ab>/<frame id>[-small].jpg for every frame. Aligned frames (float16, for
restacking) are a disposable cache (<cache>/<id>/), rebuilt from the archive when missing.

One worker thread does all the processing, highest priority first: the newest session's frames
(newest first) and its restack, the logs, then the backfill of older sessions and calibration frames
with a pause between files, so a running session's new frames never wait behind the backfill. A
second thread plate solves (ASTAP) frames analysed without a solution while the worker is idle.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import statistics
import threading
import time
import warnings
from collections import Counter
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np

import analysis
import autorun
import fits
import filters
import focus
import images
import measure
import register
import rejection
import solve
import skyq
import stacking
import trails
from archive import Archive, night_of
from asiair import FRAME, Asiair, FrameFile, LogFile, OtherFile
from journal import Journal

log = logging.getLogger("sessions")

SESSION_GAP_S = 2 * 3600
# The reference frame (the grid everything is aligned to) moves to a frame this much better
# (stars / HFR) while no more than REF_SWITCH_FRAMES are aligned; later it stays.
REF_SWITCH_FRAMES = 20
REF_SWITCH_GAIN = 1.25
# While the newest session still has frames waiting, restack at most this often.
COMBINE_EVERY_S = 60
# A frame younger than this on the ASIAIR may still be touched (the ASIAIR rewrites it after saving).
SETTLE_S = 15
BACKFILL_PAUSE_S = 2.0
RETRY_S = 60
# The solver thread looks for frames without a plate solve this often when it found none.
SOLVER_IDLE_S = 60
# Folders in /cache that are not a session's aligned frames: never pruned (tilt.Inspector, guidelog.GuideLogs).
CACHE_SHARED = {"inspect", "guidelogs"}
# Live history around a session: before its first frame (GoTo, centering, auto focus) and after.
LEAD_S = 1800
TRAIL_S = 600
GUIDE_POINTS = 2000
TELEMETRY_POINTS = 500
TIMELINE_ACTIVITIES = {"Auto focus": "autofocus", "Meridian flip": "meridian_flip", "GoTo": "goto",
                       "Plate solving": "centering"}
# The camera angle in a frame's name: Light_M 31_180.0s_Bin1_20260903-021110_93deg_0001.fit.
NAME_ANGLE = re.compile(r"_(-?\d+(?:\.\d+)?)deg_")
# A rejection's first reason (rejection.py's and reason()'s wording) as a kind for the statistics;
# "stars elongated" before the star count's "stars …".
REJECT_KINDS = (("only ", "stars"), ("stars elongated", "elongation"), ("stars ", "stars"), ("HFR", "hfr"),
                ("background", "background"), ("guiding", "guiding"), ("not aligned", "alignment"),
                ("rejected by hand", "manual"), ("unreadable", "unreadable"))


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "target"


def frame_id(key: str, size: int) -> str:
    return hashlib.sha1(f"{key}|{size}".encode()).hexdigest()[:16]


def downsample(points: list, limit: int) -> list:
    if len(points) <= limit:
        return points
    step = len(points) / limit
    return [points[int(i * step)] for i in range(limit)]


def rms(values: list[float]) -> float | None:
    """PHD2's RMS: the spread around the mean."""
    if not values:
        return None
    mean = sum(values) / len(values)
    return (sum((v - mean) ** 2 for v in values) / len(values)) ** 0.5


def guiding_rms(steps: list[dict]) -> tuple[float | None, float | None, float | None, int]:
    steady = [s for s in steps if not s["s"]]
    ra, dec = rms([s["ra"] for s in steady]), rms([s["dec"] for s in steady])
    total = (ra**2 + dec**2) ** 0.5 if ra is not None and dec is not None else None
    return total, ra, dec, len(steady)


def r2(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(value, digits)


def reject_kind(reason: str | None) -> str:
    for prefix, kind in REJECT_KINDS:
        if reason and reason.startswith(prefix):
            return kind
    return "other"


class Store:
    def __init__(self, data: str, cache: str, archive: Archive, journal: Journal, asiair: Asiair,
                 tz: ZoneInfo, cache_max_bytes: int):
        self.data, self.cache, self.archive, self.journal = data, cache, archive, journal
        self.asiair, self.tz = asiair, tz
        # Whether the ASIAIR's storage answers (set by the poller); offline only the archive is read.
        self.online = lambda: False
        self.cache_max_bytes = cache_max_bytes
        self.lock = threading.RLock()
        self.wake = threading.Event()
        self.sessions: dict[str, dict] = {}
        self.by_rel: dict[str, str] = {}  # archive path of a light frame → session id
        self.others: dict[str, LogFile | OtherFile] = {}  # archive path → logs, calibration frames
        self.retry_at: dict[str, float] = {}
        self.last_combine: dict[str, float] = {}
        self.logs: dict[str, tuple[int, autorun.Log | None]] = {}  # parsed archived Autorun logs
        self.focus = focus.Focus(archive, tz)  # auto focus runs from the archived Autorun logs
        self.stack_numbers: dict[str, tuple[str, dict | None, dict | None]] = {}  # histogram per stack version
        self.scratch = os.path.join(cache, ".solve")  # ASTAP's working files
        self.idle = threading.Event()  # set while the worker has nothing to do: the solver runs then
        # R6: the D05 stars for the frames' photometry, the sensor's noise from archived bias frames.
        self.catalog = skyq.Catalog(solve.DATABASE)
        self.sensors_path = os.path.join(data, "sensor.json")
        self.sensors: dict[str, dict] = self._load_sensors()
        os.makedirs(os.path.join(data, "sessions"), exist_ok=True)
        os.makedirs(os.path.join(data, "previews"), exist_ok=True)
        os.makedirs(cache, exist_ok=True)
        self.load()

    # --- persistence ---------------------------------------------------------------------------

    def folder(self, sid: str) -> str:
        return os.path.join(self.data, "sessions", sid)

    def load(self) -> None:
        root = os.path.join(self.data, "sessions")
        for sid in sorted(os.listdir(root)):
            path = os.path.join(root, sid, "session.json")
            try:
                with open(path) as f:
                    s = json.load(f)
            except (OSError, ValueError) as e:
                log.error("session %s: %s", sid, e)
                continue
            self.sessions[s["id"]] = s
            for f in s["frames"]:
                self.by_rel[f["rel"]] = s["id"]
        # Light frames in the archive that no session knows (their session.json was deleted to
        # reprocess it, or the data volume was restored from an older backup).
        found = []
        for rel, (size, mtime) in list(self.archive.files.items()):
            parts = rel.split(os.sep)
            if rel in self.by_rel or len(parts) != 4 or not (m := FRAME.match(parts[3])):
                continue
            saved = datetime.strptime(m["ts"], "%Y%m%d-%H%M%S").replace(tzinfo=self.tz).timestamp()
            exposure = float(m["exp"]) / (1000 if m["unit"] == "ms" else 1)
            found.append(dict(rel=rel, src=None, root=None, mode=None, target=parts[2], number=int(m["n"]),
                              exposureS=exposure, savedAt=saved, size=size, mtime=mtime))
        self._add(found)
        log.info("%d sessions, %d frames (%d from the archive only)", len(self.sessions), len(self.by_rel), len(found))

    def save(self, s: dict) -> None:
        folder = self.folder(s["id"])
        os.makedirs(folder, exist_ok=True)
        tmp = os.path.join(folder, ".session.json")
        with open(tmp, "w") as f:
            json.dump(s, f, separators=(",", ":"))
        os.replace(tmp, os.path.join(folder, "session.json"))

    def preview_path(self, fid: str, small: bool) -> str:
        return os.path.join(self.data, "previews", fid[:2], f"{fid}{'-small' if small else ''}.jpg")

    # --- what is on the ASIAIR -----------------------------------------------------------------

    def add_frames(self, files: list[FrameFile]) -> None:
        entries = []
        for f in files:
            name = f.path.rsplit("\\", 1)[-1]
            entries.append(dict(rel=self.archive.rel(f.saved_at, f.target, name), src=f.path, root=f.root,
                                mode=f.mode, target=f.target, number=f.number, exposureS=f.exposure_s,
                                savedAt=f.saved_at, size=f.size, mtime=f.mtime))
        with self.lock:
            self._add(entries)
        self.wake.set()

    def _add(self, entries: list[dict]) -> None:
        touched = set()
        for e in sorted(entries, key=lambda e: e["savedAt"]):
            sid = self.by_rel.get(e["rel"])
            if sid:
                s = self.sessions[sid]
                f = next(x for x in s["frames"] if x["rel"] == e["rel"])
                changed = f["size"] != e["size"]
                if f.get("src") != e["src"] or f.get("mtime") != e["mtime"] or changed or f.get("mode") != e["mode"]:
                    f.update(src=e["src"], root=e["root"], mode=e["mode"] or f.get("mode"), mtime=e["mtime"], size=e["size"])
                    if changed and f["state"] != "pending":
                        # Rewritten on the ASIAIR: analyse again.
                        self._reset_frame(f)
                    touched.add(sid)
                continue
            s = self._session_for(e)
            s["frames"].append(dict(e, state="pending", manual=None))
            s["frames"].sort(key=lambda x: x["savedAt"])
            if e["mode"]:
                s["mode"] = e["mode"]
            self.by_rel[e["rel"]] = s["id"]
            touched.add(s["id"])
        for sid in touched:
            self.save(self.sessions[sid])

    def _session_for(self, e: dict) -> dict:
        for s in self.sessions.values():
            if s["target"] != e["target"]:
                continue
            first, last = s["frames"][0]["savedAt"], s["frames"][-1]["savedAt"]
            if first - SESSION_GAP_S <= e["savedAt"] <= last + SESSION_GAP_S:
                return s
        start = e["savedAt"] - e["exposureS"]
        base = f"{datetime.fromtimestamp(start, self.tz):%Y%m%d-%H%M}-{slug(e['target'])}"
        sid, n = base, 2
        while sid in self.sessions:
            sid, n = f"{base}-{n}", n + 1
        s = {"id": sid, "target": e["target"], "mode": e["mode"], "night": night_of(start, self.tz),
             "frames": [], "reference": None, "header": {}, "stack": None, "dirty": False}
        self.sessions[sid] = s
        return s

    def set_others(self, files: list[LogFile | OtherFile], log_time) -> None:
        """Logs and calibration frames on the ASIAIR (only archived)."""
        others = {}
        for f in files:
            if isinstance(f, LogFile):
                others[self.archive.rel(log_time(f), None, f.name)] = f
            else:
                others[self.archive.rel(f.taken_at, f.kind, f.name)] = f
        with self.lock:
            self.others.update(others)
        self.wake.set()

    @staticmethod
    def _reset_frame(f: dict) -> None:
        for key in ("id", "info", "fwhmPx", "elongation", "bg", "noise", "wcs", "transform", "alignError",
                    "matches", "alignRmsPx", "alignMethod", "guidingRmsArcsec", "auto", "error", "solve", "trails",
                    "skyq"):
            f.pop(key, None)
        f["state"] = "pending"

    # --- picking work --------------------------------------------------------------------------

    def ordered(self) -> list[dict]:
        return sorted(self.sessions.values(), key=lambda s: s["frames"][-1]["savedAt"], reverse=True)

    def _readable(self, f: dict, now: float, online: bool) -> bool:
        if self.retry_at.get(f["rel"], 0) > now:
            return False
        if self.archive.has(f["rel"], f["size"]):
            return True
        if not (online and f.get("src")):
            return False
        mtime = f.get("mtime") or 0
        return not (now - SETTLE_S < mtime <= now + 60)

    def pick(self):
        now = time.time()
        online = self.online()
        with self.lock:
            sessions = self.ordered()
            for i, s in enumerate(sessions):
                pending = [f for f in s["frames"] if f["state"] == "pending" and self._readable(f, now, online)]
                waiting = any(f["state"] == "pending" for f in s["frames"])
                stackable = s.get("dirty") and self.retry_at.get(s["id"], 0) <= now
                if i == 0:
                    if pending:
                        return ("frame", s["id"], pending[-1]["rel"], False)
                    if stackable and (not waiting or now - self.last_combine.get(s["id"], 0) > COMBINE_EVERY_S):
                        return ("combine", s["id"], None, False)
                    continue
                if stackable and not waiting:
                    return ("combine", s["id"], None, False)
            if online:
                for rel, f in sorted(self.others.items(), key=lambda kv: -kv[1].mtime):
                    if isinstance(f, LogFile) and self.retry_at.get(rel, 0) <= now and not self.archive.has(rel, f.size, f.mtime):
                        return ("other", None, rel, False)
            # Backfill: older sessions newest first, their frames oldest first; the pause after
            # each only when it comes over the VPN.
            for s in sessions[1:]:
                pending = [f for f in s["frames"] if f["state"] == "pending" and self._readable(f, now, online)]
                if pending:
                    f = pending[0]
                    return ("frame", s["id"], f["rel"], not self.archive.has(f["rel"], f["size"]))
                if (s.get("dirty") and self.retry_at.get(s["id"], 0) <= now
                        and self.last_combine.get(s["id"], 0) < now - COMBINE_EVERY_S):
                    return ("combine", s["id"], None, False)
            if online:
                for s in sessions:
                    for f in s["frames"]:
                        if (f["state"] == "done" and f.get("src") and self.retry_at.get(f["rel"], 0) <= now
                                and not self.archive.has(f["rel"], f["size"], f.get("mtime"))
                                and not now - SETTLE_S < (f.get("mtime") or 0) <= now + 60):
                            return ("refresh", s["id"], f["rel"], True)
                for rel, f in sorted(self.others.items(), key=lambda kv: -kv[1].mtime):
                    if self.retry_at.get(rel, 0) <= now and not self.archive.has(rel, f.size, f.mtime):
                        return ("other", None, rel, True)
            # Focuser positions of frames analysed before `focusPos` was kept: from the archived
            # files' header blocks, one session per job, after everything else.
            for s in sessions:
                if any(self._needs_focus(f) for f in s["frames"]):
                    return ("focus", s["id"], None, True)
            # Trails (A7) in frames analysed before they were marked: from the archive, one frame per
            # job, newest session first, after everything else.
            for s in sessions:
                for f in s["frames"]:
                    if (f["state"] == "done" and f.get("trails") is None and self.retry_at.get(f["rel"], 0) <= now
                            and self.archive.has(f["rel"], f["size"])):
                        return ("trails", s["id"], f["rel"], True)
            # R6, after everything else: the sensor's bias level, read noise and dark current from a
            # night's archived bias (and dark) frames, newest night first; then each frame's sky
            # brightness from the archive, one frame per job, newest session first.
            for night, files in sorted(self.calibration_nights().items(), reverse=True):
                if night not in self.sensors and len(files["Bias"]) >= 2 and self.retry_at.get(night, 0) <= now:
                    return ("sensor", None, night, True)
            for s in sessions:
                for f in s["frames"]:
                    if self.retry_at.get(f["rel"], 0) <= now and self._needs_sky(f):
                        return ("sky", s["id"], f["rel"], True)
        return None

    def backlog(self) -> int:
        """Files still to fetch or analyse (for the metrics)."""
        with self.lock:
            frames = sum(1 for s in self.sessions.values() for f in s["frames"] if f["state"] == "pending")
            others = sum(1 for rel, f in self.others.items() if not self.archive.has(rel, f.size, f.mtime))
        return frames + others

    def run(self) -> None:
        while True:
            try:
                job = self.pick()
            except Exception:  # noqa: BLE001
                log.exception("pick")
                job = None
            if job is None:
                self.idle.set()
                self.wake.wait(30)
                self.wake.clear()
                continue
            # The solver also runs beside the lowest backfill (focus positions, trails, sky brightness):
            # those can take hours after a first start, and a pending solve matters more.
            if job[0] in ("focus", "trails", "sensor", "sky"):
                self.idle.set()
            else:
                self.idle.clear()
            kind, sid, rel, backfill = job
            try:
                if kind == "frame":
                    self.process(sid, rel)
                elif kind == "combine":
                    self.combine(sid)
                elif kind == "refresh":
                    self.refresh(sid, rel)
                elif kind == "focus":
                    self.fill_focus(sid)
                elif kind == "trails":
                    self.scan_trails(sid, rel)
                elif kind == "sensor":
                    self.measure_sensor(rel)
                elif kind == "sky":
                    self.measure_sky(sid, rel)
                else:
                    self.copy_other(rel)
            except Exception as e:  # noqa: BLE001 - one bad file must not stop the worker
                log.exception("%s %s %s", kind, sid, rel)
                with self.lock:
                    self.retry_at[rel or sid] = time.time() + RETRY_S * 10
                    s = self.sessions.get(sid) if sid else None
                    if kind == "frame" and s:
                        # Not a transient read error (those return quietly): give up on this file.
                        frame = next((x for x in s["frames"] if x["rel"] == rel), None)
                        if frame and frame["state"] == "pending":
                            frame.update(state="failed", error=f"{type(e).__name__}: {e}"[:200],
                                         id=frame_id(frame.get("src") or rel, frame["size"]))
                            s["dirty"] = True
                            self.save(s)
                    elif kind == "combine" and s:
                        s["dirty"] = True
                    elif kind == "trails" and s:
                        # Counts as scanned: the same frame would fail again on every retry.
                        frame = next((x for x in s["frames"] if x["rel"] == rel), None)
                        if frame and frame.get("trails") is None:
                            frame["trails"] = []
                            self.save(s)
                    elif kind == "sky" and s:
                        # Recorded with the error: the same frame would fail again on every retry.
                        frame = next((x for x in s["frames"] if x["rel"] == rel), None)
                        if frame:
                            frame["skyq"] = {"error": f"{type(e).__name__}: {e}"[:200]}
                            self.save(s)
                    elif kind == "sensor":
                        self.sensors[rel] = {"error": f"{type(e).__name__}: {e}"[:200], "measuredAt": time.time()}
                        self._save_sensors()
            if backfill:
                time.sleep(BACKFILL_PAUSE_S)

    def start(self) -> None:
        threading.Thread(target=self.run, name="worker", daemon=True).start()
        if solve.available():
            threading.Thread(target=self.run_solver, name="solver", daemon=True).start()
        else:
            log.warning("ASTAP not found (%s, %s): no own plate solving", solve.ASTAP, solve.DATABASE)

    # --- reading files -------------------------------------------------------------------------

    def _read_frame(self, f: dict) -> bytes | None:
        """The frame's bytes from the archive, or from the ASIAIR (archiving them); None: later."""
        if self.archive.has(f["rel"], f["size"]):
            return self.archive.read(f["rel"])
        try:
            raw = self.asiair.read(f["src"])
        except OSError as e:
            log.warning("read %s: %s", f["src"], e)
            self.asiair.reset()
            self.retry_at[f["rel"]] = time.time() + RETRY_S
            return None
        if len(raw) != f["size"]:
            # Still being written, or rewritten since the listing: the next listing has the size.
            self.retry_at[f["rel"]] = time.time() + RETRY_S
            return None
        try:
            header, offset = fits.parse_header(raw)
            fits.read_pixels(raw, header, offset)
        except fits.IncompleteFrame:
            self.retry_at[f["rel"]] = time.time() + RETRY_S
            return None
        self.archive.write(f["rel"], raw, f.get("mtime") or time.time())
        return raw

    def refresh(self, sid: str, rel: str) -> None:
        """The ASIAIR touched an archived frame again (same name): copy it again."""
        with self.lock:
            f = next(x for x in self.sessions[sid]["frames"] if x["rel"] == rel)
            src, size, mtime = f["src"], f["size"], f.get("mtime") or time.time()
        try:
            raw = self.asiair.read(src)
        except OSError as e:
            log.warning("read %s: %s", src, e)
            self.asiair.reset()
            self.retry_at[rel] = time.time() + RETRY_S
            return
        if len(raw) != size:
            self.retry_at[rel] = time.time() + RETRY_S
            return
        self.archive.write(rel, raw, mtime)

    def copy_other(self, rel: str) -> None:
        with self.lock:
            f = self.others[rel]
        try:
            raw = self.asiair.read(f.path)
        except OSError as e:
            log.warning("read %s: %s", f.path, e)
            self.asiair.reset()
            self.retry_at[rel] = time.time() + RETRY_S
            return
        if len(raw) != f.size:
            self.retry_at[rel] = time.time() + RETRY_S
            return
        self.archive.write(rel, raw, f.mtime)
        log.info("archived %s (%.1f MB)", rel, len(raw) / 1e6)

    def _needs_focus(self, f: dict) -> bool:
        return (f["state"] == "done" and f.get("info") is not None and "focusPos" not in f["info"]
                and self.archive.has(f["rel"], f["size"]))

    def fill_focus(self, sid: str) -> None:
        """FOCUSPOS for a session's frames analysed before it was kept (null when the header has none)."""
        with self.lock:
            todo = [(f["rel"], f["size"]) for f in self.sessions[sid]["frames"] if self._needs_focus(f)]
        found: dict[str, float | None] = {}
        for rel, _ in todo:
            try:
                found[rel] = focus.focus_position(self.archive.path(rel))
            except OSError as e:
                log.warning("focus position %s: %s", rel, e)
                found[rel] = None
        with self.lock:
            s = self.sessions[sid]
            for f in s["frames"]:
                if f["rel"] in found and f.get("info") is not None and "focusPos" not in f["info"]:
                    f["info"]["focusPos"] = found[f["rel"]]
            self.save(s)
        log.info("session %s: focuser positions of %d frames from their headers", sid, len(found))

    # --- plate solving (ASTAP, for frames whose header has none) --------------------------------

    def _solve_hint(self, s: dict, rel: str, header: dict[str, str]) -> tuple[float | None, float | None, float]:
        """Where to search: a solved frame of the same session (the nearest in time), else the header's
        RA/Dec; and the field height from the header."""
        ra, dec, fov = solve.frame_hints(header)
        at = next(f["savedAt"] for f in s["frames"] if f["rel"] == rel)
        solved = [f for f in s["frames"] if f.get("wcs") and f["rel"] != rel]
        if solved:
            ra, dec = min(solved, key=lambda f: abs(f["savedAt"] - at))["wcs"]["crval"]
        return ra, dec, fov

    def _solve(self, rel: str, stars: int, hint: tuple, blind: bool, timeout: float) -> tuple[fits.Wcs | None, dict]:
        """ASTAP on the archived frame: its solution (camera pixels, linear part as for ASIAIR solves)
        and the frame's `solve` record (`retry`: the solver thread should search further)."""
        now = time.time()
        if stars < solve.MIN_STARS:
            return None, {"source": None, "at": now, "error": f"too few stars ({stars}) to plate solve", "retry": False}
        ra, dec, fov = hint
        try:
            result = solve.solve(self.archive.path(rel), self.scratch, ra, dec, fov, timeout, blind)
            plate = fits.wcs(result.cards)
            if plate is None:
                raise solve.SolveError("degenerate solution", result.seconds)
        except solve.SolveError as e:
            log.info("plate solve %s: %s (%.1f s)", rel, e, e.seconds)
            return None, {"source": None, "at": now, "error": str(e)[:200], "retry": not blind}
        except Exception as e:  # noqa: BLE001 - a failed solve must never fail the frame's analysis
            log.exception("plate solve %s", rel)
            return None, {"source": None, "at": now, "error": f"{type(e).__name__}: {e}"[:200], "retry": not blind}
        log.info("plate solve %s: RA %.4f Dec %.4f, %.3f\"/px%s (%.1f s)", rel, plate.crval[0], plate.crval[1],
                 plate.pixel_scale_arcsec(), ", whole-sky search" if result.blind else "", result.seconds)
        return plate, {"source": "astap", "at": now, "error": None, "seconds": round(result.seconds, 2), "retry": False}

    def _needs_solve(self, f: dict) -> bool:
        record = f.get("solve")
        return (f["state"] == "done" and not f.get("wcs") and (record is None or record.get("retry"))
                and (f.get("info") or {}).get("stars", 0) >= solve.MIN_STARS and self.archive.has(f["rel"], f["size"]))

    def _pick_solve(self) -> tuple[str, str] | None:
        """Newest session first; in it the frame with the most stars, so that the best frame takes a
        whole-sky search and the others are then searched around its solution."""
        with self.lock:
            for s in self.ordered():
                todo = [f for f in s["frames"] if self._needs_solve(f)]
                if todo:
                    return s["id"], max(todo, key=lambda f: f["info"]["stars"])["rel"]
        return None

    def solve_frame(self, sid: str, rel: str) -> None:
        """A frame analysed without a plate solve: searched around a solved frame of its session, else
        around the header's position and then (accepted frames only) the whole sky. The stack needs no
        restack: stack_wcs takes the solution from the frames as they are."""
        with open(self.archive.path(rel), "rb") as fh:
            header, _ = fits.read_header_file(fh)
        with self.lock:
            s = self.sessions[sid]
            f = next(x for x in s["frames"] if x["rel"] == rel)
            size, stars = f["size"], f["info"]["stars"]
            blind = not any(x.get("wcs") for x in s["frames"]) and self.accepted(f)
            hint = self._solve_hint(s, rel, header)
        plate, record = self._solve(rel, stars, hint, blind, solve.FRAME_TIMEOUT_S)
        record["retry"] = False
        with self.lock:
            s = self.sessions[sid]
            f = next((x for x in s["frames"] if x["rel"] == rel), None)
            if f is None or f["size"] != size or f["state"] != "done" or f.get("wcs"):
                return  # analysed again meanwhile
            f["solve"] = record
            if plate:
                f["wcs"] = plate.json()
                if s.get("reference") == rel and not s.get("refWcs"):
                    s["refWcs"] = f["wcs"]
            self.save(s)

    def run_solver(self) -> None:
        """The solver thread: frames without a plate solve (analysed before ASTAP was here, or whose
        search around the header's position failed), one at a time, only while the worker is idle and
        with a pause after each, so a running session's new frames never wait for a long search."""
        while True:
            self.idle.wait()
            job = None
            try:
                job = self._pick_solve()
                if job is None:
                    time.sleep(SOLVER_IDLE_S)
                    continue
                self.solve_frame(*job)
            except Exception as e:  # noqa: BLE001 - an unreadable file must not stop the solver
                log.exception("plate solve %s", job)
                with self.lock:
                    s = self.sessions.get(job[0]) if job else None
                    f = next((x for x in s["frames"] if x["rel"] == job[1]), None) if s else None
                    if f is not None:
                        f["solve"] = {"source": None, "at": time.time(), "error": f"{type(e).__name__}: {e}"[:200],
                                      "retry": False}
                        self.save(s)
            time.sleep(BACKFILL_PAUSE_S)

    # --- analysis and registration -------------------------------------------------------------

    def process(self, sid: str, rel: str) -> None:
        started = time.time()
        with self.lock:
            s = self.sessions[sid]
            f = dict(next(x for x in s["frames"] if x["rel"] == rel))
        raw = self._read_frame(f)
        if raw is None:
            return
        try:
            header, offset = fits.parse_header(raw)
            pixels = fits.read_pixels(raw, header, offset)
        except (ValueError, fits.IncompleteFrame) as e:
            with self.lock:
                frame = next(x for x in self.sessions[sid]["frames"] if x["rel"] == rel)
                frame.update(state="failed", error=str(e)[:200], id=frame_id(f.get("src") or rel, f["size"]))
                self.save(self.sessions[sid])
            log.error("frame %s: %s", rel, e)
            return
        del raw
        rendered = fits.render(pixels, header)
        step = skyq.adu_step(pixels)
        del pixels
        fid = frame_id(f.get("src") or rel, f["size"])
        for small, data in ((False, rendered.large), (True, rendered.small)):
            path = self.preview_path(fid, small)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path + ".tmp", "wb") as out:
                out.write(data)
            os.replace(path + ".tmp", path)
        planes = rendered.planes
        luminance = planes[1] if len(planes) == 3 else planes[0]
        sky = [analysis.background(p) for p in planes]
        stars = analysis.detect(luminance)
        at = date_obs(header.get("DATE-OBS")) or f["savedAt"] - f["exposureS"]
        exposure = fits.number(header, "EXPTIME") or f["exposureS"]
        steps = self.journal.read(at, at + exposure, {"guide"})
        guide_total = guiding_rms(steps)[0] if len(steps) >= 5 else None
        info = {
            "id": fid,
            "target": header.get("OBJECT") or f["target"],
            "mode": f.get("mode"),
            "number": f["number"],
            "at": at,
            "exposureS": exposure,
            "gain": fits.number(header, "GAIN"),
            "sensorTempC": fits.number(header, "CCD-TEMP"),
            "setTempC": fits.number(header, "SET-TEMP"),
            "camera": header.get("INSTRUME"),
            "focalLengthMm": fits.number(header, "FOCALLEN"),
            "rotatorDeg": fits.number(header, "ROTATOR"),
            "focusPos": fits.number(header, "FOCUSPOS"),
            "backgroundAdu": round(rendered.background_adu),
            "stars": rendered.stars,
            "hfr": rendered.hfr,
            "width": rendered.width,
            "height": rendered.height,
        }
        scale = rendered.scale
        plate = fits.wcs(header)
        if plate:
            solved = {"source": "asiair", "at": time.time(), "error": None}
        elif solve.available():
            # Only around the header's position here (~0.2 s, ~2.4 s when it fails); further searches
            # are the solver thread's.
            with self.lock:
                hint = self._solve_hint(self.sessions[sid], rel, header)
            plate, solved = self._solve(rel, rendered.stars, hint, False, solve.HINT_TIMEOUT_S)
        else:
            solved = None
        shape = luminance.shape
        result = {
            "state": "done", "id": fid, "info": info,
            "fwhmPx": r2(stars.fwhm * scale) if stars.fwhm else None,
            "elongation": r2(stars.elongation),
            "bg": [round(m, 2) for m, _ in sky], "noise": [round(n, 3) for _, n in sky],
            "wcs": plate.json() if plate else None,
            "solve": solved,
            "guidingRmsArcsec": r2(guide_total),
            "trails": self._trails(rel, planes, sky, stars.fwhm),
            # R6: zero point and sky brightness (~0.1 s); without a solve yet, the backfill measures it later.
            "skyq": self._skyq(rel, f, luminance, header, plate, scale, step, stars.fwhm),
        }

        # Registration against the session's reference (this frame becomes it if there is none).
        with self.lock:
            s = self.sessions[sid]
            ref = s.get("reference")
            ref_stars = np.array(s.get("refStars") or np.zeros((0, 2)))
            ref_wcs = fits.Wcs.from_json(s.get("refWcs"))
        matrix = None
        if ref is None or ref == rel:
            if len(stars.xy) >= rejection.MIN_STARS:
                matrix = np.eye(3)
                ref = rel
                with self.lock:
                    s.update(reference=rel, refStars=np.round(stars.xy, 2).tolist(), refWcs=result["wcs"],
                             refShape=list(shape), refScale=scale)
            else:
                result["alignError"] = f"too few stars ({len(stars.xy)}) to be the reference"
        else:
            guess = register.wcs_guess(plate, ref_wcs, shape, scale) if plate and ref_wcs else None
            reg = register.register(stars.xy, ref_stars, guess)
            if reg is None:
                result["alignError"] = f"no match with the reference stars ({len(stars.xy)} stars)"
            else:
                matrix = reg.matrix
                result.update(matches=reg.matches, alignRmsPx=round(reg.rms_px, 3), alignMethod=reg.method)
        if matrix is not None:
            result["transform"] = np.round(matrix[:2], 8).tolist()
            sky_planes = [p - np.float32(m) for p, (m, _) in zip(planes, sky)]
            aligned = stacking.warp(sky_planes, matrix, shape)
            del sky_planes
            self._write_aligned(sid, fid, aligned)
            del aligned

        with self.lock:
            s = self.sessions[sid]
            frame = next(x for x in s["frames"] if x["rel"] == rel)
            if frame["size"] != f["size"]:
                return  # rewritten meanwhile: analysed again next time
            frame.update(result)
            frame.pop("error", None)
            if not s["header"]:
                s["header"] = header_fields(header)
            self._judge(s)
            self._maybe_switch_reference(s, frame, stars.xy, shape)
            s["dirty"] = True
            self.save(s)
            decision = frame["auto"]
        self.wake.set()
        log.info("frame %s #%d: background %d ADU, %d stars, HFR %s, FWHM %s, elongation %s, %s%s (%.1f s)",
                 f["target"], f["number"], info["backgroundAdu"], info["stars"], info["hfr"], result["fwhmPx"],
                 result["elongation"],
                 f"aligned ({result.get('matches', 'ref')} stars, {result.get('alignMethod', 'reference')})"
                 if "transform" in result else result.get("alignError"),
                 "" if decision[0] else f", rejected: {decision[1]}", time.time() - started)

    @staticmethod
    def _trails(rel: str, planes: list[np.ndarray], sky: list[tuple[float, float]], fwhm: float | None) -> list | None:
        """A7: the frame's trails on the preview grid; None when the scan failed (the backfill tries
        again): marking trails must never fail a frame's analysis."""
        try:
            return trails.detect(planes, sky, fwhm)
        except Exception:  # noqa: BLE001
            log.exception("trails %s", rel)
            return None

    def scan_trails(self, sid: str, rel: str) -> None:
        """A7 backfill: the trails of a frame analysed before they were marked, from the archive."""
        started = time.time()
        with self.lock:
            f = next(x for x in self.sessions[sid]["frames"] if x["rel"] == rel)
            size, fwhm = f["size"], f.get("fwhmPx")
        raw = self.archive.read(rel)
        header, offset = fits.parse_header(raw)
        pixels = fits.read_pixels(raw, header, offset)
        del raw
        planes = fits.channels(pixels, header)
        scale = pixels.shape[1] / planes[0].shape[1]
        del pixels
        found = trails.detect(planes, [analysis.background(p) for p in planes], fwhm / scale if fwhm else None)
        with self.lock:
            s = self.sessions[sid]
            frame = next((x for x in s["frames"] if x["rel"] == rel), None)
            if frame is None or frame["size"] != size or frame["state"] != "done":
                return
            frame["trails"] = found
            self.save(s)
        log.info("trails %s #%d: %d (backfill, %.1f s)", f["target"], f["number"], len(found), time.time() - started)

    # --- sky brightness and the sensor (R6, skyq.py) -------------------------------------------

    def _load_sensors(self) -> dict[str, dict]:
        try:
            with open(self.sensors_path) as f:
                return json.load(f)
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as e:
            log.error("sensor.json: %s", e)
            return {}

    def _save_sensors(self) -> None:
        tmp = self.sensors_path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.sensors, f, separators=(",", ":"))
        os.replace(tmp, self.sensors_path)

    def calibration_nights(self) -> dict[str, dict[str, list[str]]]:
        """Archived bias and dark frames by night: { night: { "Bias": [rel], "Dark": [rel] } }."""
        with self.archive.lock:
            rels = list(self.archive.files)
        out: dict[str, dict[str, list[str]]] = {}
        for rel in rels:
            parts = rel.split(os.sep)
            if len(parts) == 4 and parts[2] in ("Bias", "Dark") and parts[3].lower().endswith((".fit", ".fits")):
                out.setdefault(parts[1], {"Bias": [], "Dark": []})[parts[2]].append(rel)
        return out

    def _read_archived(self, rel: str) -> tuple[dict[str, str], np.ndarray]:
        raw = self.archive.read(rel)
        header, offset = fits.parse_header(raw)
        return header, fits.read_pixels(raw, header, offset)

    def measure_sensor(self, night: str) -> None:
        """Bias level, read noise (two bias frames) and dark current (a dark of the same gain and
        offset) of one night's calibration frames, kept in <data>/sensor.json by night."""
        started = time.time()
        files = self.calibration_nights()[night]
        bias = sorted(files["Bias"])[:2]
        header, a = self._read_archived(bias[0])
        _, b = self._read_archived(bias[1])
        dark = dark_s = None
        used = list(bias)
        if files["Dark"]:
            rel = sorted(files["Dark"])[0]
            dark_header, pixels = self._read_archived(rel)
            if all(fits.number(dark_header, k) == fits.number(header, k) for k in ("GAIN", "OFFSET")):
                dark, dark_s = pixels, fits.number(dark_header, "EXPTIME")
                used.append(rel)
        record = skyq.sensor_noise(a, b, header, dark, dark_s)
        record.update(night=night, files=[r.replace(os.sep, "/") for r in used], darkExposureS=dark_s,
                      measuredAt=time.time())
        with self.lock:
            self.sensors[night] = record
            self._save_sensors()
        log.info("sensor %s: gain %s offset %s, bias %.1f ADU, read noise %.2f e- (%.2f ADU), dark current %s e-/s (%.1f s)",
                 night, record["gain"], record["offset"], record["biasAdu"], record["readNoiseE"] or 0,
                 record["readNoiseAdu"], record["darkCurrentEps"], time.time() - started)

    def sensor_for(self, gain: float | None, offset: float | None, night: str | None = None) -> dict | None:
        """The sensor measurement for a gain (and offset, when known) from the night nearest `night`
        (else the newest)."""
        def days(n: str) -> int:
            return datetime.strptime(n, "%Y-%m-%d").toordinal()

        found = [(n, r) for n, r in self.sensors.items()
                 if r.get("readNoiseE") is not None and r.get("gain") == gain
                 and (offset is None or r.get("offset") == offset)]
        if not found:
            return None
        if night is None:
            return max(found)[1]
        return min(found, key=lambda nr: (abs(days(nr[0]) - days(night)), nr[0]))[1]

    def _skyq(self, rel: str, f: dict, plane: np.ndarray, header: dict[str, str], plate: fits.Wcs | None,
              scale: float, step: int, fwhm: float | None) -> dict:
        """A frame's `skyq` record (skyq.measure); never fails the frame's analysis. Without a sensor
        measurement it notes how many nights were measured, so the backfill tries again only after
        another one."""
        try:
            sensor = self.sensor_for(fits.number(header, "GAIN"), fits.number(header, "OFFSET"),
                                     night_of(f["savedAt"], self.tz))
            record = skyq.measure(plane, header, plate, scale, step, sensor, self.catalog, fwhm)
        except Exception as e:  # noqa: BLE001
            log.exception("sky brightness %s", rel)
            return {"error": f"{type(e).__name__}: {e}"[:200]}
        if record.get("needs") == "sensor":
            record["sensors"] = len(self.sensors)
        return record

    def _needs_sky(self, f: dict) -> bool:
        """A frame to measure from the archive: never measured (once a sensor measurement for its gain
        exists), measured before its plate solve came, or before a sensor measurement of its gain."""
        if f["state"] != "done" or not self.archive.has(f["rel"], f["size"]):
            return False
        record = f.get("skyq")
        needs = record.get("needs") if record else "sensor"
        if needs == "solve":
            return bool(f.get("wcs"))
        if needs == "sensor":
            if record and record.get("sensors") == len(self.sensors):
                return False
            gain = (f.get("info") or {}).get("gain")
            return any(r.get("readNoiseE") is not None and r.get("gain") == gain for r in self.sensors.values())
        return False

    def measure_sky(self, sid: str, rel: str) -> None:
        """R6 backfill: a frame's zero point and sky brightness from the archive."""
        started = time.time()
        with self.lock:
            f = dict(next(x for x in self.sessions[sid]["frames"] if x["rel"] == rel))
        header, pixels = self._read_archived(rel)
        step = skyq.adu_step(pixels)
        planes = fits.channels(pixels, header)
        scale = pixels.shape[1] / planes[0].shape[1]
        del pixels
        plane = planes[1] if len(planes) == 3 else planes[0]
        fwhm = f.get("fwhmPx")
        record = self._skyq(rel, f, plane, header, fits.Wcs.from_json(f.get("wcs")), scale, step,
                            fwhm / scale if fwhm else None)
        with self.lock:
            s = self.sessions[sid]
            frame = next((x for x in s["frames"] if x["rel"] == rel), None)
            if frame is None or frame["size"] != f["size"] or frame["state"] != "done":
                return
            frame["skyq"] = record
            self.save(s)
        log.info("sky %s #%d: %s mag/arcsec², zero point %s, %s stars%s (backfill, %.2f s)", f["target"], f["number"],
                 record.get("skyMag"), record.get("zeroPoint"), record.get("stars"),
                 f", {record['error']}" if record.get("error") else "", time.time() - started)

    def _write_aligned(self, sid: str, fid: str, aligned: np.ndarray) -> None:
        folder = os.path.join(self.cache, sid)
        os.makedirs(folder, exist_ok=True)
        tmp = os.path.join(folder, f".{fid}.npy")
        # float16 tops out at 65504: saturated star cores (up to 65535 ADU) would become inf and
        # poison the combine. NaN (outside the frame) passes through np.clip unchanged.
        np.save(tmp, np.clip(aligned, None, np.finfo(np.float16).max).astype(np.float16))
        os.replace(tmp, os.path.join(folder, f"{fid}.npy"))

    @staticmethod
    def _scores(s: dict) -> dict[str, float]:
        """Reference quality per analysed frame: stars / HFR, the stars capped at 1.25 × the session
        median so that artefacts counted as stars (a satellite trail) do not make a frame 'best'."""
        done = [f for f in s["frames"] if f["state"] == "done"]
        median = float(np.median([f["info"]["stars"] for f in done])) if done else 0.0
        return {f["rel"]: min(f["info"]["stars"], 1.25 * median) / f["info"]["hfr"] if f["info"]["hfr"] else 0.0
                for f in done}

    def _maybe_switch_reference(self, s: dict, frame: dict, xy: np.ndarray, shape) -> None:
        """Move the reference to a clearly better accepted frame early in the session: compose transforms."""
        if s.get("reference") in (None, frame["rel"]) or "transform" not in frame or not frame["auto"][0]:
            return
        aligned = [f for f in s["frames"] if f.get("transform")]
        ref = next((f for f in s["frames"] if f["rel"] == s["reference"]), None)
        if len(aligned) > REF_SWITCH_FRAMES or ref is None:
            return
        scores = self._scores(s)
        if scores[frame["rel"]] < REF_SWITCH_GAIN * scores.get(ref["rel"], 0.0) or len(xy) < rejection.MIN_STARS:
            return
        to_old = np.vstack([np.array(frame["transform"]), [0, 0, 1]])
        old_to_new = np.linalg.inv(to_old)
        for f in aligned:
            t = old_to_new @ np.vstack([np.array(f["transform"]), [0, 0, 1]])
            f["transform"] = np.round(t[:2], 8).tolist()
        frame["transform"] = np.eye(3)[:2].tolist()
        s.update(reference=frame["rel"], refStars=np.round(xy, 2).tolist(), refWcs=frame.get("wcs"),
                 refShape=list(shape))
        # Every aligned frame must be warped again onto the new grid.
        shutil.rmtree(os.path.join(self.cache, s["id"]), ignore_errors=True)
        log.info("session %s: reference is now #%d (score %.0f, was %.0f)", s["id"], frame["number"],
                 scores[frame["rel"]], scores.get(ref["rel"], 0.0))

    def _judge(self, s: dict) -> None:
        done = [f for f in s["frames"] if f["state"] == "done"]
        rows = [{"stars": f["info"]["stars"], "hfr": f["info"]["hfr"], "backgroundAdu": f["info"]["backgroundAdu"],
                 "elongation": f.get("elongation"), "guidingRmsArcsec": f.get("guidingRmsArcsec"),
                 "alignError": f.get("alignError")} for f in done]
        for f, (accepted, reason) in zip(done, rejection.judge(rows)):
            f["auto"] = [accepted, reason]

    @staticmethod
    def accepted(f: dict) -> bool:
        if f["state"] != "done":
            return False
        if f.get("manual") is not None:
            return bool(f["manual"]) and bool(f.get("transform"))
        return bool((f.get("auto") or [False])[0])

    # --- stacking ------------------------------------------------------------------------------

    def _aligned_path(self, sid: str, f: dict) -> str:
        return os.path.join(self.cache, sid, f"{f['id']}.npy")

    def _rewarp(self, s: dict, f: dict) -> None:
        raw = self.archive.read(f["rel"])
        header, offset = fits.parse_header(raw)
        planes = fits.channels(fits.read_pixels(raw, header, offset), header)
        del raw
        sky_planes = [p - np.float32(m) for p, m in zip(planes, f["bg"])]
        matrix = np.vstack([np.array(f["transform"]), [0, 0, 1]])
        self._write_aligned(s["id"], f["id"], stacking.warp(sky_planes, matrix, tuple(s["refShape"])))

    def combine(self, sid: str) -> None:
        started = time.time()
        with self.lock:
            s = self.sessions[sid]
            s["dirty"] = False
            self.last_combine[sid] = started
            frames = [dict(f) for f in s["frames"] if self.accepted(f)]
            done = [f for f in s["frames"] if f["state"] in ("done", "failed")]
            snapshot = {k: s.get(k) for k in ("id", "refShape", "target")}
        if not frames:
            with self.lock:
                s["stack"] = None
                self.save(s)
            return
        rewarped = 0
        for f in frames:
            if not os.path.exists(self._aligned_path(sid, f)):
                self._rewarp(snapshot, f)
                rewarped += 1
        os.utime(os.path.join(self.cache, sid))  # recently used, for the cache pruning
        arrays = [np.load(self._aligned_path(sid, f), mmap_mode="r") for f in frames]
        noise = np.median(np.array([f["noise"] for f in frames]), axis=0)
        mean, rejected = stacking.combine(arrays, noise)
        del arrays
        bg = np.median(np.array([f["bg"] for f in frames]), axis=0).astype(np.float32)
        image = mean + bg
        del mean
        folder = self.folder(sid)
        os.makedirs(folder, exist_ok=True)
        integration = sum(f["info"]["exposureS"] for f in frames)
        first = min(f["info"]["at"] for f in frames)
        cards = {"OBJECT": s["target"], "NCOMBINE": len(frames), "EXPTIME": float(integration),
                 "DATE-OBS": datetime.fromtimestamp(first, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
                 "BUNIT": "ADU", "STACKMTH": "superpixel debayer, sigma-clipped mean"}
        fits.write_float(os.path.join(folder, ".stack.fits"), image, cards)
        os.replace(os.path.join(folder, ".stack.fits"), os.path.join(folder, "stack.fits"))
        filled = np.where(np.isnan(image), np.nanmedian(image[::8, ::8], axis=(0, 1)), image)
        # Full plane size (no downscaling): the web app's viewer zooms it to 1:1 and beyond.
        large, small, width, height = fits.previews([filled[..., i] for i in range(filled.shape[2])], quality=92)
        del image, filled
        for name, data in (("stack.jpg", large), ("stack-small.jpg", small)):
            with open(os.path.join(folder, f".{name}"), "wb") as out:
                out.write(data)
            os.replace(os.path.join(folder, f".{name}"), os.path.join(folder, name))
        now = time.time()
        image_id = hashlib.sha1(f"{sid}|{now}|{len(frames)}".encode()).hexdigest()[:12]
        with self.lock:
            s = self.sessions[sid]
            accepted = len(frames)
            s["stack"] = {
                "frames": [f["id"] for f in frames],
                "accepted": accepted,
                "rejected": sum(1 for f in done if not self.accepted(f)),
                "integrationS": round(integration),
                "updatedAt": now,
                "width": width,
                "height": height,
                "imageId": image_id,
                "rejectedPixelsPct": round(float(np.mean(rejected)) * 100, 3),
            }
            self.save(s)
        log.info("stack %s: %d frames, %.0f s, %.2f %% of pixel values rejected, %d re-warped (%.1f s)",
                 sid, accepted, integration, float(np.mean(rejected)) * 100, rewarped, time.time() - started)
        self.prune_cache(keep=sid)

    def prune_cache(self, keep: str) -> None:
        """Aligned frames (and timelapses, in <session>/timelapse/) are rebuilt when missing: keep the
        recently used under the cap. The timelapse thread prunes too, so a folder may vanish meanwhile."""
        entries = []
        for sid in os.listdir(self.cache):
            if sid.startswith(".") or sid in CACHE_SHARED:
                continue  # ASTAP's working files (.solve), the inspector's and guide logs' results
            folder = os.path.join(self.cache, sid)
            try:
                size = sum(os.path.getsize(os.path.join(d, n)) for d, _, names in os.walk(folder) for n in names)
                entries.append((os.stat(folder).st_mtime, sid, size, folder))
            except OSError:
                continue
        total = sum(e[2] for e in entries)
        with self.lock:
            newest = self.ordered()[0]["id"] if self.sessions else None
        for _, sid, size, folder in sorted(entries):
            if total <= self.cache_max_bytes:
                break
            if sid in (keep, newest):
                continue
            shutil.rmtree(folder, ignore_errors=True)
            total -= size

    # --- manual decisions ----------------------------------------------------------------------

    def override(self, sid: str, fid: str, accepted: bool | None) -> dict | None:
        with self.lock:
            s = self.sessions.get(sid)
            f = next((x for x in s["frames"] if x.get("id") == fid and x["state"] == "done"), None) if s else None
            if f is None:
                return None
            f["manual"] = accepted
            s["dirty"] = True
            self.last_combine.pop(sid, None)
            self.save(s)
            entry = self.frame_json(f)
        self.wake.set()
        return entry

    def reprocess(self, sid: str) -> bool:
        """Analyse, align and stack a session again from the archive (manual decisions stay)."""
        with self.lock:
            s = self.sessions.get(sid)
            if s is None:
                return False
            for f in s["frames"]:
                self._reset_frame(f)
                self.retry_at.pop(f["rel"], None)
            s.update(reference=None, refStars=None, refWcs=None, stack=None, dirty=False)
            self.save(s)
        shutil.rmtree(os.path.join(self.cache, sid), ignore_errors=True)
        self.wake.set()
        return True

    # --- output --------------------------------------------------------------------------------

    def recent_infos(self, limit: int) -> list[dict]:
        out = []
        with self.lock:
            for s in self.ordered():
                out += [f["info"] for f in s["frames"] if f["state"] == "done"]
                if len(out) >= limit:
                    break
        return sorted(out, key=lambda i: i["at"], reverse=True)[:limit]

    def session_of(self, rel: str) -> str | None:
        with self.lock:
            return self.by_rel.get(rel)

    def stack_json(self, s: dict) -> dict | None:
        stack = s.get("stack")
        if not stack:
            return None
        return {"sessionId": s["id"], "target": s["target"], "accepted": stack["accepted"],
                "rejected": stack["rejected"], "integrationS": stack["integrationS"],
                "updatedAt": stack["updatedAt"], "width": stack["width"], "height": stack["height"],
                "imageId": stack["imageId"]}

    def current_stack(self, preferred: str | None) -> dict | None:
        with self.lock:
            if preferred and preferred in self.sessions and self.sessions[preferred].get("stack"):
                return self.stack_json(self.sessions[preferred])
            for s in self.ordered():
                if s.get("stack"):
                    return self.stack_json(s)
        return None

    def stack_image(self, sid: str) -> dict | None:
        """Contract 1 for kind `stack`: the stack's full-resolution image, plate solution, histogram."""
        with self.lock:
            s = self.sessions.get(sid)
            if s is None or not s.get("stack"):
                return None
            stack = dict(s["stack"])
            solution = stack_wcs(s)
            source = stack_solve_source(s) if solution else None
            scale = pixel_scale(s, solution)
            frame_at = {f["id"]: f["info"]["at"] for f in s["frames"] if f.get("info")}
            target = s["target"]
        path = os.path.join(self.folder(sid), "stack.fits")
        histogram, stats = self._stack_numbers(sid, stack["imageId"], path)
        version = f"?v={stack['imageId']}"
        return {
            "kind": "stack",
            "id": sid,
            "target": target,
            "width": stack["width"],
            "height": stack["height"],
            "url": f"/stacks/{sid}.jpg{version}",
            "smallUrl": f"/stacks/{sid}-small.jpg{version}",
            "wcs": solution.cards() if solution else None,
            "rowsTopDown": True,
            "pixelScaleArcsec": r2(scale, 4),
            "solveSource": source,
            "histogram": histogram,
            "stats": stats,
            "takenAt": min((frame_at[i] for i in stack["frames"] if i in frame_at), default=None),
            "integrationS": stack["integrationS"],
            "frames": stack["accepted"],
            "measurable": os.path.exists(path),
        }

    def _stack_numbers(self, sid: str, image_id: str, path: str) -> tuple[dict | None, dict | None]:
        cached = self.stack_numbers.get(sid)
        if cached and cached[0] == image_id:
            return cached[1], cached[2]
        try:
            _, data, bscale, bzero = fits.open_image(path)
        except (OSError, ValueError):
            return None, None
        planes = [np.asarray(p, dtype=np.float32) * np.float32(bscale) + np.float32(bzero) for p in data]
        del data
        histogram, stats = images.describe(planes)
        self.stack_numbers[sid] = (image_id, histogram, stats)
        return histogram, stats

    def stack_star(self, sid: str, x: float, y: float) -> dict | None:
        """Contract 1's star measurement on the linear stack (the mean of its colour planes)."""
        with self.lock:
            s = self.sessions.get(sid)
            if s is None or not s.get("stack"):
                return None
            scale = pixel_scale(s, stack_wcs(s))
        try:
            _, data, bscale, bzero = fits.open_image(os.path.join(self.folder(sid), "stack.fits"))
        except (OSError, ValueError):
            return None
        y0, y1, x0, x1 = measure.region_around(data.shape, x, y)
        with np.errstate(invalid="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN pixels (no frame covers them)
            region = np.nanmean(np.asarray(data[:, y0:y1, x0:x1], dtype=np.float32) * bscale + bzero, axis=0)
        return measure.measure(region, x, y, origin=(x0, y0), saturation=analysis.SATURATED,
                               scale_arcsec=scale, linear=True)

    def alert_view(self, sid: str) -> dict | None:
        """What the notifications look at (alerts.py): the analysed frames in time order, the set
        point and the site."""
        with self.lock:
            s = self.sessions.get(sid)
            if s is None:
                return None
            done = sorted((f for f in s["frames"] if f["state"] == "done"), key=lambda f: f["info"]["at"])
            frames = [{"at": f["info"]["at"], "stars": f["info"]["stars"], "hfr": f["info"]["hfr"],
                       "size": f["size"]} for f in done]
            set_temps = [f["info"]["setTempC"] for f in done if f["info"].get("setTempC") is not None]
            site = (s.get("header") or {}).get("site")
        return {"frames": frames, "setTempC": set_temps[-1] if set_temps else None, "site": site}

    def summary(self, s: dict, active: str | None) -> dict:
        frames = s["frames"]
        judged = [f for f in frames if f["state"] in ("done", "failed")]
        accepted = [f for f in judged if self.accepted(f)]
        first = frames[0]
        start = first["info"]["at"] if first.get("info") else first["savedAt"] - first["exposureS"]
        header = s.get("header") or {}
        exposures = Counter(f["info"]["exposureS"] for f in frames if f.get("info"))
        rejected = [f for f in judged if not self.accepted(f)]
        guide = [f["guidingRmsArcsec"] for f in judged if f.get("guidingRmsArcsec") is not None]

        def median(values: list) -> float | None:
            present = [v for v in values if v is not None]
            return statistics.median(present) if present else None

        stars, background = median([f["info"]["stars"] for f in accepted]), median([f["info"]["backgroundAdu"] for f in accepted])
        return {
            "id": s["id"],
            "night": s["night"],
            "target": s["target"],
            "mode": s.get("mode"),
            "firstFrameAt": start,
            "lastFrameAt": frames[-1]["savedAt"],
            "frames": len(frames),
            "accepted": len(accepted),
            "rejected": len(judged) - len(accepted),
            "integrationS": round(sum(f["info"]["exposureS"] for f in accepted)),
            "active": s["id"] == active,
            "hasStack": bool(s.get("stack")),
            "ra": header.get("ra"),
            "dec": header.get("dec"),
            "exposureS": exposures.most_common(1)[0][0] if exposures else frames[-1]["exposureS"],
            "gain": header.get("gain"),
            # The filter in the train that night (header FILTER, else the FILTERS history): sky brightness and
            # flats depend on it.
            "filter": filters.on(s["night"], header.get("filter")),
            # D6 statistics without every detail: rejected exposure time, the accepted frames' medians, the
            # frames' guiding RMS during their exposures combined (quadratic mean), rejections by first reason.
            "rejectedS": round(sum((f.get("info") or {}).get("exposureS", f["exposureS"]) for f in rejected)),
            "hfr": r2(median([f["info"]["hfr"] for f in accepted])),
            "fwhmPx": r2(median([f.get("fwhmPx") for f in accepted])),
            "stars": None if stars is None else round(stars),
            "backgroundAdu": None if background is None else round(background),
            "guidingRmsArcsec": r2((sum(g * g for g in guide) / len(guide)) ** 0.5) if guide else None,
            "rejectReasons": dict(Counter(reject_kind(self.reason(f)) for f in rejected)),
            # R6: medians of the accepted frames' sky brightness (mag/arcsec²), zero point and sky e-/s per
            # pixel, and the read noise (e-) of the sensor measurement for its gain nearest its night.
            **self._sky_summary(s, accepted),
        }

    def list(self, active: str | None) -> list[dict]:
        with self.lock:
            return [self.summary(s, active) for s in self.ordered()]

    def reason(self, f: dict) -> str | None:
        """Why a judged frame is out of the stack, None when it is in."""
        auto = f.get("auto") or [False, None]
        if f["state"] == "failed":
            return f"unreadable: {f.get('error')}"
        if self.accepted(f):
            return None
        if f.get("manual") is False:
            return "rejected by hand" + (f" (also: {auto[1]})" if auto[1] else "")
        if f.get("manual") and not f.get("transform"):
            return f"not aligned: {f.get('alignError')}"
        return auto[1]

    def frame_json(self, f: dict) -> dict:
        info = f.get("info") or {}
        accepted = self.accepted(f)
        reason = self.reason(f)
        rotator = info.get("rotatorDeg")
        if rotator is None and (m := NAME_ANGLE.search(os.path.basename(f["rel"]))):
            rotator = float(m[1])
        return {
            "id": f.get("id"),
            "number": f["number"],
            "at": info.get("at", f["savedAt"] - f["exposureS"]),
            "exposureS": info.get("exposureS", f["exposureS"]),
            "backgroundAdu": info.get("backgroundAdu"),
            "stars": info.get("stars"),
            "hfr": info.get("hfr"),
            "fwhmPx": f.get("fwhmPx"),
            "elongation": f.get("elongation"),
            "guidingRmsArcsec": f.get("guidingRmsArcsec"),
            "accepted": accepted,
            "rejectReason": reason,
            "manual": f.get("manual") is not None,
            "aligned": bool(f.get("transform")),
            "sensorTempC": info.get("sensorTempC"),
            # Relative to the archive volume's root, "/"-separated; null until it is archived.
            "archivePath": f["rel"].replace(os.sep, "/") if self.archive.has(f["rel"], f["size"]) else None,
            "rotatorDeg": rotator,
            "focusPos": info.get("focusPos"),
            "solve": solve_state(f),
            # A7: [{x0, y0, x1, y1, widthPx}] on the preview grid; null until scanned.
            "trails": f.get("trails"),
            # R6: sky brightness (mag/arcsec², green against Gaia BP) and zero point (mag for 1 e-/s);
            # null until measured, or when it cannot be (no plate solve, too few catalogue stars).
            "skyMag": (f.get("skyq") or {}).get("skyMag"),
            "zeroPoint": (f.get("skyq") or {}).get("zeroPoint"),
        }

    def _sky_summary(self, s: dict, accepted: list[dict]) -> dict:
        def median(key: str) -> float | None:
            values = [(f.get("skyq") or {}).get(key) for f in accepted]
            values = [v for v in values if v is not None]
            return statistics.median(values) if values else None

        sensor = self.sensor_for((s.get("header") or {}).get("gain"), None, s["night"])
        sky_mag, zero_point, sky_eps = median("skyMag"), median("zeroPoint"), median("skyEps")
        return {
            "skyMag": r2(sky_mag),
            "zeroPoint": r2(zero_point, 3),
            "skyEps": None if sky_eps is None else round(sky_eps, 4),
            "readNoiseE": r2(sensor["readNoiseE"]) if sensor else None,
        }

    def _exposure(self, s: dict, summary: dict) -> dict | None:
        """R6: the sub length the session's sky asks for (skyq.advice), null before its sky is measured."""
        sensor = self.sensor_for((s.get("header") or {}).get("gain"), None, s["night"])
        if sensor is None:
            return None
        return skyq.advice(sensor["readNoiseE"], sensor.get("darkCurrentEps"), summary["skyEps"], summary["exposureS"])

    def detail(self, sid: str, active: str | None, live_plan: dict | None) -> dict | None:
        with self.lock:
            s = self.sessions.get(sid)
            if s is None:
                return None
            summary = self.summary(s, active)
            frames = [self.frame_json(f) for f in s["frames"] if f["state"] in ("done", "failed")]
            pending = sum(1 for f in s["frames"] if f["state"] == "pending")
            header = dict(s.get("header") or {})
            infos = [f["info"] for f in s["frames"] if f.get("info")]
            stack = self.stack_json(s)
            ordered = self.ordered()
            previous_end = max((x["frames"][-1]["savedAt"] for x in ordered
                                if x["frames"][-1]["savedAt"] < s["frames"][0]["savedAt"]), default=0)
            archived = [(f["rel"], f["size"]) for f in s["frames"]]
        archived = [size for rel, size in archived if self.archive.has(rel, size)]
        first, last = summary["firstFrameAt"], summary["lastFrameAt"]
        start = max(first - LEAD_S, previous_end)
        end = time.time() if summary["active"] else last + TRAIL_S
        records = self.journal.read(start - 6 * 3600, end)
        window = [r for r in records if r["t"] >= start]

        steps = [r for r in window if r["k"] == "guide"]
        total, ra, dec, samples = guiding_rms(steps)
        guiding = {
            "rmsArcsec": r2(total), "rmsRaArcsec": r2(ra), "rmsDecArcsec": r2(dec), "samples": samples,
            "history": downsample([[r["t"], r["ra"], r["dec"], r["s"]] for r in steps], GUIDE_POINTS),
            "events": [{"at": r["t"], "kind": r["e"]} for r in window if r["k"] == "gev"],
        }
        tel = [r for r in window if r["k"] == "tel"]

        def series(key: str) -> list:
            return downsample([[r["t"], r[key]] for r in tel if r.get(key) is not None], TELEMETRY_POINTS)

        set_temps = [i["setTempC"] for i in infos if i.get("setTempC") is not None]
        telemetry = {
            "sensorTempC": series("sensor"),
            "setTempC": set_temps[-1] if set_temps else None,
            "coolerPowerPct": series("cooler"),
            "boardTempC": series("board"),
            "wifiDbm": series("wifi"),
            "underVoltage": any(r.get("uv") for r in tel),
        }
        logs = self.logs_between(first - LEAD_S, last + TRAIL_S)
        return {
            **summary,
            "camera": header.get("camera"),
            "focalLengthMm": header.get("focalLengthMm"),
            "site": header.get("site"),
            "plan": self._plan(s, summary, live_plan, logs, window),
            "frames": frames,
            "pending": pending,
            "stack": stack,
            "guiding": guiding,
            "timeline": self._timeline(frames, logs, records, start, end),
            "telemetry": telemetry,
            "autofocus": self._autofocus(start, end, window),
            "archive": {"frames": len(archived), "bytes": sum(archived)},
            "trails": trail_counts(frames),
            # R6: { readNoiseE, darkCurrentEps, skyEps, recommendedSubS, currentSubS, readNoiseShare, text }.
            "exposure": self._exposure(s, summary),
        }

    def _autofocus(self, start: float, end: float, window: list[dict]) -> list[dict]:
        """The auto focus runs in the session's window: from the Autorun logs; while the run's log
        is not on the share yet, only when they ran (the live history's "Auto focus" activity)."""
        runs = [{**r, "source": "log"} for r in self.focus.between(start, end)]
        if runs:
            return runs
        acts = [r for r in window if r["k"] == "act"]
        out = []
        for i, r in enumerate(acts):
            if r["a"] == "Auto focus" and (i == 0 or acts[i - 1]["a"] != "Auto focus"):
                ended = next((x["t"] for x in acts[i + 1:] if x["a"] != "Auto focus"), None)
                out.append({"at": r["t"], "endedAt": ended, "night": None, "target": None, "reason": None,
                            "exposureS": None, "temperatureC": None, "success": None, "position": None,
                            "points": [], "bestSize": None, "failure": None, "source": "live"})
        return out

    def logs_between(self, start: float, end: float) -> list[autorun.Log]:
        out = []
        for rel, (size, _) in list(self.archive.files.items()):
            if not os.path.basename(rel).startswith("Autorun_Log_"):
                continue
            cached = self.logs.get(rel)
            if cached is None or cached[0] != size:
                try:
                    text = self.archive.read(rel).decode("utf-8", "replace")
                except OSError:
                    continue
                cached = (size, autorun.timeline(text, self.tz))
                self.logs[rel] = cached
            parsed = cached[1]
            if parsed and parsed.started_at <= end and parsed.ended_at >= start:
                out.append(parsed)
        return out

    @staticmethod
    def _plan(s: dict, summary: dict, live_plan: dict | None, logs: list, window: list) -> dict | None:
        if summary["active"] and live_plan and live_plan.get("target") == s["target"]:
            return {"planned": live_plan["targetTotal"], "current": live_plan["targetDone"],
                    "targetIndex": live_plan["targetIndex"], "targets": live_plan["targets"]}
        for parsed in logs:
            for t in parsed.targets:
                if t.name == s["target"] and t.started_at <= summary["lastFrameAt"] and (t.ended_at or 1e12) >= summary["firstFrameAt"]:
                    return {"planned": t.planned, "current": t.current, "targetIndex": t.index,
                            "targets": len(parsed.targets)}
        plans = [r for r in window if r["k"] == "plan" and r["target"] == s["target"]]
        if plans:
            p = plans[-1]
            return {"planned": p["total"], "current": p["done"], "targetIndex": p["index"], "targets": p["targets"]}
        return None

    @staticmethod
    def _timeline(frames: list[dict], logs: list, records: list[dict], start: float, end: float) -> list[dict]:
        events: list[dict] = []
        if logs:
            for parsed in logs:
                events += [{"at": at, "kind": kind, "text": text} for at, kind, text in parsed.events if start <= at <= end]
        else:
            previous_plan = None
            for r in records:
                inside = start <= r["t"] <= end
                if r["k"] == "act" and inside and r["a"] in TIMELINE_ACTIVITIES:
                    events.append({"at": r["t"], "kind": TIMELINE_ACTIVITIES[r["a"]], "text": r["a"]})
                elif r["k"] == "plan":
                    if inside:
                        if previous_plan is None or r["t"] - previous_plan["t"] > 1800:
                            events.append({"at": r["t"], "kind": "plan_start", "text": "Plan running"})
                        if previous_plan is None or previous_plan["target"] != r["target"] or r["t"] - previous_plan["t"] > 1800:
                            of = f" ({r['index']} of {r['targets']})" if r.get("targets") else ""
                            events.append({"at": r["t"], "kind": "target_start", "text": f"Target {r['target']}{of}"})
                        if r["ended"] and not (previous_plan and previous_plan["ended"]):
                            events.append({"at": r["t"], "kind": "plan_end", "text": "Plan finished"})
                    previous_plan = r
        lost_at = 0.0
        for r in records:
            if r["k"] == "gev" and r["e"] == "lost" and start <= r["t"] <= end:
                if r["t"] - lost_at > 300:
                    events.append({"at": r["t"], "kind": "guiding_lost", "text": "Guide star lost"})
                lost_at = r["t"]
        for f in frames:
            state = "accepted" if f["accepted"] else f"rejected: {f['rejectReason']}"
            events.append({"at": f["at"], "kind": "frame", "text": f"#{f['number']} {f['exposureS']:g} s {state}"})
        return sorted(events, key=lambda e: e["at"])


def date_obs(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        return None


def header_fields(header: dict[str, str]) -> dict:
    ra = fits.number(header, "RA")
    if ra is None:
        ra = fits.angle(header.get("OBJCTRA"), hours=True)
    dec = fits.number(header, "DEC")
    if dec is None:
        dec = fits.angle(header.get("OBJCTDEC"))
    lat, lon = fits.angle(header.get("SITELAT")), fits.angle(header.get("SITELONG"))
    return {
        "gain": fits.number(header, "GAIN"),
        "camera": header.get("INSTRUME"),
        "filter": (header.get("FILTER") or "").strip() or None,
        "focalLengthMm": fits.number(header, "FOCALLEN"),
        "pixelSizeUm": fits.number(header, "XPIXSZ"),
        "ra": r2(ra, 5),
        "dec": r2(dec, 5),
        "site": {"lat": r2(lat, 5), "lon": r2(lon, 5)} if lat is not None and lon is not None else None,
    }


def stack_wcs(s: dict) -> fits.Wcs | None:
    """The live stack's plate solution (FITS terms of stack.fits, rows top-down as displayed).

    The stack is on the reference frame's plane grid: the reference's ASIAIR solve moved to the
    superpixel grid (fits.Wcs.plane: CD × 2, CRPIX (c + 0.5)/2). Without a solve of the reference
    (Live frames, a failed solve), the first aligned frame that has one, carried through its
    transform onto the reference grid (fits.Wcs.through). None when no frame is solved."""
    scale = s.get("refScale") or 2.0
    reference = fits.Wcs.from_json(s.get("refWcs"))
    if reference:
        return reference.plane(scale)
    frames = [f for f in s["frames"] if f.get("transform") and f.get("wcs")]
    frames.sort(key=lambda f: not Store.accepted(f))
    for f in frames:
        matrix = np.vstack([np.array(f["transform"]), [0, 0, 1]])
        return fits.Wcs.from_json(f["wcs"]).plane(scale).through(matrix)
    return None


def solve_state(f: dict) -> dict | None:
    """A frame's plate solve for the API: `source` asiair (its header) or astap (our own), when, or
    why not (source null with the error). Frames analysed before ASTAP have no record."""
    record = f.get("solve")
    if record:
        return {"source": record["source"], "at": record["at"], "error": record["error"]}
    return {"source": "asiair", "at": None, "error": None} if f.get("wcs") else None


def stack_solve_source(s: dict) -> str | None:
    """Who solved the frame that stack_wcs takes the stack's solution from."""
    frames = [f for f in s["frames"] if f.get("wcs")]
    if s.get("refWcs"):
        frames = [f for f in frames if f["rel"] == s.get("reference")]
    else:
        frames = sorted((f for f in frames if f.get("transform")), key=lambda f: not Store.accepted(f))
    return (solve_state(frames[0]) or {}).get("source") if frames else None


def pixel_scale(s: dict, solution: fits.Wcs | None) -> float | None:
    """Arcseconds per stack pixel: from the plate solve, else the header's pixel size and focal length."""
    if solution:
        return solution.pixel_scale_arcsec()
    header = s.get("header") or {}
    if header.get("pixelSizeUm") and header.get("focalLengthMm"):
        return 206.265 * header["pixelSizeUm"] / header["focalLengthMm"] * (s.get("refScale") or 2.0)
    return None


def trail_counts(frames: list[dict]) -> dict:
    """A7 in the session detail: frames scanned for trails, frames with trails, trails."""
    scanned = [f["trails"] for f in frames if f.get("trails") is not None]
    return {"scanned": len(scanned), "frames": sum(1 for t in scanned if t), "count": sum(len(t) for t in scanned)}
