"""Session timelapses (B4): every analysed frame on the session's grid, and the stack growing.

Two sequences per session, built on request in a background thread of their own (nice 19, one build
at a time) and kept in the disposable cache next to the aligned frames, <cache>/<id>/timelapse/:

    frames/<key>.jpg          every analysed frame (rejected ones included) warped onto the reference
                              grid, with one fixed stretch for the whole sequence: the reference
                              frame's, so clouds, moon and dawn show as brightness changes
    stack/<key>.jpg           the running mean of the accepted frames in time order (not the final
                              stack's sigma clipping), each step stretched like the live stack preview
    frames-<key>.webp, stack-<key>.webp   the same as animated WebPs with a caption, for download
    index.json                the steps as built

A step's key hashes everything its picture depends on (reference, frame, transform, sky level; for the
stack every frame before it too), so a rebuild only renders steps whose key changed: new frames of a
running session add steps at the end, a manual decision re-renders the stack from that frame on. The
pictures are therefore immutable per URL. Frames that did not align are placed by their
plate solve, else like the nearest aligned frame at the same camera angle (marked `placement`).
A reference change or a reprocess wipes <cache>/<id>/ (and with it the timelapse); the cache pruning
counts the timelapse with the session's aligned frames.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from datetime import datetime
from typing import Callable

import numpy as np
from PIL import Image, ImageDraw, ImageFont

import fits
import register
import stacking

log = logging.getLogger("timelapse")

KINDS = ("frames", "stack")
VERSION = 1  # part of every key: a change in rendering rebuilds everything
WIDTH = 1024  # JPEG width (the 1504 px superpixel grid scaled down; never up)
JPEG_QUALITY = 85
WEBP_QUALITY = 70
WEBP_METHOD = 4
WEBP_FRAME_MS = 125  # 8 steps per second
# Sessions with more frames show this many evenly spaced steps (the stack still adds every frame).
MAX_STEPS = 300
# While a session is imaged (or still has frames waiting) a stale timelapse is rebuilt at most this often.
REBUILD_S = 300
# A failed build is tried again after this long.
RETRY_S = 600
NICE = 19
# The Frames stretch: the black point at least this fraction of the reference frame's sky below it
# (the screen stretch puts it 2.8σ below, where a sky 30 % brighter is already white). Tried on real
# sessions: 0.05 flattens the nebula of a clear frame, 0.025 keeps it and still grades dusk to dawn.
SKY_HEADROOM = 0.025
BACKGROUND_TARGET = 0.2  # where the reference sky lands, as in the previews
KEY = re.compile(r"^[0-9a-f]{12}$")
F16_MAX = np.finfo(np.float16).max


def digest(*parts) -> str:
    return hashlib.sha1("|".join(json.dumps(p, separators=(",", ":")) for p in parts).encode()).hexdigest()[:12]


def spaced(n: int, limit: int) -> list[int]:
    """Indices of at most `limit` evenly spaced items of n, always including the first and the last."""
    if n <= limit:
        return list(range(n))
    return sorted({round(i * (n - 1) / (limit - 1)) for i in range(limit)})


def plan(s: dict, decide: Callable[[dict], dict], accepted: Callable[[dict], bool]) -> dict | None:
    """What a session's timelapse consists of now (cheap: no pixels). `decide(frame)` gives the frame's
    `accepted`, `rejectReason` and `rotatorDeg` as in the session detail; `accepted(frame)` whether it is
    in the stack. None while the session has no reference grid.

    Returns { reference, shape, frames: [step], stack: [step], keys: {kind: signature} }; a step has
    the frame's index fields, its `key`, the `matrix` (frame → reference) and how it was placed."""
    ref_rel, shape = s.get("reference"), s.get("refShape")
    ref = next((f for f in s["frames"] if f["rel"] == ref_rel and f.get("id") and f.get("bg")), None)
    if ref is None or not shape:
        return None
    done = sorted((f for f in s["frames"] if f["state"] == "done" and f.get("info") and f.get("bg")),
                  key=lambda f: (f["info"]["at"], f["number"]))
    decisions = {f["rel"]: decide(f) for f in done}
    aligned = [f for f in done if f.get("transform")]
    ref_wcs = fits.Wcs.from_json(s.get("refWcs"))
    base = [VERSION, WIDTH, JPEG_QUALITY, ref_rel, ref["id"], ref["bg"], shape]

    frames = []
    for f in done:
        d = decisions[f["rel"]]
        if f.get("transform"):
            matrix, placement = f["transform"], "aligned"
        elif f.get("wcs") and ref_wcs:
            guess = register.wcs_guess(fits.Wcs.from_json(f["wcs"]), ref_wcs, tuple(shape), s.get("refScale") or 2.0)
            matrix, placement = np.round(guess[:2], 6).tolist(), "plateSolve"
        else:
            # The mount points where it did for the frames around it; after a meridian flip the camera
            # angle tells the sides apart.
            same = [a for a in aligned if decisions[a["rel"]]["rotatorDeg"] == d["rotatorDeg"]] or aligned
            if not same:
                continue
            near = min(same, key=lambda a: abs(a["info"]["at"] - f["info"]["at"]))
            matrix, placement = near["transform"], "neighbour"
        frames.append({"frameId": f["id"], "number": f["number"], "at": f["info"]["at"],
                       "accepted": d["accepted"], "rejectReason": d["rejectReason"], "placement": placement,
                       "rel": f["rel"], "bg": f["bg"], "matrix": matrix, "cached": placement == "aligned",
                       "key": digest("frames", *base, SKY_HEADROOM, BACKGROUND_TARGET, f["id"], matrix, f["bg"])})
    frames = [frames[i] for i in spaced(len(frames), MAX_STEPS)]

    stack, chain, integration = [], digest("stack", *base), 0.0
    members = [f for f in aligned if accepted(f)]
    shown = set(spaced(len(members), MAX_STEPS))
    for i, f in enumerate(members):
        chain = digest(chain, f["id"], f["transform"])
        integration += f["info"]["exposureS"]
        stack.append({"frameId": f["id"], "number": f["number"], "at": f["info"]["at"], "accepted": True,
                      "rejectReason": None, "frames": i + 1, "integrationS": round(integration),
                      "rel": f["rel"], "bg": f["bg"], "matrix": f["transform"], "cached": True,
                      "key": chain, "shown": i in shown})
    keys = {
        "frames": digest([(x["key"], x["accepted"], x["rejectReason"]) for x in frames]),
        "stack": digest([x["key"] for x in stack if x["shown"]]),
    }
    return {"reference": ref, "shape": shape, "frames": frames, "stack": stack, "keys": keys}


