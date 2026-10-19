"""More notifications: clouds, dew suspected, guiding lost, meridian flip result, ASIAIR storage,
sensor not cooling, under-voltage (topic `telescope`, through the same Notifier).

The decisions are small detector classes without I/O (tests/test_alerts.py); Alerts feeds them every
CHECK_S from the live state (live.py), the current session (main.py) and its analysed frames
(sessions.py), and sends what they report. Each one says something once per episode and is ready
again once the condition has cleared. What is already the case when the service starts is taken
as known, not announced (as for the other notifications). Only the dew check reaches out: the air
temperature and dew point at the site in the FITS header (SITELAT/SITELONG) from Open-Meteo, asked
only while the stars are swelling and kept for WEATHER_CACHE_S.
"""

from __future__ import annotations

import json
import logging
import statistics
import threading
import time
import urllib.parse
import urllib.request

import rejection

log = logging.getLogger("alerts")

CHECK_S = 10
# Frame-based notifications (clouds, dew) only while the session is active and its newest analysed
# frame ended at most this long ago (not for a backlog analysed after a restart).
FRESH_S = 15 * 60

# Clouds: the newest CLOUDS_FRAMES frames in a row have collapsed (under MIN_STARS, or under
# CLOUDS_STARS_RATIO of the session median: the rejection's "clouds" limit). Clear again: the newest
# CLEAR_FRAMES are back at CLEAR_STARS_RATIO of the median or better (a margin, so a thin veil
# hovering around the limit does not flap).
CLOUDS_STARS_RATIO = rejection.STARS_MIN_RATIO
CLOUDS_FRAMES = 2
CLEAR_STARS_RATIO = 0.7
CLEAR_FRAMES = 2

# Dew: HFR rising steadily over the newest DEW_FRAMES frames (at least DEW_RISING_SHARE of the steps
# up, the fitted line up by DEW_HFR_RISE or more) while the air at the site is within DEW_SPREAD_C of
# its dew point. Once per session.
DEW_FRAMES = 6
DEW_RISING_SHARE = 0.8
DEW_HFR_RISE = 0.15
DEW_SPREAD_C = 2.0
WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
WEATHER_CACHE_S = 15 * 60
WEATHER_RETRY_S = 5 * 60

# Guiding lost: the guider not "Guiding" for this long while the camera exposes a frame, in a
# session that has been guided.
GUIDING_LOST_S = 60

# Meridian flip: done once a new exposure started after the flip has run FLIP_CONFIRM_S (or a frame
# is saved FLIP_FRAME_GRACE_S after it began); "not imaging again" when neither within FLIP_RESUME_S.
FLIP_RESUME_S = 20 * 60
FLIP_CONFIRM_S = 20
FLIP_FRAME_GRACE_S = 60

# ASIAIR storage: the share the frames go to has less than this free (either), once per crossing.
STORAGE_MIN_FRACTION = 0.10
STORAGE_MIN_BYTES = 15e9

# Sensor not cooling: above the set point by more than WARM_MARGIN_C for WARM_S in an active session.
WARM_MARGIN_C = 2.0
WARM_S = 15 * 60

# Under-voltage (any time the ASIAIR's imager port answers): once per occurrence; a new occurrence
# after it has been fine for UNDERVOLT_QUIET_S.
UNDERVOLT_QUIET_S = 10 * 60

GUIDER_STATES = {"LostLock": "star lost", "Stopped": "stopped", "Looping": "looping, not guiding",
                 "Calibrating": "calibrating", "Paused": "paused", "Selected": "star selected, not guiding"}


# --- detectors (no I/O) ----------------------------------------------------------------------------


class Episode:
    """A condition that counts once when it has held for `after_s`; ready again once it has been
    false for `quiet_s`. update(..., emit=False) takes a condition already true as known."""

    def __init__(self, after_s: float, quiet_s: float = 0):
        self.after_s, self.quiet_s = after_s, quiet_s
        self.since: float | None = None
        self.clear_since: float | None = None
        self.fired = False

    def update(self, bad: bool, now: float, emit: bool = True) -> bool:
        if not bad:
            self.since = None
            if self.fired:
                self.clear_since = self.clear_since if self.clear_since is not None else now
                if now - self.clear_since >= self.quiet_s:
                    self.fired, self.clear_since = False, None
            return False
        self.clear_since = None
        if self.since is None:
            self.since = now
        if not emit:
            self.fired = True
        if self.fired or now - self.since < self.after_s:
            return False
        self.fired = True
        return True

    def held_s(self, now: float) -> float:
        return 0.0 if self.since is None else now - self.since


