"""Telescope: the cabin's ZWO ASIAIR imaging sessions, for the dashboard's Telescope tab and the
telescope web app.

Polls the ASIAIR's SMB shares (over the Site Magic VPN) and hands every light frame, calibration
frame and log to the worker in sessions.py (archive at home, previews, frame numbers, automatic
rejection, registration, live stack). Follows the ASIAIR's own control ports read only (live.py) for
what it is doing right now and records it (journal.py). Sends push notifications (imaging started,
finished, stopped here; clouds, dew, guiding, meridian flip, storage, cooling, power in alerts.py).
Keeps the integration goals per target (targets.py) and the web app's digest sent markers (notices.py).
Never changes anything on the ASIAIR.
Cluster-internal:
    GET  /api/status                               JSON (session, plan, live, stack, recent frames)
    GET  /api/sessions, /api/sessions/<id>         observing log: sessions, one session's report
    POST /api/sessions/<id>/frames/<frame id>      {"accepted": true|false|null}: manual decision
    POST /api/sessions/<id>/reprocess              analyse, align and stack again from the archive
    GET  /api/targets                              integration goals and wishlist per target
    PUT  /api/targets/<key>                        {"goalHours"?, "wishlist"?, "note"?}
    GET  /api/notices/<key>                        sent marker of a web app digest: {key, sentAt} or 404
    PUT  /api/notices/<key>                        {"sentAt": unix s}
    GET  /frames/<id>.jpg, /frames/<id>-small.jpg  frame previews (~1504 px, ~300 px)
    GET  /stacks/<id>.jpg, -small.jpg, .fits       the session's stack (the .jpg at full resolution)
    GET  /api/images/stack|upload/<id>             image metadata: full-resolution URL, plate solve, histogram
    GET  /api/images/stack|upload/<id>/star?x=&y=  the star nearest a click, measured on the linear data
    GET  /api/uploads, /api/uploads/<id>           the owner's own processed images (gallery)
    POST /api/uploads                              multipart: file, target, title?, note?, takenAt?, raHint?, decHint?
    PUT  /api/uploads/<id>                         {"target"?, "title"?, "note"?, "published"?, "takenAt"?}
    DELETE /api/uploads/<id>
    GET  /uploads/<id>.jpg, -small.jpg, /<id>/original   an upload: display JPEG, 600 px, the file as uploaded
    GET  /api/focus                                every archived auto focus run (V-curve, temperature, result)
    GET  /api/guidelogs, /api/guidelogs/<id>       PHD2 guide logs: RMS; sections, periodic error, Dec drift, backlash
    GET  /api/sessions/<id>/timelapse              B4: timelapse index and build state (asks for a build)
    GET  /timelapse/<id>/frames|stack/<key>.jpg    a timelapse step; .../frames|stack.webp the animation
    GET  /api/sessions/<id>[/frames/<frame id>]/inspect   A6: tilt and backfocus (3×3 grid), session or frame
    GET  /frames/<id>-inspect.jpg                  A6: the frame's nine 1:1 corner/edge/centre crops
    GET  /metrics                                  Prometheus
    GET  /healthz
"""

from __future__ import annotations

import email.message
import json
import logging
import math
import os
import re
import shutil
import signal
import threading
import time
import urllib.parse
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from zoneinfo import ZoneInfo

import autorun
from alerts import WEATHER_URL, Alerts, Weather
from archive import Archive
from asiair import Asiair, FrameFile
from guidelog import ID as GUIDELOG_ID, GuideLogs
from journal import Journal, Recorder
from live import Live
from notify import Notifier
from sessions import Store
from targets import KEY as TARGET_KEY, Targets
from notices import KEY as NOTICE_KEY, Notices
from tilt import Inspector
from timelapse import Timelapse
from uploads import ID as UPLOAD_ID, MAX_BYTES as UPLOAD_MAX_BYTES, UploadError, Uploads, parse_fields

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s", datefmt="%Y-%m-%dT%H:%M:%S")
log = logging.getLogger("telescope")


def env_number(name: str, default: float) -> float:
    value = float(os.environ.get(name, default))
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def parse_roots(raw: str) -> list[tuple[str, str]]:
    """ROOTS="EMMC Images:,Udisk Images:ASIAIR" (share:folder inside it)."""
    roots = []
    for entry in filter(None, (e.strip() for e in raw.split(","))):
        share, _, folder = entry.partition(":")
        if not share:
            raise ValueError(f'ROOTS: "{entry}" is not share:folder')
        roots.append((share.strip(), folder.strip().replace("/", "\\")))
    if not roots:
        raise ValueError("ROOTS lists nothing")
    return roots