def public_steps(kind: str, steps: list[dict]) -> list[dict]:
    """Index entries of steps that have a picture, numbered from 0."""
    fields = ("frameId", "number", "at", "accepted", "rejectReason") + (
        ("placement",) if kind == "frames" else ("frames", "integrationS"))
    return [dict({k: x[k] for k in fields}, step=i, key=x["key"]) for i, x in enumerate(steps)]


def picture_size(shape) -> tuple[int, int]:
    """Width and height of the pictures for a reference grid of (height, width)."""
    h, w = shape[0], shape[1]
    width = min(WIDTH, w)
    return width, round(h * width / w)


def fixed_params(sample: np.ndarray) -> tuple[float, float, float | None]:
    """The Frames sequence's stretch of one channel from the reference frame's pixels (sky included):
    the preview's screen stretch with the black point SKY_HEADROOM of the sky below it, so a sky up to
    a few times brighter (clouds lit, moon, dawn) still shows how much brighter instead of white."""
    black, top, _ = fits.stretch_params(sample, BACKGROUND_TARGET)
    median = float(np.median(sample))
    black = min(black, median * (1 - SKY_HEADROOM))
    m0 = (median - black) / (top - black)
    if not 0 < m0 < 1:
        return black, top, None
    t = BACKGROUND_TARGET
    return black, top, m0 * (t - 1) / ((2 * t - 1) * m0 - t)


def to_rgb(planes: np.ndarray, params: list) -> Image.Image:
    """(H, W, C) float32 through per-channel stretch parameters → an RGB (or grey) picture, WIDTH wide."""
    out = np.empty(planes.shape, np.uint8)
    for c in range(planes.shape[2]):
        out[..., c] = (np.clip(fits.apply_stretch(planes[..., c], params[c]), 0, 1) * 255 + 0.5).astype(np.uint8)
    image = Image.fromarray(out if out.shape[2] == 3 else out[..., 0])
    size = picture_size(planes.shape)
    if image.size != size:
        image = image.resize(size, Image.Resampling.LANCZOS)
    return image.convert("RGB")


