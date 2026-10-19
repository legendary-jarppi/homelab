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
with a pause between files, so a running session's new frames never wait behind the backfill.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import threading
import time
from collections import Counter
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np

import analysis
import autorun
import fits
import register
import rejection
import stacking
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
# Live history around a session: before its first frame (GoTo, centering, auto focus) and after.
LEAD_S = 1800
TRAIL_S = 600
GUIDE_POINTS = 2000
TELEMETRY_POINTS = 500
TIMELINE_ACTIVITIES = {"Auto focus": "autofocus", "Meridian flip": "meridian_flip", "GoTo": "goto",
                       "Plate solving": "centering"}
# The camera angle in a frame's name: Light_M 31_180.0s_Bin1_20260903-021110_93deg_0001.fit.
NAME_ANGLE = re.compile(r"_(-?\d+(?:\.\d+)?)deg_")


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
                    "matches", "alignRmsPx", "alignMethod", "guidingRmsArcsec", "auto", "error"):
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
                self.wake.wait(30)
                self.wake.clear()
                continue
            kind, sid, rel, backfill = job
            try:
                if kind == "frame":
                    self.process(sid, rel)
                elif kind == "combine":
                    self.combine(sid)
                elif kind == "refresh":
                    self.refresh(sid, rel)
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
            if backfill:
                time.sleep(BACKFILL_PAUSE_S)

    def start(self) -> None:
        threading.Thread(target=self.run, name="worker", daemon=True).start()

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
            "backgroundAdu": round(rendered.background_adu),
            "stars": rendered.stars,
            "hfr": rendered.hfr,
            "width": rendered.width,
            "height": rendered.height,
        }
        scale = rendered.scale
        plate = fits.wcs(header)
        shape = luminance.shape
        result = {
            "state": "done", "id": fid, "info": info,
            "fwhmPx": r2(stars.fwhm * scale) if stars.fwhm else None,
            "elongation": r2(stars.elongation),
            "bg": [round(m, 2) for m, _ in sky], "noise": [round(n, 3) for _, n in sky],
            "wcs": plate.json() if plate else None,
            "guidingRmsArcsec": r2(guide_total),
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

    def _write_aligned(self, sid: str, fid: str, aligned: np.ndarray) -> None:
        folder = os.path.join(self.cache, sid)
        os.makedirs(folder, exist_ok=True)
        tmp = os.path.join(folder, f".{fid}.npy")
        np.save(tmp, aligned.astype(np.float16))
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
        large, small, width, height = fits.previews([filled[..., i] for i in range(filled.shape[2])])
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
        """Aligned frames are rebuilt from the archive when missing: keep the recently used under the cap."""
        entries = []
        for sid in os.listdir(self.cache):
            folder = os.path.join(self.cache, sid)
            size = sum(e.stat().st_size for e in os.scandir(folder) if e.is_file())
            entries.append((os.stat(folder).st_mtime, sid, size, folder))
        total = sum(e[2] for e in entries)
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
        }

    def list(self, active: str | None) -> list[dict]:
        with self.lock:
            return [self.summary(s, active) for s in self.ordered()]

    def frame_json(self, f: dict) -> dict:
        info = f.get("info") or {}
        auto = f.get("auto") or [False, None]
        accepted = self.accepted(f)
        if f["state"] == "failed":
            reason = f"unreadable: {f.get('error')}"
        elif accepted:
            reason = None
        elif f.get("manual") is False:
            reason = "rejected by hand" + (f" (also: {auto[1]})" if auto[1] else "")
        elif f.get("manual") and not f.get("transform"):
            reason = f"not aligned: {f.get('alignError')}"
        else:
            reason = auto[1]
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
        }

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
            "archive": {"frames": len(archived), "bytes": sum(archived)},
        }

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
        "focalLengthMm": fits.number(header, "FOCALLEN"),
        "ra": r2(ra, 5),
        "dec": r2(dec, 5),
        "site": {"lat": r2(lat, 5), "lon": r2(lon, 5)} if lat is not None and lon is not None else None,
    }