HOST = os.environ.get("ASIAIR_HOST", "")
ROOTS = parse_roots(os.environ.get("ROOTS", "EMMC Images:,Udisk Images:ASIAIR"))
TZ = ZoneInfo(os.environ.get("ASIAIR_TZ", "Europe/Helsinki"))
PORT = int(env_number("PORT", 8080))
POLL_S = env_number("POLL_S", 30)
KEEP_FRAMES = int(env_number("KEEP_FRAMES", 40))
LIVE = os.environ.get("LIVE", "on") != "off"
# Live: the ASIAIR idle this long during a run that has not ended → "Imaging stopped".
# Without live: no frame for one exposure plus twice this (a meridian flip with refocusing and
# re-centering took 22 min on 2026-10-17).
STALL_S = env_number("STALL_MIN", 15) * 60
SESSION_GAP_S = 2 * 3600
SESSION_MAX_AGE_S = 12 * 3600
PLAN_MAX_AGE_S = 24 * 3600
# Volumes: the archive (every file from the ASIAIR), the data (sessions, stacks, previews, live
# history) and the cache of aligned frames (disposable).
ARCHIVE_DIR = os.environ.get("ARCHIVE_DIR", "/archive")
DATA_DIR = os.environ.get("DATA_DIR", "/data")
CACHE_DIR = os.environ.get("CACHE_DIR", "/cache")
CACHE_MAX_BYTES = int(env_number("CACHE_MAX_GB", 15) * 2**30)
# Calibration frames and free space are listed every this many polls (more round trips).
SLOW_POLLS = 10
FRAME_ID = re.compile(r"^/frames/([0-9a-f]{16})(-small)?\.jpg$")
STACK = re.compile(r"^/stacks/([a-z0-9-]{1,128}?)(-small)?\.(jpg|fits)$")
SESSION = re.compile(r"^/api/sessions/([a-z0-9-]{1,128})$")
OVERRIDE = re.compile(r"^/api/sessions/([a-z0-9-]{1,128})/frames/([0-9a-f]{16})$")
REPROCESS = re.compile(r"^/api/sessions/([a-z0-9-]{1,128})/reprocess$")
TARGET = re.compile(r"^/api/targets/([^/?]{1,256})$")
IMAGE = re.compile(r"^/api/images/(stack|upload)/([a-z0-9-]{1,128})(/star)?$")
UPLOAD = re.compile(r"^/api/uploads/([0-9a-f]{16})$")
UPLOAD_FILE = re.compile(r"^/uploads/([0-9a-f]{16})(?:(-small)?\.jpg|/(original))$")
GUIDELOG = re.compile(r"^/api/guidelogs/([A-Za-z0-9_-]{1,64})$")
TIMELAPSE = re.compile(r"^/api/sessions/([a-z0-9-]{1,128})/timelapse$")
TIMELAPSE_STEP = re.compile(r"^/timelapse/([a-z0-9-]{1,128})/(frames|stack)/([0-9a-f]{12})\.jpg$")
TIMELAPSE_WEBP = re.compile(r"^/timelapse/([a-z0-9-]{1,128})/(frames|stack)\.webp$")
INSPECT = re.compile(r"^/api/sessions/([a-z0-9-]{1,128})(?:/frames/([0-9a-f]{16}))?/inspect$")
INSPECT_JPG = re.compile(r"^/frames/([0-9a-f]{16})-inspect\.jpg$")
NOTICE = re.compile(r"^/api/notices/([^/?]{1,80})$")


