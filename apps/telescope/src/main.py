"""Telescope: the cabin's ZWO ASIAIR imaging session for the dashboard's Telescope tab.

Polls the ASIAIR's SMB shares (over the Site Magic VPN): renders each new light frame into preview
JPEGs with sky-quality numbers, follows the newest Autorun log for plan progress, and sends push
notifications (session started, plan finished, frames stopped coming). Read-only towards the ASIAIR.
Cluster-internal:
    GET /api/status              JSON (session, plan, recent frames)
    GET /frames/<id>.jpg         preview (~1504 px); /frames/<id>-small.jpg (~300 px)
    GET /metrics                 Prometheus
    GET /healthz
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from zoneinfo import ZoneInfo

import autorun
import fits
from asiair import Asiair, FrameFile
from notify import Notifier

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
STARTUP_FRAMES = int(env_number("STARTUP_FRAMES", 12))
# A plan is "stalled" when no frame has arrived for one exposure plus this (auto focus, centering and
# meridian flips take a few minutes).
STALL_S = env_number("STALL_MIN", 15) * 60
SESSION_GAP_S = 2 * 3600
SESSION_MAX_AGE_S = 12 * 3600
PLAN_MAX_AGE_S = 24 * 3600
FRAME_ID = re.compile(r"^/frames/([0-9a-f]{16})(-small)?\.jpg$")


@dataclass
class Frame:
    id: str
    key: tuple[str, int, float]
    file: FrameFile
    info: dict
    large: bytes
    small: bytes


class Telescope:
    def __init__(self, asiair: Asiair, notifier: Notifier):
        self.asiair = asiair
        self.notifier = notifier
        self.lock = threading.Lock()
        self.frames: OrderedDict[str, Frame] = OrderedDict()  # oldest first
        self.done: set[tuple[str, int, float]] = set()  # rendered, or failed for good
        self.files: list[FrameFile] = []
        self.plan: autorun.Plan | None = None
        self.log_key: tuple[str, int] | None = None
        self.online = False
        self.last_contact: float | None = None
        self.error: str | None = None
        self.polls = 0
        # Notification memory (seeded on the first poll, so a restart does not repeat them).
        self.started_key: tuple | None = None
        self.finished_key: tuple | None = None
        self.stalled_key: tuple | None = None

    # --- polling -------------------------------------------------------------------------------

    def poll(self) -> None:
        first = self.polls == 0
        self.polls += 1
        try:
            files = self.asiair.frames()
            newest_log = self.asiair.newest_log()
            plan = self.plan
            if newest_log and (newest_log.path, newest_log.size) != self.log_key:
                plan = autorun.parse(self.asiair.read(newest_log.path).decode("utf-8", "replace"), TZ)
                self.log_key = (newest_log.path, newest_log.size)
        except Exception as e:  # noqa: BLE001 - offline, VPN down, ASIAIR switched off
            message = str(e) or type(e).__name__
            if self.online or self.last_contact is None:
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
            self.online, self.error, self.last_contact = True, None, time.time()

        todo = sorted((f for f in files if self.key(f) not in self.done), key=lambda f: f.saved_at)
        # At start only the latest frames; after an outage only the newest few (each is ~18 MB).
        for f in todo[-(STARTUP_FRAMES if first else 5):]:
            self.render(f)
        self.done.update(self.key(f) for f in todo[: -(STARTUP_FRAMES if first else 5)])

        now = time.time()
        session = self.session(now)
        if first:
            self.seed_notifications(session)
        else:
            self.check_started(session, now)
            self.check_finished(session)
        self.check_stall(now)

    @staticmethod
    def key(f: FrameFile) -> tuple[str, int, float]:
        return (f.path, f.size, f.mtime)

    def render(self, f: FrameFile) -> None:
        started = time.time()
        try:
            raw = self.asiair.read(f.path)
            header, offset = fits.parse_header(raw)
            rendered = fits.render(fits.read_pixels(raw, header, offset), header)
        except fits.IncompleteFrame:
            return  # still being written: next poll
        except Exception as e:  # noqa: BLE001
            log.error("frame %s: %s", f.path, e)
            if not isinstance(e, OSError):
                self.done.add(self.key(f))  # unreadable for good (OSError: retry next poll)
            return
        frame_id = hashlib.sha1("|".join(map(str, self.key(f))).encode()).hexdigest()[:16]
        info = {
            "id": frame_id,
            "target": header.get("OBJECT") or f.target,
            "mode": f.mode,
            "number": f.number,
            "at": date_obs(header.get("DATE-OBS")) or f.saved_at - f.exposure_s,
            "exposureS": fits.number(header, "EXPTIME") or f.exposure_s,
            "gain": fits.number(header, "GAIN"),
            "sensorTempC": fits.number(header, "CCD-TEMP"),
            "setTempC": fits.number(header, "SET-TEMP"),
            "camera": header.get("INSTRUME"),
            "focalLengthMm": fits.number(header, "FOCALLEN"),
            "backgroundAdu": round(rendered.background_adu),
            "stars": rendered.stars,
            "hfr": rendered.hfr,
            "width": rendered.width,
            "height": rendered.height,
        }
        with self.lock:
            self.frames[frame_id] = Frame(frame_id, self.key(f), f, info, rendered.large, rendered.small)
            self.frames = OrderedDict(sorted(self.frames.items(), key=lambda kv: kv[1].info["at"]))
            while len(self.frames) > KEEP_FRAMES:
                self.frames.popitem(last=False)
            self.done.add(self.key(f))
        log.info(
            "frame %s #%d %s: background %d ADU, %d stars, HFR %s (%.1f s)",
            info["target"], f.number, f.mode, info["backgroundAdu"], info["stars"], info["hfr"], time.time() - started,
        )

    # --- derived state -------------------------------------------------------------------------

    def session(self, now: float) -> dict | None:
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
        plan = self.relevant_plan(newest.mode, newest.target, now)
        recent = now - run[-1].saved_at <= exposure + STALL_S
        return {
            "target": newest.target,
            "mode": newest.mode,
            "root": newest.root,
            "frames": len(run),
            "integrationS": round(sum(f.exposure_s for f in run)),
            "firstFrameAt": run[0].saved_at - run[0].exposure_s,
            "lastFrameAt": run[-1].saved_at,
            "exposureS": exposure,
            "active": recent and (plan is None or plan.state == "running"),
        }

    def relevant_plan(self, mode: str, target: str, now: float) -> autorun.Plan | None:
        """The Autorun log describes Autorun and Plan runs (not Live stacking) of its own target."""
        plan = self.current_plan(now)
        if plan and mode != "Live" and plan.target == target:
            return plan
        return None

    def current_plan(self, now: float) -> autorun.Plan | None:
        with self.lock:
            plan = self.plan
        if plan is None or plan.updated_at is None or now - plan.updated_at > PLAN_MAX_AGE_S:
            return None
        if plan.state == "running" and now - plan.updated_at > (plan.exposure_s or 600) + 2 * STALL_S:
            # The log stopped without an end line: the ASIAIR was switched off or lost power.
            stale = autorun.Plan(**{**plan.__dict__, "state": "stopped", "activity": None})
            return stale
        return plan

    # --- notifications -------------------------------------------------------------------------

    def seed_notifications(self, session: dict | None) -> None:
        if session:
            self.started_key = (session["root"], session["mode"], session["target"], session["firstFrameAt"])
        plan = self.current_plan(time.time())
        if plan and plan.state == "finished":
            self.finished_key = self.log_key

    def check_started(self, session: dict | None, now: float) -> None:
        if not session or now - session["lastFrameAt"] > 1800:
            return
        key = (session["root"], session["mode"], session["target"], session["firstFrameAt"])
        if key == self.started_key:
            return
        self.started_key = key
        plan = self.relevant_plan(session["mode"], session["target"], now)
        if plan and plan.planned:
            body = f"{plan.planned} × {plan.exposure_s:g} s" + (f", plan {plan.name}" if plan.name else "")
        else:
            body = f"{session['exposureS']:g} s frames ({session['mode']})"
        self.notifier.send(f"Imaging started: {session['target']}", body)

    def check_finished(self, session: dict | None) -> None:
        plan = self.current_plan(time.time())
        if not plan or plan.state != "finished" or self.log_key == self.finished_key:
            return
        self.finished_key = self.log_key
        if session and session["target"] == plan.target:
            body = f"{session['frames']} frames, {duration(session['integrationS'])} in total"
        else:
            body = f"{plan.current or 0} frames of {plan.planned or '?'}"
        self.notifier.send(f"Imaging finished: {plan.target or plan.name}", body)

    def check_stall(self, now: float) -> None:
        session = self.session(now)
        if not session:
            return
        plan = self.relevant_plan(session["mode"], session["target"], now)
        if not plan or plan.state != "running" or (plan.planned and (plan.current or 0) >= plan.planned):
            return
        silent = now - session["lastFrameAt"]
        if silent <= session["exposureS"] + STALL_S:
            return
        key = (session["target"], session["lastFrameAt"])
        if key == self.stalled_key:
            return
        self.stalled_key = key
        last = datetime.fromtimestamp(session["lastFrameAt"], TZ).strftime("%H:%M")
        why = "" if self.online else "; the ASIAIR is not answering"
        self.notifier.send(f"No new frames: {session['target']}", f"Last frame at {last}{why}")

    # --- output --------------------------------------------------------------------------------

    def status(self) -> dict:
        now = time.time()
        session = self.session(now)
        plan = self.current_plan(now)
        with self.lock:
            frames = [f.info for f in reversed(self.frames.values())]
            online, last_contact, error = self.online, self.last_contact, self.error
        if session:
            session = {k: v for k, v in session.items() if k != "root"}
        return {
            "online": online,
            "lastContact": last_contact,
            "error": error,
            "session": session,
            "plan": plan.json() if plan else None,
            "frames": frames,
            "updatedAt": now,
        }

    def image(self, frame_id: str, small: bool) -> bytes | None:
        with self.lock:
            frame = self.frames.get(frame_id)
        return None if frame is None else (frame.small if small else frame.large)

    def metrics(self) -> str:
        status = self.status()
        lines = [
            "# HELP telescope_asiair_up 1 when the ASIAIR's storage answered the last poll.",
            "# TYPE telescope_asiair_up gauge",
            f"telescope_asiair_up {1 if status['online'] else 0}",
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
        plan = status["plan"]
        if plan and plan["state"] == "running":
            lines += ["# HELP telescope_plan_frames Light frames of the running plan's target: planned and started.",
                      "# TYPE telescope_plan_frames gauge"]
            for kind in ("planned", "current"):
                if plan[kind] is not None:
                    lines.append(f'telescope_plan_frames{{target="{escape(plan["target"] or "")}",kind="{kind}"}} {plan[kind]}')
        return "\n".join(lines) + "\n"


def date_obs(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        return None


def duration(seconds: float) -> str:
    h, m = divmod(round(seconds / 60), 60)
    return f"{h} h {m} min" if h else f"{m} min"


def escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def serve(telescope: Telescope) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def send(self, status: int, kind: str, body: bytes, cache: str = "no-store") -> None:
            self.send_response(status)
            self.send_header("content-type", kind)
            self.send_header("content-length", str(len(body)))
            self.send_header("cache-control", cache)
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802 - http.server's naming
            path = self.path.split("?", 1)[0]
            if path == "/api/status":
                return self.send(200, "application/json", json.dumps(telescope.status()).encode())
            if m := FRAME_ID.match(path):
                image = telescope.image(m[1], bool(m[2]))
                if image is None:
                    return self.send(404, "text/plain", b"not found\n")
                return self.send(200, "image/jpeg", image, "public, max-age=31536000, immutable")
            if path == "/metrics":
                return self.send(200, "text/plain; version=0.0.4", telescope.metrics().encode())
            if path == "/healthz":
                return self.send(200, "text/plain", b"ok\n")
            self.send(404, "text/plain", b"not found\n")

        def log_message(self, format: str, *args) -> None:  # noqa: A002 - quiet access log
            pass

    server = ThreadingHTTPServer(("", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main() -> None:
    if not HOST:
        raise SystemExit("ASIAIR_HOST is not set")
    notifier = Notifier(
        os.environ.get("NOTIFY_URL", "http://web.notify.svc:3000"),
        os.environ.get("NOTIFY_TOKEN", ""),
        os.environ.get("NOTIFY_LINK", "https://dashboard.shillyshally.org/?tab=telescope"),
    )
    telescope = Telescope(Asiair(HOST, ROOTS, TZ), notifier)
    serve(telescope)
    log.info("telescope: ASIAIR %s, roots %s, notifications %s, listening on :%d",
             HOST, ", ".join(f"{s}\\{r}".rstrip("\\") for s, r in ROOTS), "on" if notifier.token else "off", PORT)
    while True:
        started = time.time()
        telescope.poll()
        time.sleep(max(1.0, POLL_S - (time.time() - started)))


if __name__ == "__main__":
    main()