def cloud_state(stars: list[int]) -> tuple[str, float | None, int]:
    """("cloudy" | "clear" | "unsure", the newest frame's stars as a fraction of the session median
    (None while fewer than rejection.MIN_FRAMES frames), the number of collapsed frames in a row)."""
    if not stars:
        return "unsure", None, 0
    median = statistics.median(stars) if len(stars) >= rejection.MIN_FRAMES else None

    def collapsed(n: int) -> bool:
        return n < rejection.MIN_STARS or bool(median and n < CLOUDS_STARS_RATIO * median)

    def clear(n: int) -> bool:
        return n >= rejection.MIN_STARS and (not median or n >= CLEAR_STARS_RATIO * median)

    run = 0
    for n in reversed(stars):
        if not collapsed(n):
            break
        run += 1
    ratio = stars[-1] / median if median else None
    if run >= CLOUDS_FRAMES:
        return "cloudy", ratio, run
    if len(stars) >= CLEAR_FRAMES and all(clear(n) for n in stars[-CLEAR_FRAMES:]):
        return "clear", ratio, 0
    return "unsure", ratio, run


class Clouds:
    """Per session: ("clouds", ratio, frames) when the stars collapse, ("clear", ratio, 0) when they
    are back after that."""

    def __init__(self):
        self.cloudy: dict[str, bool] = {}

    def update(self, sid: str, stars: list[int], emit: bool = True) -> tuple | None:
        state, ratio, run = cloud_state(stars)
        was = self.cloudy.get(sid, False)
        if state == "cloudy" and not was:
            self.cloudy[sid] = True
            return ("clouds", ratio, run) if emit else None
        if state == "clear" and was:
            self.cloudy[sid] = False
            return ("clear", ratio, 0) if emit else None
        return None


def hfr_rise(hfrs: list[float | None]) -> float | None:
    """The relative rise of the HFR over the newest DEW_FRAMES frames when it climbs steadily."""
    window = hfrs[-DEW_FRAMES:]
    if len(window) < DEW_FRAMES or any(h is None or h <= 0 for h in window):
        return None
    ups = sum(b > a for a, b in zip(window, window[1:]))
    if ups < DEW_RISING_SHARE * (DEW_FRAMES - 1):
        return None
    n = len(window)
    mx, my = (n - 1) / 2, sum(window) / n
    slope = sum((x - mx) * (y - my) for x, y in enumerate(window)) / sum((x - mx) ** 2 for x in range(n))
    start, end = my - slope * mx, my + slope * mx
    if start <= 0:
        return None
    rise = end / start - 1
    return rise if rise >= DEW_HFR_RISE else None


class Dew:
    """Per session, once: (HFR rise, air temperature, dew point) when the stars swell steadily and
    the air is near its dew point. `air()` gives (temperature, dew point) or None; it is asked only
    while the HFR climbs."""

    def __init__(self):
        self.done: set[str] = set()

    def update(self, sid: str, hfrs: list[float | None], air, emit: bool = True) -> tuple | None:
        if sid in self.done:
            return None
        rise = hfr_rise(hfrs)
        if rise is None:
            return None
        if not emit:
            self.done.add(sid)
            return None
        reading = air()
        if reading is None or reading[0] - reading[1] > DEW_SPREAD_C:
            return None
        self.done.add(sid)
        return rise, reading[0], reading[1]


class GuidingLost:
    """Seconds without guiding, once per episode, while the camera exposes in a session that has
    been guided (unguided imaging is not an alarm)."""

    def __init__(self):
        self.episode = Episode(GUIDING_LOST_S)
        self.guided: tuple | None = None

    def update(self, session: tuple | None, activity: str | None, guider: str | None, now: float,
               emit: bool = True) -> float | None:
        if guider == "Guiding" and session is not None:
            self.guided = session
        bad = (session is not None and self.guided == session and activity == "Exposing"
               and guider is not None and guider != "Guiding")
        return self.episode.held_s(now) if self.episode.update(bad, now, emit) else None