def jpeg(image: Image.Image, path: str) -> None:
    image.save(path + ".tmp", format="JPEG", quality=JPEG_QUALITY)
    os.replace(path + ".tmp", path)


class Captioned:
    """The step JPEGs as one multi-frame image for Pillow's animated WebP writer, decoded and captioned
    one at a time (Pillow 13's writer asks only for n_frames, seek, mode and getim), so memory holds one
    picture rather than all of them."""

    mode = "RGB"

    def __init__(self, paths: list[str], captions: list[tuple[str, str | None]]):
        self.paths, self.captions, self.n_frames = paths, captions, len(paths)
        self.font = ImageFont.load_default(size=22)
        self.current: Image.Image | None = None

    def picture(self, i: int) -> Image.Image:
        with Image.open(self.paths[i]) as f:
            image = f.convert("RGB")
        text, warning = self.captions[i]
        bar = 34 if not warning else 62
        box = (0, image.height - bar, image.width, image.height)
        image.paste(image.crop(box).point(lambda v: v // 4), box)
        draw = ImageDraw.Draw(image)
        draw.text((12, image.height - bar + 6), text, font=self.font, fill=(235, 235, 235))
        if warning:
            draw.text((12, image.height - 30), warning[:90], font=self.font, fill=(255, 120, 110))
        return image

    def seek(self, i: int) -> None:
        self.current = self.picture(i)

    def getim(self):
        return self.current.getim()


class Timelapse:
    def __init__(self, store, active: Callable[[], str | None]):
        self.store, self.active = store, active
        self.lock = threading.Lock()
        self.wake = threading.Event()
        self.queue: list[str] = []
        self.building: str | None = None
        self.progress: dict | None = None
        self.failed: dict[str, tuple[float, str]] = {}  # session → (when, error)
        self.indexes: dict[str, tuple[float, dict]] = {}  # session → (index.json mtime, index)
        self.warped = 0

    # --- files -----------------------------------------------------------------------------------

    def folder(self, sid: str) -> str:
        return os.path.join(self.store.cache, sid, "timelapse")

    def image_path(self, sid: str, kind: str, key: str) -> str | None:
        return os.path.join(self.folder(sid), kind, f"{key}.jpg") if KEY.match(key) else None

    def webp_path(self, sid: str, kind: str, key: str) -> str:
        return os.path.join(self.folder(sid), f"{kind}-{key}.webp")

    def index(self, sid: str) -> dict | None:
        path = os.path.join(self.folder(sid), "index.json")
        try:
            mtime = os.stat(path).st_mtime
            cached = self.indexes.get(sid)
            if cached and cached[0] == mtime:
                return cached[1]
            with open(path) as f:
                index = json.load(f)
        except (OSError, ValueError):
            self.indexes.pop(sid, None)
            return None
        if index.get("version") != VERSION:
            return None
        self.indexes[sid] = (mtime, index)
        return index

    def webp(self, sid: str, kind: str, key: str | None) -> tuple[str, str] | None:
        """An animated WebP (the named version, else the current one) and a download name."""
        if key is None:
            entry = (self.index(sid) or {}).get(kind)
            if not entry or not entry.get("webpBytes"):
                return None
            key = entry["key"]
        elif not KEY.match(key):
            return None
        return self.webp_path(sid, kind, key), f"{sid}-{kind}.webp"

    # --- status ----------------------------------------------------------------------------------

    def plan(self, sid: str) -> tuple[dict, dict | None, bool] | None:
        active = self.active()
        store = self.store
        with store.lock:
            s = store.sessions.get(sid)
            if s is None:
                return None
            p = plan(s, store.frame_json, store.accepted)
            busy = sid == active or any(f["state"] == "pending" for f in s["frames"])
            return {"target": s["target"], "night": s["night"]}, p, busy

    def status(self, sid: str) -> dict | None:
        """The index and build state; asks for a build when the timelapse is missing or out of date."""
        planned = self.plan(sid)
        if planned is None:
            return None
        session, p, busy = planned
        index = self.index(sid)
        now = time.time()
        stale = p is not None and bool(p["frames"]) and (
            index is None or any((index.get(k) or {}).get("key") != p["keys"][k] for k in KINDS))
        next_at = None
        with self.lock:
            if sid == self.building:
                state = "building"
            elif sid in self.queue:
                state = "queued"
            elif p is None or not p["frames"]:
                state = "unavailable"
            elif not stale:
                state = "ready"
            elif sid in self.failed and self.failed[sid][0] > now - RETRY_S:
                state = "failed"
                next_at = self.failed[sid][0] + RETRY_S
            elif busy and index and index.get("builtAt", 0) > now - REBUILD_S:
                state = "waiting"
                next_at = index["builtAt"] + REBUILD_S
            else:
                self.queue.append(sid)
                self.wake.set()
                state = "queued"
            progress = dict(self.progress) if sid == self.building and self.progress else None
            error = self.failed[sid][1] if state == "failed" else None
        out = {"sessionId": sid, "target": session["target"], "state": state, "stale": stale,
               "progress": progress, "error": error, "nextBuildAt": next_at, "frameMs": WEBP_FRAME_MS}
        for field in ("builtAt", "width", "height", "bytes"):
            out[field] = index.get(field) if index else None
        for kind in KINDS:
            entry = (index or {}).get(kind)
            if not entry:
                out[kind] = None
                continue
            steps = [dict({k: v for k, v in x.items() if k != "key"}, url=f"/timelapse/{sid}/{kind}/{x['key']}.jpg")
                     for x in entry["steps"]]
            out[kind] = {"steps": steps, "webpBytes": entry.get("webpBytes"),
                         "webpUrl": f"/timelapse/{sid}/{kind}.webp?v={entry['key']}" if entry.get("webpBytes") else None}
        return out

    # --- building --------------------------------------------------------------------------------

    def start(self) -> None:
        threading.Thread(target=self.run, name="timelapse", daemon=True).start()

    def run(self) -> None:
        try:
            # Below the worker and the HTTP threads: a running session's frames go first.
            os.setpriority(os.PRIO_PROCESS, threading.get_native_id(), NICE)
        except OSError as e:
            log.warning("nice: %s", e)
        while True:
            self.wake.wait(60)
            self.wake.clear()
            while True:
                with self.lock:
                    if not self.queue:
                        break
                    sid = self.building = self.queue.pop(0)
                    self.progress = None
                try:
                    self.build(sid)
                    with self.lock:
                        self.failed.pop(sid, None)
                except Exception as e:  # noqa: BLE001 - one session's failure must not stop the thread
                    log.exception("timelapse %s", sid)
                    with self.lock:
                        self.failed[sid] = (time.time(), f"{type(e).__name__}: {e}"[:200])
                finally:
                    with self.lock:
                        self.building, self.progress = None, None

    def _progress(self, kind: str, done: int, total: int) -> None:
        with self.lock:
            self.progress = {"kind": kind, "done": done, "total": total}

    def _aligned(self, sid: str, ref_rel: str, ref_shape, step: dict) -> np.ndarray | None:
        """A frame on the reference grid ((H, W, C), sky-subtracted): from the aligned-frame cache, else
        warped from the archive (and put into the cache when it belongs there and nothing moved meanwhile)."""
        path = os.path.join(self.store.cache, sid, f"{step['frameId']}.npy")
        if step["cached"]:
            try:
                return np.load(path)
            except (OSError, ValueError):
                pass
        try:
            raw = self.store.archive.read(step["rel"])
        except OSError as e:
            log.warning("timelapse %s: %s", step["rel"], e)
            return None
        header, offset = fits.parse_header(raw)
        planes = fits.channels(fits.read_pixels(raw, header, offset), header)
        del raw
        sky = [p - np.float32(m) for p, m in zip(planes, step["bg"])]
        del planes
        matrix = np.vstack([np.array(step["matrix"]), [0, 0, 1]])
        aligned = np.clip(stacking.warp(sky, matrix, tuple(ref_shape)), None, F16_MAX).astype(np.float16)
        del sky
        self.warped += 1
        if step["cached"]:
            # Not the worker's temporary name: both may write the same frame at once.
            tmp = os.path.join(os.path.dirname(path), f".{step['frameId']}.timelapse.npy")
            try:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                np.save(tmp, aligned)
                with self.store.lock:
                    # A reference change empties the cache under this lock: never put a frame warped
                    # onto the old grid back.
                    s = self.store.sessions.get(sid) or {}
                    frame = next((f for f in s.get("frames", []) if f.get("id") == step["frameId"]), None)
                    if s.get("reference") == ref_rel and frame and frame.get("transform") == step["matrix"]:
                        os.replace(tmp, path)
            except OSError as e:
                log.warning("timelapse cache %s: %s", path, e)
            finally:
                if os.path.exists(tmp):
                    os.remove(tmp)
        return aligned

    def build(self, sid: str) -> None:
        started = time.time()
        planned = self.plan(sid)
        if planned is None or planned[1] is None or not planned[1]["frames"]:
            return
        session, p, _ = planned
        ref, shape = p["reference"], p["shape"]
        old = self.index(sid) or {}
        folder = self.folder(sid)
        for kind in KINDS:
            os.makedirs(os.path.join(folder, kind), exist_ok=True)
        os.utime(os.path.join(self.store.cache, sid))  # recently used, for the cache pruning
        width, height = picture_size(shape)
        index = {"version": VERSION, "reference": ref["rel"], "builtAt": None, "width": width, "height": height,
                 "frames": old.get("frames"), "stack": old.get("stack")}
        rendered = {"frames": 0, "stack": 0}
        self.warped = 0

        # Frames: one stretch for all, the reference frame's (its sky added back like every frame's).
        steps = p["frames"]
        todo = [x for x in steps if not os.path.exists(self.image_path(sid, "frames", x["key"]))]
        params = None
        for n, x in enumerate(todo):
            self._progress("frames", n, len(todo))
            if params is None:
                ref_step = {"frameId": ref["id"], "rel": ref["rel"], "bg": ref["bg"], "cached": True,
                            "matrix": np.eye(3)[:2].tolist()}
                planes = self._aligned(sid, ref["rel"], shape, ref_step)
                if planes is None:
                    raise OSError("reference frame unavailable")
                sample = planes[::4, ::4].astype(np.float32) + np.asarray(ref["bg"], np.float32)
                params = [fixed_params(c[np.isfinite(c)]) for c in np.moveaxis(sample, -1, 0)]
                del planes, sample
            aligned = self._aligned(sid, ref["rel"], shape, x)
            if aligned is None:
                continue  # not in the archive (any more): left out
            planes = aligned.astype(np.float32) + np.asarray(x["bg"], np.float32)
            del aligned
            planes[np.isnan(planes)] = 0  # outside the frame: black
            jpeg(to_rgb(planes, params), self.image_path(sid, "frames", x["key"]))
            del planes
            rendered["frames"] += 1
        index["frames"] = self._entry(sid, "frames", steps, p["keys"]["frames"])
        self._write_index(sid, index)

        # Stack: running sum and count of the accepted frames in time order, a picture per shown step.
        steps = p["stack"]
        missing = [i for i, x in enumerate(steps) if x["shown"] and not os.path.exists(self.image_path(sid, "stack", x["key"]))]
        total = count = None
        bgs: list = []
        for i, x in enumerate(steps[: missing[-1] + 1] if missing else []):
            self._progress("stack", i, missing[-1] + 1)
            aligned = self._aligned(sid, ref["rel"], shape, x)
            if aligned is None:
                continue
            if total is None:
                total = np.zeros(aligned.shape, np.float32)
                count = np.zeros(aligned.shape, np.uint16)
            valid = ~np.isnan(aligned)
            total += np.where(valid, aligned, np.float32(0))
            count += valid
            del aligned, valid
            bgs.append(x["bg"])
            if i not in missing:
                continue
            with np.errstate(invalid="ignore", divide="ignore"):
                image = np.where(count > 0, total / count, np.float32(np.nan))
            # As the live stack's preview: the frames' median sky added back, uncovered pixels at the median.
            image += np.median(np.array(bgs), axis=0).astype(np.float32)
            filled = np.where(np.isnan(image), np.nanmedian(image[::8, ::8], axis=(0, 1)), image)
            del image
            params = [fits.stretch_params(filled[::4, ::4, c]) for c in range(filled.shape[2])]
            jpeg(to_rgb(filled, params), self.image_path(sid, "stack", x["key"]))
            del filled
            rendered["stack"] += 1
        del total, count
        index["stack"] = self._entry(sid, "stack", [x for x in steps if x["shown"]], p["keys"]["stack"])
        self._write_index(sid, index)

        # Animated WebPs with a caption on every step.
        for kind in KINDS:
            entry = index[kind]
            path = self.webp_path(sid, kind, entry["key"])
            if entry["steps"] and not os.path.exists(path):
                self._progress("webp", KINDS.index(kind), len(KINDS))
                paths = [self.image_path(sid, kind, x["key"]) for x in entry["steps"]]
                captions = [self._caption(session, kind, x) for x in entry["steps"]]
                first = Captioned(paths[:1], captions[:1]).picture(0)
                first.save(path + ".tmp", format="WEBP", save_all=True,
                           append_images=[Captioned(paths[1:], captions[1:])], duration=WEBP_FRAME_MS, loop=0,
                           quality=WEBP_QUALITY, method=WEBP_METHOD)
                os.replace(path + ".tmp", path)
            entry["webpBytes"] = os.path.getsize(path) if os.path.exists(path) else None
        index["builtAt"] = time.time()
        self._write_index(sid, index)
        self._clean(sid, index)
        self.store.prune_cache(keep=sid)
        log.info("timelapse %s: %d frames (%d rendered), %d stack steps (%d rendered), %d frames warped from the "
                 "archive, %.1f MB (%.1f s)", sid, len(index["frames"]["steps"]), rendered["frames"],
                 len(index["stack"]["steps"]), rendered["stack"], self.warped, index["bytes"] / 1e6,
                 time.time() - started)

    def _caption(self, session: dict, kind: str, x: dict) -> tuple[str, str | None]:
        at = datetime.fromtimestamp(x["at"], self.store.tz).strftime("%H:%M")
        if kind == "stack":
            minutes = x["integrationS"] / 60
            length = f"{minutes / 60:.1f} h" if minutes >= 90 else f"{minutes:.0f} min"
            return f"{session['target']}  {session['night']}  {at}  stack of {x['frames']} ({length})", None
        # The caption font has no × or ″.
        reason = (x["rejectReason"] or "not in the stack").replace("×", "x").replace("″", '"')
        warning = None if x["accepted"] else f"rejected: {reason}"
        return f"{session['target']}  {session['night']}  {at}  #{x['number']}", warning

    def _entry(self, sid: str, kind: str, steps: list[dict], key: str) -> dict:
        """The index entry of a kind: the steps whose picture is on disk (a frame missing from the archive
        is left out), the WebP if it is already there."""
        present = [x for x in steps if os.path.exists(self.image_path(sid, kind, x["key"]))]
        webp = self.webp_path(sid, kind, key)
        return {"key": key, "steps": public_steps(kind, present),
                "webpBytes": os.path.getsize(webp) if os.path.exists(webp) else None}

    def _write_index(self, sid: str, index: dict) -> None:
        index["bytes"] = sum(os.path.getsize(self.image_path(sid, k, x["key"])) for k in KINDS if index.get(k)
                             for x in index[k]["steps"]) + sum(index[k]["webpBytes"] or 0 for k in KINDS if index.get(k))
        path = os.path.join(self.folder(sid), "index.json")
        with open(path + ".tmp", "w") as f:
            json.dump(index, f, separators=(",", ":"))
        os.replace(path + ".tmp", path)

    def _clean(self, sid: str, index: dict) -> None:
        """Remove pictures and WebPs that the index no longer names."""
        folder = self.folder(sid)
        keep = {f"{k}-{index[k]['key']}.webp" for k in KINDS} | {"index.json"} | set(KINDS)
        for name in os.listdir(folder):
            if name not in keep:
                os.remove(os.path.join(folder, name))
        for kind in KINDS:
            names = {f"{x['key']}.jpg" for x in index[kind]["steps"]}
            for e in os.scandir(os.path.join(folder, kind)):
                if e.name not in names:
                    os.remove(e.path)
