"""Live state from the ASIAIR's own control ports, read only.

The ASIAIR app talks to two JSON-RPC servers on the ASIAIR, one JSON object per line (\\r\\n):
    4700 "ASI AIR imager": events (PiStatus, Station, Temperature, …) and methods such as
         get_app_state (what runs: capture with plan progress, auto focus, meridian flip, GoTo, …)
    4400 "ASI AIR guider": PHD2-style events (GuideStep with RADistanceRaw/DECDistanceRaw in guide
         camera pixels, …) and methods get_app_state ("Guiding", …), get_pixel_scale (″/px)
A client that sends nothing is dropped after about 18 s, so each connection asks for the state
every 5 s. Only getters are called (get_app_state, get_pixel_scale); nothing is ever set.
Observed on firmware 13.41 (2026-10-17) during a plan with the app connected at the same time.
"""

from __future__ import annotations

import json
import logging
import math
import socket
import threading
import time
from collections import deque

log = logging.getLogger("live")

ASK_EVERY_S = 5
RETRY_S = 15
STALE_S = 30
RMS_STEPS = 50
# Guider events kept in the session history (guiding.events), PHD2 names → contract kinds.
GUIDER_EVENTS = {
    "GuidingDithered": "dither",
    "SettleBegin": "settle",
    "StarLost": "lost",
    "GuideStarLostTooMuch": "lost",
    "StartGuiding": "start",
    "GuidingStopped": "stop",
}
HISTORY_STEPS = 120
# What the imager is busy with, most specific first (get_app_state keys).
ACTIVITIES = (
    ("merid_flip", "Meridian flip"),
    ("auto_focus", "Auto focus"),
    ("auto_goto", "GoTo"),
    ("solve", "Plate solving"),
    ("find_star", "Finding star"),
    ("pa", "Polar alignment"),
    ("pa_3p", "Polar alignment"),
    ("stack", "Live stacking"),
)


class Connection:
    """One port: keeps a connection, asks `methods` in turn every few seconds, hands lines to `on_line`."""

    def __init__(self, host: str, port: int, methods: list[str], on_line, on_down):
        self.host, self.port, self.methods = host, port, methods
        self.on_line, self.on_down = on_line, on_down
        threading.Thread(target=self.run, name=f"live-{port}", daemon=True).start()

    def run(self) -> None:
        was_up = False
        while True:
            try:
                with socket.create_connection((self.host, self.port), timeout=10) as sock:
                    sock.settimeout(1)
                    if not was_up:
                        log.info("connected to %s:%d", self.host, self.port)
                    was_up = True
                    self.session(sock)
            except OSError as e:
                if was_up:
                    log.warning("%s:%d: %s", self.host, self.port, e or type(e).__name__)
                was_up = False
            self.on_down()
            time.sleep(RETRY_S)

    def session(self, sock: socket.socket) -> None:
        buffer, ask_at, n = b"", 0.0, 0
        while True:
            if time.time() >= ask_at:
                method = self.methods[n % len(self.methods)]
                n += 1
                sock.sendall(json.dumps({"id": n, "method": method}).encode() + b"\r\n")
                ask_at = time.time() + ASK_EVERY_S / len(self.methods)
            try:
                data = sock.recv(65536)
            except socket.timeout:
                continue
            if not data:
                raise ConnectionResetError("closed by the ASIAIR")
            buffer += data
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                try:
                    message = json.loads(line)
                except ValueError:
                    continue
                if isinstance(message, dict):
                    self.on_line(message)