class Flip:
    """("done", seconds, was_late) when imaging resumes after a meridian flip; ("late", seconds) once
    when it has not within FLIP_RESUME_S. `exposure_started`: the start of a light exposure that has
    been running for FLIP_CONFIRM_S, else None."""

    def __init__(self):
        self.started: float | None = None
        self.late = False

    def update(self, activity: str | None, exposure_started: float | None, newest_frame_at: float | None,
               ended: bool, now: float) -> tuple | None:
        if self.started is None:
            if activity == "Meridian flip" and not ended:
                self.started, self.late = now, False
            return None
        if ended:
            self.started = None
            return None
        resumed = (exposure_started is not None and exposure_started >= self.started) or (
            newest_frame_at is not None and newest_frame_at > self.started + FLIP_FRAME_GRACE_S)
        if resumed:
            took, late = now - self.started, self.late
            self.started = None
            return "done", took, late
        if not self.late and now - self.started >= FLIP_RESUME_S:
            self.late = True
            return "late", now - self.started
        return None


def storage_low(free: float, total: float) -> bool:
    return free < STORAGE_MIN_BYTES or (total > 0 and free < STORAGE_MIN_FRACTION * total)


class Storage:
    """Per share: True once when it becomes low; ready again when it is not."""

    def __init__(self):
        self.low: dict[str, bool] = {}

    def update(self, share: str, free: float, total: float, emit: bool = True) -> bool:
        low = storage_low(free, total)
        crossed = low and not self.low.get(share, False)
        self.low[share] = low
        return crossed and emit


# --- weather -----------------------------------------------------------------------------------------


class Weather:
    """Air temperature and dew point now at a site (Open-Meteo, no key), cached."""

    def __init__(self, url: str = WEATHER_URL):
        self.url = url
        self.cache: dict[tuple, tuple[float, tuple[float, float] | None]] = {}

    def air(self, lat: float, lon: float) -> tuple[float, float] | None:
        key = (round(lat, 2), round(lon, 2))
        now = time.time()
        cached = self.cache.get(key)
        if cached and now < cached[0]:
            return cached[1]
        query = urllib.parse.urlencode({"latitude": key[0], "longitude": key[1],
                                        "current": "temperature_2m,dew_point_2m", "timezone": "UTC"})
        try:
            with urllib.request.urlopen(f"{self.url}?{query}", timeout=15) as response:
                current = json.load(response)["current"]
            reading = (float(current["temperature_2m"]), float(current["dew_point_2m"]))
            self.cache[key] = (now + WEATHER_CACHE_S, reading)
        except Exception as e:  # noqa: BLE001 - no internet: no dew notification, nothing else
            log.warning("weather: %s", e)
            reading = None
            self.cache[key] = (now + WEATHER_RETRY_S, None)
        return reading


# --- wiring ------------------------------------------------------------------------------------------


def minutes(seconds: float) -> str:
    h, m = divmod(round(seconds / 60), 60)
    return f"{h} h {m} min" if h else f"{m} min"