class Telescope:
    def __init__(self, asiair: Asiair, live: Live | None, notifier: Notifier, store: Store, archive: Archive):
        self.asiair = asiair
        self.live = live
        self.notifier = notifier
        self.store = store
        self.archive = archive
        self.lock = threading.Lock()
        self.files: list[FrameFile] = []
        self.plan: autorun.Plan | None = None
        self.log_key: tuple[str, int] | None = None
        self.storage: list[dict] = []
        self.online = False
        self.last_contact: float | None = None
        self.error: str | None = None
        self.polls = 0
        # Notification memory (seeded on the first poll, so a restart does not repeat them).
        self.started_key: tuple | None = None
        self.finished: set[tuple] = set()
        self.stalled_key: tuple | None = None
        self.idle_since: float | None = None

    # --- polling -------------------------------------------------------------------------------

    def poll(self) -> None:
        first = self.polls == 0
        slow = self.polls % SLOW_POLLS == 0
        self.polls += 1
        try:
            files = self.asiair.frames()
            logs = self.asiair.logs()
            others = list(logs) + (self.asiair.calibration() if slow else [])
            storage = self.asiair.storage() if slow else None
            newest_log = self.asiair.newest_log(logs)
            plan = self.plan
            if newest_log and (newest_log.path, newest_log.size) != self.log_key:
                plan = autorun.parse(self.asiair.read(newest_log.path).decode("utf-8", "replace"), TZ)
                self.log_key = (newest_log.path, newest_log.size)
        except Exception as e:  # noqa: BLE001 - offline, VPN down, ASIAIR switched off
            message = str(e) or type(e).__name__
            # Once when it goes away (or on the first failed poll), not every 30 s while it is off.
            if self.online or (self.last_contact is None and self.error is None):
                log.warning("ASIAIR not answering: %s", message)
            with self.lock:
                self.online, self.error = False, message[:200]
            self.asiair.reset()
            self.check_stall(time.time())
            return
        if not self.online:
            log.info("ASIAIR answering (%d frames on its storage)", len(files))
        with self.lock:
            self.files, self.plan = files, plan
            if storage is not None:
                self.storage = storage
            self.online, self.error, self.last_contact = True, None, time.time()
        # The worker (sessions.py) archives, analyses and stacks them, newest session first.
        self.store.add_frames(files)
        self.store.set_others(others, self.asiair.log_time)

        now = time.time()
        session = self.session(now, self.live_now())
        if first:
            self.seed_notifications(session, now)
        else:
            self.check_started(session, now)
            self.check_finished(session, now)
        self.check_stall(now)

    def is_online(self) -> bool:
        with self.lock:
            return self.online

    def has_polled(self) -> bool:
        """A poll has finished (answered or not): the current session can be judged."""
        with self.lock:
            return self.last_contact is not None or self.error is not None

    # --- derived state -------------------------------------------------------------------------

    def live_now(self) -> dict | None:
        return self.live.snapshot() if self.live else None

    def session(self, now: float, live: dict | None = None) -> dict | None:
        """The run of frames in the newest frame's folder with no gap over 2 h, if under 12 h old."""
        with self.lock:
            files = list(self.files)
        if not files:
            return None
        newest = max(files, key=lambda f: f.saved_at)
        run = sorted(
            (f for f in files if (f.root, f.mode, f.target) == (newest.root, newest.mode, newest.target)),
            key=lambda f: f.saved_at,
        )
        start = len(run) - 1
        while start > 0 and run[start].saved_at - run[start - 1].saved_at <= SESSION_GAP_S:
            start -= 1
        run = run[start:]
        if now - run[-1].saved_at > SESSION_MAX_AGE_S:
            return None
        exposure = run[-1].exposure_s
        first_frame_at = run[0].saved_at - run[0].exposure_s
        newest_rel = self.archive.rel(newest.saved_at, newest.target, newest.path.rsplit("\\", 1)[-1])
        session = {
            # The same session in /api/sessions (null until the worker has seen its frames).
            "id": self.store.session_of(newest_rel),
            "target": newest.target,
            "mode": newest.mode,
            "root": newest.root,
            "frames": len(run),
            "integrationS": round(sum(f.exposure_s for f in run)),
            "firstFrameAt": first_frame_at,
            "lastFrameAt": run[-1].saved_at,
            "exposureS": exposure,
        }
        live_plan = (live or {}).get("plan")
        # The ASIAIR busy with a plan for another target: this run is over even before its log appears
        # (seen 2026-10-19: a Live-mode run stayed "active" while the next plan's first frame exposed).
        other_target = bool(live_plan and live_plan.get("target") and live_plan["target"] != session["target"])
        session["active"] = not self.ended(session, now, live) and not other_target and (
            live["activity"] != "Idle" if live else now - run[-1].saved_at <= exposure + 2 * STALL_S
        )
        return session

    def ended(self, session: dict, now: float, live: dict | None) -> bool:
        """The run is over: its Autorun log is on the share, or live says the plan ended."""
        if self.relevant_plan(session, now):
            return True
        plan = live and live.get("plan")
        return bool(plan and plan["ended"] and plan["target"] == session["target"])

    def relevant_plan(self, session: dict, now: float) -> autorun.Plan | None:
        """The Autorun log of this run: Autorun and Plan runs (not Live stacking) of the same target,
        ending after the run's first frame. The ASIAIR puts the log on its share only when the run
        ends, so while a run is going there is none."""
        plan = self.current_plan(now)
        if (
            plan
            and session["mode"] != "Live"
            and plan.target == session["target"]
            and (plan.updated_at or 0) >= session["firstFrameAt"]
        ):
            return plan
        return None

    def current_plan(self, now: float) -> autorun.Plan | None:
        with self.lock:
            plan = self.plan
        if plan is None or plan.updated_at is None or now - plan.updated_at > PLAN_MAX_AGE_S:
            return None
        return plan

    @staticmethod
    def session_key(session: dict) -> tuple:
        return (session["root"], session["mode"], session["target"], session["firstFrameAt"])

    # --- notifications -------------------------------------------------------------------------

    def seed_notifications(self, session: dict | None, now: float) -> None:
        if session:
            self.started_key = self.session_key(session)
            if self.ended(session, now, self.live_now()):
                self.finished.add(self.session_key(session))

    def check_started(self, session: dict | None, now: float) -> None:
        if not session or now - session["lastFrameAt"] > 1800:
            return
        key = self.session_key(session)
        if key == self.started_key:
            return
        self.started_key = key
        self.idle_since = None
        plan = (self.live_now() or {}).get("plan")
        if plan and plan["target"] == session["target"] and plan["targetTotal"]:
            body = f"{plan['targetTotal']} × {session['exposureS']:g} s"
            if (plan["targets"] or 1) > 1:
                body += f", target {plan['targetIndex']} of {plan['targets']}"
        else:
            body = f"{session['exposureS']:g} s frames ({session['mode']})"
        self.notifier.send(f"Imaging started: {session['target']}", body)

    def check_finished(self, session: dict | None, now: float) -> None:
        if not session or self.session_key(session) in self.finished:
            return
        if not self.ended(session, now, self.live_now()):
            return
        self.finished.add(self.session_key(session))
        plan = self.relevant_plan(session, now)
        if plan and plan.state != "finished":
            title = f"Imaging stopped: {session['target']}"
        else:
            title = f"Imaging finished: {session['target']}"
        self.notifier.send(title, f"{session['frames']} frames, {duration(session['integrationS'])} in total")

    def check_stall(self, now: float) -> None:
        live = self.live_now()
        session = self.session(now, live)
        # Live stacking is ended by hand and leaves no log, so silence there means nothing.
        if not session or session["mode"] == "Live" or self.ended(session, now, live):
            self.idle_since = None
            return
        last = datetime.fromtimestamp(session["lastFrameAt"], TZ).strftime("%H:%M")
        if live:
            # The ASIAIR says what it is doing: meridian flips and refocusing are not stalls.
            if live["activity"] != "Idle":
                self.idle_since = None
                return
            self.idle_since = self.idle_since or now
            if now - self.idle_since < STALL_S:
                return
            key = ("idle", session["target"], self.idle_since)
            title, body = f"Imaging stopped: {session['target']}", f"The ASIAIR is idle; last frame at {last}"
        else:
            if now - session["lastFrameAt"] <= session["exposureS"] + 2 * STALL_S:
                return
            key = ("silent", session["target"], session["lastFrameAt"])
            why = "the ASIAIR is not answering" if not self.online else "its control ports are not answering"
            title, body = f"No new frames: {session['target']}", f"Last frame at {last}; {why}"
        if key == self.stalled_key:
            return
        self.stalled_key = key
        self.notifier.send(title, body)

    def storage_in_use(self) -> tuple[list[dict], str | None, int | None]:
        """The shares' free space, the share the newest frames go to, and that frame's size."""
        with self.lock:
            newest = max(self.files, key=lambda f: f.saved_at, default=None)
            storage = list(self.storage)
        if newest is None:
            return storage, None, None
        return storage, newest.root.split("\\", 1)[0], newest.size

    # --- output --------------------------------------------------------------------------------

    def status(self) -> dict:
        now = time.time()
        live = self.live_now()
        session = self.session(now, live)
        plan = None
        if session:
            live_plan = live and live.get("plan")
            log_plan = self.relevant_plan(session, now)
            if log_plan:
                plan = log_plan.json()
            elif live_plan and live_plan["target"] == session["target"]:
                plan = {
                    "name": None,
                    "target": live_plan["target"],
                    "planned": live_plan["targetTotal"],
                    "current": live_plan["targetDone"],
                    "exposureS": session["exposureS"],
                    "state": "finished" if live_plan["ended"] else "running",
                    "activity": "Finished" if live_plan["ended"] else live["activity"],
                    "startedAt": session["firstFrameAt"],
                    "updatedAt": live["updatedAt"],
                    "events": [],
                }
        else:
            current = self.current_plan(now)
            plan = current.json() if current else None
        with self.lock:
            online, last_contact, error, storage = self.online, self.last_contact, self.error, self.storage
        if session:
            session = {k: v for k, v in session.items() if k != "root"}
        return {
            "online": online,
            "lastContact": last_contact,
            "error": error,
            "session": session,
            "plan": plan,
            "live": live,
            "frames": self.store.recent_infos(KEEP_FRAMES),
            "stack": self.store.current_stack(session["id"] if session else None),
            "storage": storage,
            "updatedAt": now,
        }

    def active_id(self) -> tuple[str | None, dict | None]:
        """The stored id of the session being imaged now, and the live plan."""
        live = self.live_now()
        session = self.session(time.time(), live)
        return (session["id"] if session and session["active"] else None), (live or {}).get("plan")

    def sessions(self) -> list[dict]:
        return self.store.list(self.active_id()[0])

    def session_detail(self, sid: str) -> dict | None:
        active, live_plan = self.active_id()
        return self.store.detail(sid, active, live_plan)

    def metrics(self) -> str:
        status = self.status()
        lines = [
            "# HELP telescope_asiair_up 1 when the ASIAIR's storage answered the last poll.",
            "# TYPE telescope_asiair_up gauge",
            f"telescope_asiair_up {1 if status['online'] else 0}",
            "# HELP telescope_live_up 1 while the ASIAIR's control port answers.",
            "# TYPE telescope_live_up gauge",
            f"telescope_live_up {1 if status['live'] else 0}",
        ]
        frames = status["frames"]
        if frames:
            f = frames[0]
            labels = f'target="{escape(f["target"])}"'
            lines += ["# HELP telescope_last_frame_timestamp_seconds Exposure start of the newest light frame.",
                      "# TYPE telescope_last_frame_timestamp_seconds gauge",
                      f"telescope_last_frame_timestamp_seconds{{{labels}}} {f['at']:.0f}"]
            for name, key, help_ in (
                ("telescope_frame_background_adu", "backgroundAdu", "Sky background (median ADU) of the newest frame."),
                ("telescope_frame_stars", "stars", "Stars detected in the newest frame."),
                ("telescope_frame_hfr_pixels", "hfr", "Median star half-flux radius of the newest frame."),
                ("telescope_sensor_temperature_celsius", "sensorTempC", "Camera sensor temperature in the newest frame."),
            ):
                if f.get(key) is not None:
                    lines += [f"# HELP {name} {help_}", f"# TYPE {name} gauge", f"{name}{{{labels}}} {f[key]}"]
        guiding = (status["live"] or {}).get("guiding")
        if guiding and guiding["rmsArcsec"] is not None:
            lines += ["# HELP telescope_guiding_rms_arcsec Guiding error RMS over the last 50 steps.",
                      "# TYPE telescope_guiding_rms_arcsec gauge"]
            for axis, key in (("total", "rmsArcsec"), ("ra", "rmsRaArcsec"), ("dec", "rmsDecArcsec")):
                lines.append(f'telescope_guiding_rms_arcsec{{axis="{axis}"}} {guiding[key]}')
        stack = status["stack"]
        if stack:
            labels = f'target="{escape(stack["target"])}"'
            lines += ["# HELP telescope_stack_frames Frames of the current session's stack, by decision.",
                      "# TYPE telescope_stack_frames gauge",
                      f'telescope_stack_frames{{{labels},decision="accepted"}} {stack["accepted"]}',
                      f'telescope_stack_frames{{{labels},decision="rejected"}} {stack["rejected"]}',
                      "# HELP telescope_stack_integration_seconds Exposure time in the current session's stack.",
                      "# TYPE telescope_stack_integration_seconds gauge",
                      f"telescope_stack_integration_seconds{{{labels}}} {stack['integrationS']}"]
        files, size = self.archive.totals()
        lines += ["# HELP telescope_archive_files Files in the archive at home.",
                  "# TYPE telescope_archive_files gauge", f"telescope_archive_files {files}",
                  "# HELP telescope_archive_bytes Size of the archive at home.",
                  "# TYPE telescope_archive_bytes gauge", f"telescope_archive_bytes {size}",
                  "# HELP telescope_backfill_remaining Files on the ASIAIR not yet archived and analysed.",
                  "# TYPE telescope_backfill_remaining gauge", f"telescope_backfill_remaining {self.store.backlog()}"]
        if status["storage"]:
            lines += ["# HELP telescope_asiair_storage_free_bytes Free space on the ASIAIR's storage.",
                      "# TYPE telescope_asiair_storage_free_bytes gauge"]
            lines += [f'telescope_asiair_storage_free_bytes{{share="{escape(s["name"])}"}} {s["freeBytes"]}'
                      for s in status["storage"]]
        return "\n".join(lines) + "\n"