class Live:
    def __init__(self, host: str, on_record=None):
        self.lock = threading.Lock()
        self.imager_at: float | None = None
        self.guider_at: float | None = None
        self.app_state: dict | None = None
        self.app_state_at = 0.0
        self.guider_state: str | None = None
        self.pixel_scale: float | None = None
        self.steps: deque = deque(maxlen=HISTORY_STEPS)  # (time, ra″, dec″, settling)
        self.snr: float | None = None
        self.sensor_temp: float | None = None
        self.controller_temp: float | None = None
        self.cooler_power: float | None = None
        self.under_voltage: bool | None = None
        self.over_temp: bool | None = None
        self.wifi: int | None = None
        self.seen_events: set[str] = set()
        # Guide steps and guider events for the session history (journal.py), called outside the lock.
        self.on_record = on_record or (lambda record: None)
        Connection(host, 4700, ["get_app_state"], self.imager_line, lambda: self.down("imager"))
        Connection(host, 4400, ["get_app_state", "get_app_state", "get_pixel_scale"], self.guider_line,
                   lambda: self.down("guider"))

    def down(self, which: str) -> None:
        with self.lock:
            if which == "imager":
                self.imager_at = None
            else:
                self.guider_at, self.guider_state = None, None
                self.steps.clear()

    def note_event(self, port: str, message: dict) -> None:
        """First sighting of each event type, for learning what the ASIAIR reports."""
        name = f"{port}:{message.get('Event')}"
        if name not in self.seen_events:
            self.seen_events.add(name)
            log.info("event %s: %s", name, json.dumps(message)[:400])

    def imager_line(self, message: dict) -> None:
        now = time.time()
        event = message.get("Event")
        with self.lock:
            self.imager_at = now
            if message.get("method") == "get_app_state" and isinstance(message.get("result"), dict):
                self.app_state, self.app_state_at = message["result"], now
            elif event == "Temperature":
                self.sensor_temp = message.get("value")
            elif event == "PiStatus":
                self.controller_temp = message.get("temp")
                self.under_voltage = bool(message.get("is_undervolt"))
                self.over_temp = bool(message.get("is_overtemp"))
            elif event == "CoolerPower":
                self.cooler_power = message.get("value")
            elif event == "Station":
                self.wifi = message.get("sig_lev")
        if event:
            self.note_event("imager", message)

    def guider_line(self, message: dict) -> None:
        now = time.time()
        event = message.get("Event")
        record = None
        with self.lock:
            self.guider_at = now
            method, result = message.get("method"), message.get("result")
            if method == "get_app_state" and isinstance(result, str):
                self.guider_state = result
            elif method == "get_pixel_scale" and isinstance(result, (int, float)) and result > 0:
                self.pixel_scale = float(result)
            elif event == "GuideStep" and self.pixel_scale:
                ra, dec = message.get("RADistanceRaw"), message.get("DECDistanceRaw")
                if isinstance(ra, (int, float)) and isinstance(dec, (int, float)):
                    settling = bool(message.get("IsSettle") or message.get("IsDither"))
                    self.steps.append((now, ra * self.pixel_scale, dec * self.pixel_scale, settling))
                    self.snr = message.get("SNR")
                    record = {"t": round(now, 1), "k": "guide", "ra": round(ra * self.pixel_scale, 3),
                              "dec": round(dec * self.pixel_scale, 3), "s": int(settling), "snr": self.snr}
            elif event in GUIDER_EVENTS:
                record = {"t": round(now, 1), "k": "gev", "e": GUIDER_EVENTS[event]}
        if record:
            self.on_record(record)
        if event and event != "GuideStep":
            self.note_event("guider", message)

    # --- snapshot ---------------------------------------------------------------------------------

    def snapshot(self) -> dict | None:
        now = time.time()
        with self.lock:
            if self.imager_at is None or now - self.imager_at > STALE_S or self.app_state is None:
                return None
            state = self.app_state
            age = now - self.app_state_at
            guiding = self._guiding() if self.guider_at and now - self.guider_at <= STALE_S else None
            sensor, controller, wifi = self.sensor_temp, self.controller_temp, self.wifi
            cooler, under_voltage, over_temp = self.cooler_power, self.under_voltage, self.over_temp
        capture = state.get("capture") or {}
        activity = next((label for key, label in ACTIVITIES if (state.get(key) or {}).get("is_working")), None)
        exposure = None
        # The capture also runs for auto focus and plate solving (2 s frames): only a plan frame
        # with nothing else going on is "Exposing".
        if capture.get("is_working") and activity is None:
            activity = "Exposing"
            if capture.get("state") == "expose" and capture.get("total_ms"):
                elapsed = (capture.get("lapse_ms") or 0) / 1000 + age
                total = capture["total_ms"] / 1000
                exposure = {"startedAt": now - elapsed, "totalS": total, "elapsedS": round(min(elapsed, total), 1)}
        return {
            "connected": True,
            "updatedAt": self.app_state_at,
            "activity": activity or "Idle",
            "exposure": exposure,
            "plan": self._plan(state),
            "guiding": guiding,
            "sensorTempC": sensor,
            "controllerTempC": controller,
            "wifiDbm": wifi,
            "coolerPowerPct": cooler,
            "underVoltage": under_voltage,
            "overTemp": over_temp,
        }

    def guider_status(self) -> str | None:
        """The guider's state ("Guiding", "LostLock", "Stopped", …) while its port answers, else None."""
        with self.lock:
            if self.guider_at is None or time.time() - self.guider_at > STALE_S:
                return None
            return self.guider_state

    @staticmethod
    def _plan(state: dict) -> dict | None:
        capture = state.get("capture") or {}
        progress, target = capture.get("progress"), capture.get("target")
        if state.get("page") not in ("plan", "autorun") or not isinstance(progress, dict) or not isinstance(target, dict):
            return None
        cur_target = progress.get("cur_target") or {}
        cur_plan = progress.get("cur_plan") or {}
        return {
            "target": cur_target.get("target_name") or target.get("current_name"),
            "targetIndex": target.get("current_index"),
            "targets": target.get("total"),
            "targetDone": cur_target.get("lapse"),
            "targetTotal": cur_target.get("total"),
            "planDone": cur_plan.get("lapse"),
            "planTotal": cur_plan.get("total"),
            "ended": bool(progress.get("plan_end") or target.get("plan_end")),
        }

    def _guiding(self) -> dict | None:
        if self.guider_state in (None, "Stopped") and not self.steps:
            return None
        steady = [s for s in self.steps if not s[3]][-RMS_STEPS:]

        def rms(values: list[float]) -> float | None:
            """PHD2's RMS: the spread around the mean error."""
            if not values:
                return None
            mean = sum(values) / len(values)
            return round(math.sqrt(sum((v - mean) ** 2 for v in values) / len(values)), 2)

        ra, dec = rms([s[1] for s in steady]), rms([s[2] for s in steady])
        return {
            "state": self.guider_state,
            "rmsArcsec": round(math.hypot(ra, dec), 2) if ra is not None and dec is not None else None,
            "rmsRaArcsec": ra,
            "rmsDecArcsec": dec,
            "samples": len(steady),
            "snr": self.snr,
            "pixelScaleArcsec": self.pixel_scale,
            "history": [[round(t, 1), round(r, 2), round(d, 2)] for t, r, d, _ in self.steps],
        }