class Alerts:
    def __init__(self, telescope, notifier, weather: Weather):
        self.t, self.notifier, self.weather = telescope, notifier, weather
        self.clouds, self.dew = Clouds(), Dew()
        self.guiding, self.flip = GuidingLost(), Flip()
        self.warm = Episode(WARM_S)
        self.undervolt = Episode(0, UNDERVOLT_QUIET_S)
        self.storage = Storage()
        # What is already the case at start is known, not news: the frames of the sessions loaded at
        # start (at their first check), the live state at the first answer from the control ports, the
        # storage at its first listing. Nothing is checked before the first poll has finished (until
        # then there is no current session to look at).
        self.loaded = {s["id"] for s in telescope.store.list(None)}
        self.checked: set[str] = set()
        self.live_seeded = self.storage_seeded = False

    def start(self) -> None:
        threading.Thread(target=self.run, name="alerts", daemon=True).start()

    def run(self) -> None:
        while True:
            try:
                self.check(time.time())
            except Exception:  # noqa: BLE001 - never let the checks die
                log.exception("alerts")
            time.sleep(CHECK_S)

    def send(self, title: str, body: str) -> None:
        self.notifier.send(title, body)

    def check(self, now: float) -> None:
        t = self.t
        if not t.has_polled():
            return
        live = t.live_now()
        session = t.session(now, live)
        active = bool(session and session["active"])
        view = t.store.alert_view(session["id"]) if session and session["id"] else None
        if live is not None:
            self.check_live(now, live, session, active, view)
            self.live_seeded = True
        self.check_frames(now, session, active, view)
        self.check_storage()

    def check_live(self, now: float, live: dict, session: dict | None, active: bool, view: dict | None) -> None:
        emit = self.live_seeded
        if self.undervolt.update(bool(live.get("underVoltage")), now, emit):
            self.send("ASIAIR under-voltage",
                      "The ASIAIR reports a low supply voltage: frames may be lost or it may restart. "
                      "Check the power supply and its cable.")
        target = session["target"] if session else ((live.get("plan") or {}).get("target") or "the telescope")
        activity = live["activity"]
        guider = self.t.live.guider_status() if self.t.live else None
        key = self.t.session_key(session) if active else None
        lost = self.guiding.update(key, activity, guider, now, emit)
        if lost is not None:
            state = GUIDER_STATES.get(guider, guider)
            self.send(f"Guiding lost: {target}",
                      f"The guider has not been guiding for {round(lost)} s ({state}) while the camera is "
                      "exposing: frames will trail until it recovers.")

        exposure = live.get("exposure")
        confirmed = (exposure["startedAt"] if activity == "Exposing" and exposure
                     and exposure["elapsedS"] >= min(FLIP_CONFIRM_S, exposure["totalS"]) else None)
        ended = bool(session) and self.t.ended(session, now, live)
        newest = session["lastFrameAt"] if session else None
        result = self.flip.update(activity, confirmed, newest, ended, now)
        if result and result[0] == "done":
            took = minutes(result[1])
            self.send(f"Meridian flip done: {target}",
                      f"Imaging again, {took} after the flip began." if result[2]
                      else f"Imaging again after the flip ({took}).")
        elif result:
            self.send(f"Meridian flip: {target} not imaging again",
                      f"{minutes(result[1])} since the meridian flip began and no new frame; the ASIAIR shows: "
                      f"{activity}. Check it in the ASIAIR app.")

        sensor, set_point = live.get("sensorTempC"), (view or {}).get("setTempC")
        warm = active and sensor is not None and set_point is not None and sensor > set_point + WARM_MARGIN_C
        if self.warm.update(warm, now, emit):
            cooler = live.get("coolerPowerPct")
            power = f" with the cooler at {cooler:g} %" if cooler is not None else ""
            self.send(f"Sensor not cooling: {target}",
                      f"The sensor has been at {sensor:.1f} °C for {minutes(self.warm.held_s(now))}, set point "
                      f"{set_point:g} °C{power}. Darks taken at the set point will not match these frames.")

    def check_frames(self, now: float, session: dict | None, active: bool, view: dict | None) -> None:
        if not (session and view and view["frames"]):
            return
        frames, sid, target = view["frames"], session["id"], session["target"]
        # A session loaded at start: its first look only takes in what is already there.
        emit = sid not in self.loaded or sid in self.checked
        self.checked.add(sid)
        fresh = now - (frames[-1]["at"] + session["exposureS"]) <= FRESH_S
        if emit and not (active and fresh):
            return
        event = self.clouds.update(sid, [f["stars"] for f in frames], emit)
        if event and event[0] == "clouds":
            _, ratio, run = event
            what = (f"stars down to {round(100 * ratio)} % of the session median" if ratio is not None
                    else f"only {frames[-1]['stars']} stars")
            self.send(f"Clouds over {target}", f"{what[0].upper()}{what[1:]} ({run} frames in a row).")
        elif event:
            ratio = event[1]
            back = f"stars back to {round(100 * ratio)} % of the session median" if ratio is not None else "stars back"
            self.send(f"Clear again over {target}", f"{back[0].upper()}{back[1:]}.")

        site = view["site"]
        if site:
            def air():
                return self.weather.air(site["lat"], site["lon"])

            dew = self.dew.update(sid, [f["hfr"] for f in frames], air, emit)
            if dew:
                rise, temp, dew_point = dew
                self.send(f"Dew suspected: {target}",
                          f"Stars are swelling: HFR up {round(100 * rise)} % over the last {DEW_FRAMES} frames, and "
                          f"the air at the site is {temp - dew_point:.1f} °C from its dew point ({temp:.1f} °C, "
                          f"dew point {dew_point:.1f} °C). Check the dew heater.")

    def check_storage(self) -> None:
        shares, share, frame_bytes = self.t.storage_in_use()
        if not shares:
            return
        emit = self.storage_seeded
        self.storage_seeded = True
        for s in shares:
            if s["name"] != share:
                continue
            if self.storage.update(s["name"], s["freeBytes"], s["totalBytes"], emit):
                free, total = s["freeBytes"], s["totalBytes"]
                pct = f" ({round(100 * free / total)} %)" if total else ""
                room = f", room for about {int(free // frame_bytes)} more frames" if frame_bytes else ""
                self.send(f"ASIAIR storage low: {share}",
                          f"{free / 1e9:.1f} GB free of {total / 1e9:.0f} GB{pct}{room}. "
                          "Copy and delete old frames on the ASIAIR.")