def duration(seconds: float) -> str:
    h, m = divmod(round(seconds / 60), 60)
    return f"{h} h {m} min" if h else f"{m} min"


def escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def read_file(path: str) -> bytes | None:
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


def serve(telescope: Telescope, store: Store, targets: Targets, uploads: Uploads) -> ThreadingHTTPServer:
    notices = Notices(DATA_DIR)
    guidelogs = GuideLogs(store.archive, store.tz, os.path.join(store.cache, "guidelogs"))
    timelapse = Timelapse(store, lambda: telescope.active_id()[0])
    timelapse.start()
    inspector = Inspector(store)

    class Handler(BaseHTTPRequestHandler):
        def send(self, status: int, kind: str, body: bytes, cache: str = "no-store") -> None:
            self.send_response(status)
            self.send_header("content-type", kind)
            self.send_header("content-length", str(len(body)))
            self.send_header("cache-control", cache)
            self.end_headers()
            self.wfile.write(body)

        def json(self, status: int, value) -> None:
            self.send(status, "application/json", json.dumps(value).encode())

        def not_found(self) -> None:
            self.send(404, "text/plain", b"not found\n")

        def text(self, status: int, message: str) -> None:
            self.send(status, "text/plain", message.encode() + b"\n")

        def send_path(self, path: str | None, kind: str, cache: str, disposition: str | None = None) -> None:
            """A file streamed from disk (uploads' originals reach 300 MB)."""
            try:
                f = open(path, "rb") if path else None
            except OSError:
                f = None
            if f is None:
                return self.not_found()
            with f:
                self.send_response(200)
                self.send_header("content-type", kind)
                self.send_header("content-length", str(os.fstat(f.fileno()).st_size))
                self.send_header("cache-control", cache)
                if disposition:
                    self.send_header("content-disposition", disposition)
                self.end_headers()
                shutil.copyfileobj(f, self.wfile, 2**20)

        def image(self, kind: str, ident: str, star: bool, query: str) -> None:
            if kind == "upload" and not UPLOAD_ID.match(ident):
                return self.not_found()
            if not star:
                meta = store.stack_image(ident) if kind == "stack" else uploads.image(ident)
                return self.json(200, meta) if meta else self.not_found()
            params = urllib.parse.parse_qs(query)
            try:
                x, y = float(params["x"][0]), float(params["y"][0])
                if not (math.isfinite(x) and math.isfinite(y)):
                    raise ValueError
            except (KeyError, ValueError):
                return self.text(400, "expected ?x=<display px>&y=<display px>")
            result = store.stack_star(ident, x, y) if kind == "stack" else uploads.star(ident, x, y)
            return self.json(200, result) if result else self.not_found()

        def inspected(self, sid: str, fid: str | None) -> None:
            """A6: a frame's or a session's tilt inspection, measured on this request's thread when
            not cached (~0.7 s a frame)."""
            try:
                result = inspector.frame(sid, fid) if fid else inspector.session(sid)
            except Exception as e:  # noqa: BLE001 - an unreadable file must not drop the request
                log.exception("inspect %s %s", sid, fid)
                return self.text(500, f"inspection failed: {type(e).__name__}: {e}")
            return self.json(200, result) if result else self.not_found()

        def do_GET(self) -> None:  # noqa: N802 - http.server's naming
            path, _, query = self.path.partition("?")
            if path == "/api/status":
                return self.json(200, telescope.status())
            if path == "/api/sessions":
                return self.json(200, telescope.sessions())
            if path == "/api/targets":
                return self.json(200, targets.all())
            if m := NOTICE.match(path):
                entry = notices.get(m[1]) if NOTICE_KEY.match(m[1]) else None
                return self.json(200, entry) if entry else self.not_found()
            if m := SESSION.match(path):
                detail = telescope.session_detail(m[1])
                return self.json(200, detail) if detail else self.not_found()
            if m := FRAME_ID.match(path):
                image = read_file(store.preview_path(m[1], bool(m[2])))
                if image is None:
                    return self.not_found()
                return self.send(200, "image/jpeg", image, "public, max-age=31536000, immutable")
            if m := INSPECT.match(path):
                return self.inspected(m[1], m[2])
            if m := INSPECT_JPG.match(path):
                try:
                    mosaic = inspector.mosaic_path(m[1])
                except Exception as e:  # noqa: BLE001
                    log.exception("inspect %s", m[1])
                    return self.text(500, f"inspection failed: {type(e).__name__}: {e}")
                # Frame ids change with the file: cacheable forever.
                return self.send_path(mosaic, "image/jpeg", "public, max-age=31536000, immutable")
            if m := STACK.match(path):
                if m[3] == "fits" and m[2]:
                    return self.not_found()
                name = "stack.fits" if m[3] == "fits" else f"stack{m[2] or ''}.jpg"
                body = read_file(os.path.join(store.folder(m[1]), name))
                if body is None:
                    return self.not_found()
                # ?v=<imageId> names one version of the stack: cacheable; without it, always fresh.
                cache = "public, max-age=31536000, immutable" if "v=" in query else "no-cache"
                kind = "application/fits" if m[3] == "fits" else "image/jpeg"
                return self.send(200, kind, body, cache)
            if m := IMAGE.match(path):
                return self.image(m[1], m[2], bool(m[3]), query)
            if path == "/api/uploads":
                return self.json(200, uploads.list())
            if m := UPLOAD.match(path):
                entry = uploads.get(m[1])
                return self.json(200, entry) if entry else self.not_found()
            if m := UPLOAD_FILE.match(path):
                if m[3]:
                    info = uploads.original_info(m[1])
                    if info is None:
                        return self.not_found()
                    name = info["filename"]
                    ascii_name = re.sub(r'[^A-Za-z0-9._ -]', "_", name) or "upload"
                    disposition = f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{urllib.parse.quote(name)}"
                    return self.send_path(uploads.path(m[1], "original"), info["contentType"],
                                          "private, max-age=31536000, immutable", disposition)
                # An upload's image never changes (a new version is a new upload): cacheable forever.
                return self.send_path(uploads.path(m[1], "small.jpg" if m[2] else "display.jpg"), "image/jpeg",
                                      "public, max-age=31536000, immutable")
            if path == "/api/focus":
                return self.json(200, store.focus.json())
            if path == "/api/guidelogs":
                return self.json(200, guidelogs.list())
            if m := GUIDELOG.match(path):
                entry = guidelogs.get(m[1]) if GUIDELOG_ID.match(m[1]) else None
                return self.json(200, entry) if entry else self.not_found()
            if m := TIMELAPSE.match(path):
                result = timelapse.status(m[1])
                return self.json(200, result) if result else self.not_found()
            if m := TIMELAPSE_STEP.match(path):
                # Named by the hash of everything in the picture: cacheable forever.
                return self.send_path(timelapse.image_path(m[1], m[2], m[3]), "image/jpeg",
                                      "public, max-age=31536000, immutable")
            if m := TIMELAPSE_WEBP.match(path):
                # ?v=<key> names one version (the index's webpUrl): cacheable forever; without it, the current one.
                version = urllib.parse.parse_qs(query).get("v", [None])[0]
                found = timelapse.webp(m[1], m[2], version)
                return self.send_path(found[0] if found else None, "image/webp",
                                      "public, max-age=31536000, immutable" if version else "no-cache",
                                      f'attachment; filename="{found[1]}"' if found else None)
            if path == "/metrics":
                return self.send(200, "text/plain; version=0.0.4", telescope.metrics().encode())
            if path == "/healthz":
                return self.send(200, "text/plain", b"ok\n")
            self.not_found()

        def body(self, limit: int = 4096):
            """The request's JSON (None when it is not JSON or over `limit` bytes)."""
            try:
                length = int(self.headers.get("content-length") or 0)
                return json.loads(self.rfile.read(length) or b"{}") if length <= limit else None
            except ValueError:
                return None

        def upload(self) -> None:
            """POST /api/uploads: the multipart body streamed to disk, converted, kept."""
            self.close_connection = True  # an error may leave the body unread
            header = email.message.Message()
            header["content-type"] = self.headers.get("content-type", "")
            boundary = header.get_param("boundary")
            if header.get_content_type() != "multipart/form-data" or not isinstance(boundary, str) \
                    or not 0 < len(boundary) <= 200:
                return self.text(400, "expected multipart/form-data with a boundary")
            try:
                length = int(self.headers["content-length"])
            except (KeyError, TypeError, ValueError):
                return self.text(411, "content-length required")
            if length > UPLOAD_MAX_BYTES + 2**20:
                return self.text(413, f"file over {UPLOAD_MAX_BYTES // 2**20} MB")
            try:
                entry = uploads.create(self.rfile, length, boundary.encode("latin-1"))
            except UploadError as e:
                log.warning("upload refused: %s", e)
                return self.text(e.status, str(e))
            except OSError as e:
                log.warning("upload failed: %s", e)
                return self.text(500, f"upload failed: {e}")
            self.close_connection = False
            return self.json(201, entry)

        def do_POST(self) -> None:  # noqa: N802
            path = self.path.split("?", 1)[0]
            if path == "/api/uploads":
                return self.upload()
            body = self.body()
            if m := OVERRIDE.match(path):
                if not isinstance(body, dict) or "accepted" not in body or body["accepted"] not in (True, False, None):
                    return self.send(400, "text/plain", b'expected {"accepted": true|false|null}\n')
                frame = store.override(m[1], m[2], body["accepted"])
                if frame is None:
                    return self.not_found()
                log.info("frame %s of %s: %s by hand", m[2], m[1],
                         {True: "accepted", False: "rejected", None: "automatic"}[body["accepted"]])
                return self.json(200, {"frame": frame, "restacking": True})
            if m := REPROCESS.match(path):
                if not store.reprocess(m[1]):
                    return self.not_found()
                log.info("session %s: reprocessing", m[1])
                return self.json(202, {"reprocessing": True})
            self.not_found()

        def do_PUT(self) -> None:  # noqa: N802
            if m := NOTICE.match(self.path):
                if not NOTICE_KEY.match(m[1]):
                    return self.text(400, "notice key: up to 80 of a-z 0-9 : -")
                sent = notices.parse(self.body())
                if isinstance(sent, str):
                    return self.text(400, sent)
                entry = notices.put(m[1], sent)
                log.info("notice %s sent at %s", m[1], datetime.fromtimestamp(sent, store.tz).isoformat(timespec="seconds"))
                return self.json(200, entry)
            if m := UPLOAD.match(self.path):
                fields = parse_fields(self.body(16384), partial=True)
                if isinstance(fields, str):
                    return self.text(400, fields)
                entry = uploads.update(m[1], fields)
                if entry is None:
                    return self.not_found()
                log.info("upload %s: %s", m[1], json.dumps({k: v for k, v in fields.items() if k != "note"}))
                return self.json(200, entry)
            m = TARGET.match(self.path)
            if not m:
                return self.not_found()
            key = urllib.parse.unquote(m[1])
            if not TARGET_KEY.match(key):
                return self.send(400, "text/plain", b"target key: up to 64 of A-Z a-z 0-9 space + . _ ( ) -\n")
            fields = targets.parse(self.body())
            if isinstance(fields, str):
                return self.send(400, "text/plain", fields.encode() + b"\n")
            entry = targets.put(key, fields)
            log.info("target %s: %s", key, json.dumps(fields))
            return self.json(200, entry)

        def do_DELETE(self) -> None:  # noqa: N802
            m = UPLOAD.match(self.path)
            if not m:
                return self.not_found()
            if not uploads.delete(m[1]):
                return self.not_found()
            log.info("upload %s deleted", m[1])
            return self.send(204, "text/plain", b"")

        def log_message(self, format: str, *args) -> None:  # noqa: A002 - quiet access log
            pass

    server = ThreadingHTTPServer(("", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main() -> None:
    if not HOST:
        raise SystemExit("ASIAIR_HOST is not set")
    # PID 1 in the container: SIGTERM has no default action there.
    signal.signal(signal.SIGTERM, lambda *_: os._exit(0))
    notifier = Notifier(
        os.environ.get("NOTIFY_URL", "http://web.notify.svc:3000"),
        os.environ.get("NOTIFY_TOKEN", ""),
        os.environ.get("NOTIFY_LINK", "https://dashboard.shillyshally.org/?tab=telescope"),
    )
    asiair = Asiair(HOST, ROOTS, TZ)
    journal = Journal(os.path.join(DATA_DIR, "live"), TZ)
    live = Live(HOST, journal.append) if LIVE else None
    archive = Archive(ARCHIVE_DIR, TZ)
    store = Store(DATA_DIR, CACHE_DIR, archive, journal, asiair, TZ, CACHE_MAX_BYTES)
    telescope = Telescope(asiair, live, notifier, store, archive)
    # The worker reads from the ASIAIR only while its storage answers the polls.
    store.online = telescope.is_online
    if live:
        Recorder(journal, live.snapshot)
    uploads = Uploads(DATA_DIR, store.scratch)
    serve(telescope, store, Targets(DATA_DIR), uploads)
    Alerts(telescope, notifier, Weather(os.environ.get("WEATHER_URL", WEATHER_URL))).start()
    files, size = archive.totals()
    log.info("telescope: ASIAIR %s, roots %s, live %s, notifications %s, archive %d files (%.1f GB), listening on :%d",
             HOST, ", ".join(f"{s}\\{r}".rstrip("\\") for s, r in ROOTS), "on" if LIVE else "off",
             "on" if notifier.token else "off", files, size / 1e9, PORT)
    store.start()
    uploads.start()
    while True:
        started = time.time()
        telescope.poll()
        time.sleep(max(1.0, POLL_S - (time.time() - started)))


if __name__ == "__main__":
    main()
