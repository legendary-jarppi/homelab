"""The calibration library (D2): every bias, dark and flat in the archive, grouped into sets, one
master per set (built with Siril, see masters.py), and the match of masters to a target's lights.

    <archive>/<YYYY>/<night>/<Bias|Dark|Flat>/[<folder>/]….fit

A set is the frames of one night with the same type, camera, size, gain, offset and binning, the
same exposure (bias and darks) or camera angle (flats), and sensor temperatures within ±2 °C of each
other (`TEMP_SPAN_C` wide). Headers are read once per file (2880-byte blocks) and kept in
`<data>/library/index.json`.

Matching (pure functions, `match_group`): per calibration group of lights (night, exposure, gain,
offset, binning, temperature, camera angle):
- dark: same gain, offset, binning and exposure, temperature within ±2 °C, nearest in time; else
  within 5 °C (warned); else another exposure at the right temperature, scaled by Siril (`-opt`,
  needs a bias; warned as missing); else none: hot pixels are then found in the lights themselves.
- flat: the same filter (a flat taken without the lights' filter, or with another, has other
  vignetting and dust; the filter comes from the header's FILTER, else the FILTERS history in
  filters.py), the same camera angle (modulo 180°: a meridian flip turns the sky angle, not the
  camera against the optics, so its dust stays put), nearest in time; else another filter or angle
  (warned). Warned when more than `FLAT_MAX_DAYS` from the lights.
- bias: needed without a matching dark or for a scaled dark; same gain, offset, binning, nearest
  temperature and time. The flat master records the bias or dark-flat it was calibrated with.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import statistics
import threading
import time
from datetime import date

import fitsio
import filters

log = logging.getLogger("library")

KINDS = {"Bias": "bias", "Dark": "dark", "Flat": "flat"}
TEMP_SPAN_C = 4.0  # a set's temperatures span at most this (±2 °C)
TEMP_MATCH_C = 2.0
TEMP_LOOSE_C = 5.0
ANGLE_MATCH_DEG = 2.0
MIN_FRAMES = 3  # fewer cannot be combined with outlier rejection
FLAT_MAX_DAYS = 7
DARK_MAX_DAYS = 180
BIAS_MAX_DAYS = 365
DARKFLAT_MAX_S = 30.0
NIGHT = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Masters are rebuilt when this changes (Siril commands or parameters in masters.py).
PIPELINE = "1"


def angle_diff(a: float, b: float, period: float = 180.0) -> float:
    d = (a - b) % period
    return min(d, period - d)


def days_between(a: str, b: str) -> int:
    return (date.fromisoformat(a) - date.fromisoformat(b)).days


def fmt_exposure(seconds: float) -> str:
    return f"{seconds * 1000:g} ms" if seconds < 1 else f"{seconds:g} s"


def fmt_temp(t: float | None) -> str:
    return "unknown temperature" if t is None else f"{t:.0f} °C"


def frame_fields(header: dict[str, str]) -> dict:
    exposure = fitsio.number(header, "EXPTIME")
    if exposure is None:
        exposure = fitsio.number(header, "EXPOSURE")
    temp = fitsio.number(header, "CCD-TEMP")
    rotator = fitsio.number(header, "ROTATOR")
    binning = fitsio.number(header, "XBINNING")
    return {
        "imageType": header.get("IMAGETYP"),
        "exposureS": exposure,
        "gain": fitsio.number(header, "GAIN"),
        "offset": fitsio.number(header, "OFFSET"),
        "sensorTempC": temp if temp is not None else fitsio.number(header, "SET-TEMP"),
        "setTempC": fitsio.number(header, "SET-TEMP"),
        "binning": int(binning) if binning else 1,
        "rotatorDeg": rotator % 360 if rotator is not None else None,
        "camera": header.get("INSTRUME") or None,
        "width": int(fitsio.number(header, "NAXIS1") or 0),
        "height": int(fitsio.number(header, "NAXIS2") or 0),
        "bayer": header.get("BAYERPAT") or None,
        "filter": (header.get("FILTER") or "").strip() or None,
        "at": fitsio.date_obs(header.get("DATE-OBS")),
    }


def same_camera(a: dict, b: dict) -> bool:
    return (a["camera"] == b["camera"] and a["width"] == b["width"] and a["height"] == b["height"]
            and a["binning"] == b["binning"])


def same_signal(a: dict, b: dict) -> bool:
    """Gain and offset: the bias level and the dark current per ADU."""
    return same_camera(a, b) and a["gain"] == b["gain"] and a["offset"] == b["offset"]


def clusters(items: list[dict], key: str, span: float) -> list[list[dict]]:
    """Split by a number into runs no wider than `span` (items without it form their own run)."""
    known = sorted((i for i in items if i[key] is not None), key=lambda i: i[key])
    out: list[list[dict]] = []
    for item in known:
        if out and item[key] - out[-1][0][key] <= span:
            out[-1].append(item)
        else:
            out.append([item])
    unknown = [i for i in items if i[key] is None]
    return out + ([unknown] if unknown else [])


def angle_clusters(items: list[dict]) -> list[list[dict]]:
    """Camera angles within ANGLE_MATCH_DEG of a run's first, the same angle kept apart from its
    flipped twin (exact angles: a flat set is one physical setup at one sky angle)."""
    out: list[list[dict]] = []
    for item in sorted(items, key=lambda i: (i["rotatorDeg"] is None, i["rotatorDeg"] or 0)):
        for run in out:
            first = run[0]["rotatorDeg"]
            if (first is None and item["rotatorDeg"] is None) or (
                    first is not None and item["rotatorDeg"] is not None
                    and angle_diff(first, item["rotatorDeg"], 360) <= ANGLE_MATCH_DEG):
                run.append(item)
                break
        else:
            out.append([item])
    return out


def set_id(kind: str, night: str, s: dict) -> str:
    parts = [kind, night.replace("-", "")]
    if kind != "flat":
        parts.append(f"{s['exposureS']:g}s")
    parts += [f"g{s['gain']:g}" if s["gain"] is not None else "gna",
              f"o{s['offset']:g}" if s["offset"] is not None else "ona", f"b{s['binning']}"]
    t = s["sensorTempC"]
    parts.append("tna" if t is None else ("m" if t < 0 else "p") + f"{abs(round(t))}c")
    if kind == "flat" and s["rotatorDeg"] is not None:
        parts.append(f"{round(s['rotatorDeg']) % 360}deg")
    return re.sub(r"[^a-z0-9.-]", "", "-".join(parts).lower())


def group_sets(frames: list[dict]) -> list[dict]:
    """Frames ({rel, kind, night, …header fields}) → sets, sorted by night and id."""
    keyed: dict[tuple, list[dict]] = {}
    for f in frames:
        exposure = round(f["exposureS"], 4) if f["exposureS"] is not None and f["kind"] != "flat" else None
        # The filter only matters for flats (bias and darks are taken with the telescope capped).
        key = (f["kind"], f["night"], f["camera"], f["width"], f["height"], f["gain"], f["offset"], f["binning"], exposure,
               filters.on(f["night"], f.get("filter")) if f["kind"] == "flat" else None)
        keyed.setdefault(key, []).append(f)
    sets = []
    for key, members in keyed.items():
        kind, night = key[0], key[1]
        runs = angle_clusters(members) if kind == "flat" else [members]
        for run in runs:
            for group in clusters(run, "sensorTempC", TEMP_SPAN_C):
                group.sort(key=lambda f: (f["at"] or 0, f["rel"]))
                temps = [f["sensorTempC"] for f in group if f["sensorTempC"] is not None]
                set_temps = [f["setTempC"] for f in group if f["setTempC"] is not None]
                angles = [f["rotatorDeg"] for f in group if f["rotatorDeg"] is not None]
                exposures = [f["exposureS"] for f in group if f["exposureS"] is not None]
                times = [f["at"] for f in group if f["at"] is not None]
                s = {
                    "type": kind, "night": night, "count": len(group),
                    "exposureS": round(statistics.median(exposures), 4) if exposures else None,
                    "gain": group[0]["gain"], "offset": group[0]["offset"],
                    "sensorTempC": round(statistics.median(temps), 1) if temps else None,
                    "setTempC": statistics.median(set_temps) if set_temps else None,
                    "binning": group[0]["binning"],
                    "rotatorDeg": round(statistics.median(angles), 1) if kind == "flat" and angles else None,
                    "camera": group[0]["camera"], "width": group[0]["width"], "height": group[0]["height"],
                    "filter": key[9],
                    "firstAt": min(times) if times else None, "lastAt": max(times) if times else None,
                    "files": [f["rel"] for f in group],
                    "digest": hashlib.sha1(json.dumps([[f["rel"], f["size"], f["mtime"]] for f in group]).encode()).hexdigest()[:8],
                    "changedAt": max(f["seenAt"] for f in group),
                }
                s["id"] = set_id(kind, night, s)
                sets.append(s)
    seen: dict[str, int] = {}
    for s in sorted(sets, key=lambda s: (s["night"], s["id"], s["firstAt"] or 0)):
        n = seen.get(s["id"], 0) + 1
        seen[s["id"]] = n
        if n > 1:
            s["id"] = f"{s['id']}-{n}"
    return sorted(sets, key=lambda s: (s["night"], s["id"]))


# --- Matching ---------------------------------------------------------------------------------

def light_groups(lights: list[dict]) -> list[dict]:
    """Accepted lights ({rel, night, …header fields}) → calibration groups."""
    keyed: dict[tuple, list[dict]] = {}
    for f in lights:
        key = (f["night"], f["camera"], f["width"], f["height"], f["gain"], f["offset"], f["binning"],
               round(f["exposureS"] or 0, 3), filters.on(f["night"], f.get("filter")))
        keyed.setdefault(key, []).append(f)
    groups = []
    for key, members in sorted(keyed.items(), key=lambda kv: (kv[0][0], kv[0][7])):
        for by_temp in clusters(members, "sensorTempC", TEMP_SPAN_C):
            # Camera angle modulo 180°: before and after a meridian flip is one physical setup.
            runs: list[list[dict]] = []
            for f in sorted(by_temp, key=lambda f: f["at"] or 0):
                for run in runs:
                    a, b = run[0]["rotatorDeg"], f["rotatorDeg"]
                    if (a is None and b is None) or (a is not None and b is not None and angle_diff(a, b) <= ANGLE_MATCH_DEG):
                        run.append(f)
                        break
                else:
                    runs.append([f])
            for run in runs:
                temps = [f["sensorTempC"] for f in run if f["sensorTempC"] is not None]
                angles = [f["rotatorDeg"] for f in run if f["rotatorDeg"] is not None]
                times = [f["at"] for f in run if f["at"] is not None]
                groups.append({
                    "night": key[0], "camera": key[1], "width": key[2], "height": key[3], "gain": key[4],
                    "offset": key[5], "binning": key[6], "exposureS": run[0]["exposureS"], "filter": key[8],
                    "sensorTempC": round(statistics.median(temps), 1) if temps else None,
                    "rotatorDeg": round(angles[0], 1) if angles else None,
                    "angles": sorted({round(a) % 360 for a in angles}),
                    "at": statistics.median(times) if times else None,
                    "frames": run,
                })
    return groups


def _age_days(master: dict, group: dict) -> float:
    """Days from the lights to the master (negative: older), by capture time or night."""
    if master.get("lastAt") and group.get("at"):
        mid = (master["firstAt"] + master["lastAt"]) / 2
        return (mid - group["at"]) / 86400
    return days_between(master["night"], group["night"])


def _temp_diff(master: dict, group: dict) -> float:
    if master["tempC"] is None or group["sensorTempC"] is None:
        return 0.0 if master["tempC"] == group["sensorTempC"] else 99.0
    return abs(master["tempC"] - group["sensorTempC"])


def _exposure_matches(a: float | None, b: float | None) -> bool:
    if a is None or b is None:
        return False
    return abs(a - b) <= max(0.01 * b, 0.002)


def pick_bias(masters: list[dict], ref: dict) -> dict | None:
    candidates = [m for m in masters if m["type"] == "bias" and same_signal(m, ref)]
    return min(candidates, key=lambda m: (round(_temp_diff(m, ref)), abs(_age_days(m, ref))), default=None)


def pick_darkflat(masters: list[dict], flat: dict) -> dict | None:
    """A dark of the flat's exposure (≤ 30 s) at its temperature: the flat's own bias and dark."""
    ref = {**flat, "sensorTempC": flat["tempC"], "at": ((flat["firstAt"] or 0) + (flat["lastAt"] or 0)) / 2 or None}
    candidates = [m for m in masters if m["type"] == "dark" and same_signal(m, flat)
                  and (m["exposureS"] or 0) <= DARKFLAT_MAX_S and _exposure_matches(m["exposureS"], flat["exposureS"])
                  and _temp_diff(m, ref) <= TEMP_LOOSE_C]
    return min(candidates, key=lambda m: (abs(_age_days(m, ref)), _temp_diff(m, ref)), default=None)


def match_group(group: dict, masters: list[dict]) -> dict:
    """The masters for one calibration group of lights, how to apply them, and warnings."""
    warnings: list[str] = []
    exposure, temp = group["exposureS"], group["sensorTempC"]
    what = f"{fmt_exposure(exposure or 0)}, gain {group['gain']:g}, {fmt_temp(temp)}" if group["gain"] is not None \
        else f"{fmt_exposure(exposure or 0)}, {fmt_temp(temp)}"
    darks = [m for m in masters if m["type"] == "dark" and same_signal(m, group)]
    exact = [m for m in darks if _exposure_matches(m["exposureS"], exposure)]
    dark, scaled = None, False
    good = [m for m in exact if _temp_diff(m, group) <= TEMP_MATCH_C]
    loose = [m for m in exact if _temp_diff(m, group) <= TEMP_LOOSE_C]
    if good:
        dark = min(good, key=lambda m: abs(_age_days(m, group)))
    elif loose:
        dark = min(loose, key=lambda m: (_temp_diff(m, group), abs(_age_days(m, group))))
        warnings.append(f"Dark at {fmt_temp(dark['tempC'])}, lights at {fmt_temp(temp)}")
    bias = pick_bias(masters, group)
    if dark is None:
        # Scaled: the shortest longer dark (scaling down adds less noise), else the longest shorter
        # one; darks of dark-flat length are too short to scale up to a light.
        others = [m for m in darks if _temp_diff(m, group) <= TEMP_MATCH_C and (m["exposureS"] or 0) > DARKFLAT_MAX_S
                  and (m["exposureS"] or 0) >= 0.5 * (exposure or 0)]
        longer = [m for m in others if m["exposureS"] >= exposure]
        if others and bias:
            dark = (min(longer, key=lambda m: (m["exposureS"], abs(_age_days(m, group)))) if longer
                    else max(others, key=lambda m: (m["exposureS"], -abs(_age_days(m, group)))))
            scaled = True
            warnings.append(f"No dark for {what}: using the {fmt_exposure(dark['exposureS'])} dark, scaled")
        else:
            warnings.append(f"No dark for {what}: hot pixels are taken out of the lights themselves")
    if dark is not None:
        age = -_age_days(dark, group)
        if age > DARK_MAX_DAYS:
            warnings.append(f"Dark is {age:.0f} days older than the lights (hot pixels change)")
    lights_bias = bias if (dark is None or scaled) else None
    if (dark is None or scaled) and bias is None:
        warnings.append(f"No bias for gain {group['gain']:g}, offset {group['offset']:g}: the lights keep their offset"
                        if group["gain"] is not None and group["offset"] is not None else "No bias for the lights")
    if lights_bias is not None and -_age_days(lights_bias, group) > BIAS_MAX_DAYS:
        warnings.append(f"Bias is {-_age_days(lights_bias, group):.0f} days older than the lights")

    flats = [m for m in masters if m["type"] == "flat" and same_camera(m, group)]
    lights_filter = group.get("filter")

    def flat_filter(m: dict) -> str | None:
        # Masters built before filters were tracked carry none: their night's filter from the history.
        return m["filter"] if "filter" in m else filters.on(m["night"])

    def flat_key(m: dict) -> tuple:
        if m["rotatorDeg"] is None or group["rotatorDeg"] is None:
            angle = 1  # unknown: after a known match, before a known mismatch
        else:
            angle = 0 if angle_diff(m["rotatorDeg"], group["rotatorDeg"]) <= ANGLE_MATCH_DEG else 2
        return flat_filter(m) != lights_filter, angle, abs(_age_days(m, group)), m["gain"] != group["gain"], -m["frames"]

    flat = min(flats, key=flat_key, default=None)
    if flat is None:
        warnings.append("No flat: vignetting and dust spots stay in the image")
    else:
        if flat_key(flat)[0]:
            taken = f"with the {flat_filter(flat)}" if flat_filter(flat) else "without a filter"
            lights = f"with the {lights_filter}" if lights_filter else "without a filter"
            warnings.append(f"Flat taken {taken}, lights {lights} (vignetting and dust spots differ)")
        if flat_key(flat)[1] == 2:
            lights = "/".join(f"{a}°" for a in group["angles"]) or f"{group['rotatorDeg']:.0f}°"
            warnings.append(f"Flat taken at camera angle {flat['rotatorDeg']:.0f}°, lights at {lights} (dust spots may not match)")
        days = days_between(group["night"], flat["night"])
        if days > FLAT_MAX_DAYS:
            warnings.append(f"Flat is {days} days older than the lights")
        elif -days > FLAT_MAX_DAYS:
            warnings.append(f"Flat is {-days} days newer than the lights")
        warnings += flat.get("warnings", [])
    calibrated_with = (flat or {}).get("calibratedWith") or {}
    return {
        "night": group["night"], "frames": len(group["frames"]), "exposureS": exposure, "gain": group["gain"],
        "offset": group["offset"], "tempC": temp, "rotatorDeg": group["rotatorDeg"], "filter": lights_filter,
        "bias": (lights_bias or {}).get("id") or calibrated_with.get("bias"),
        "dark": dark["id"] if dark else None,
        "flat": flat["id"] if flat else None,
        "darkFlat": calibrated_with.get("darkFlat"),
        "darkScaled": scaled,
        "lightsBias": lights_bias["id"] if lights_bias else None,
        "warnings": warnings,
    }


def match(lights: list[dict], masters: list[dict]) -> dict:
    """The whole match for a target's lights: the largest group's masters at the top, every group
    in `nights`, warnings of all (prefixed by the night when there is more than one group)."""
    groups = light_groups(lights)
    per = [match_group(g, masters) for g in groups]
    many = len(per) > 1
    warnings: list[str] = []
    for m in per:
        for w in m["warnings"]:
            text = f"{m['night']}: {w}" if many else w
            if text not in warnings:
                warnings.append(text)
    main = max(per, key=lambda m: m["frames"], default=None)
    return {
        "bias": main["bias"] if main else None, "dark": main["dark"] if main else None,
        "flat": main["flat"] if main else None, "darkFlat": main["darkFlat"] if main else None,
        "warnings": warnings, "nights": per,
    }, groups


# --- The library ------------------------------------------------------------------------------

class Library:
    """Index of the archive's calibration frames, the sets, and the masters built from them."""

    def __init__(self, archive: str, data: str, settle_s: float):
        self.archive = archive
        self.folder = os.path.join(data, "library")
        self.masters_dir = os.path.join(data, "masters")
        os.makedirs(self.folder, exist_ok=True)
        os.makedirs(self.masters_dir, exist_ok=True)
        self.settle_s = settle_s
        self.lock = threading.Lock()
        self.index: dict[str, dict] = self._load("index.json", {})
        state = self._load("library.json", {})
        self.masters: dict[str, dict] = state.get("masters", {})
        self.failed: dict[str, dict] = state.get("failed", {})  # set id → {digest, error, at}
        self.sets: list[dict] = []
        self.updated_at: float | None = None

    def _load(self, name: str, default):
        try:
            with open(os.path.join(self.folder, name)) as f:
                return json.load(f)
        except (OSError, ValueError):
            return default

    def _save(self, name: str, value) -> None:
        path = os.path.join(self.folder, name)
        with open(path + ".tmp", "w") as f:
            json.dump(value, f)
        os.replace(path + ".tmp", path)

    def save(self) -> None:
        with self.lock:
            state = {"masters": self.masters, "failed": self.failed}
        self._save("library.json", state)

    def scan(self) -> None:
        """Read the headers of new or changed calibration files and regroup the sets."""
        seen: dict[str, dict] = {}
        changed = 0
        now = time.time()
        for year in sorted(os.listdir(self.archive)) if os.path.isdir(self.archive) else []:
            if not re.fullmatch(r"\d{4}", year):
                continue
            for night in sorted(os.listdir(os.path.join(self.archive, year))):
                if not NIGHT.match(night):
                    continue
                for folder, kind in KINDS.items():
                    top = os.path.join(self.archive, year, night, folder)
                    for root, _, names in os.walk(top):
                        for name in names:
                            if name.startswith(".") or not name.lower().endswith((".fit", ".fits")):
                                continue
                            path = os.path.join(root, name)
                            rel = os.path.relpath(path, self.archive)
                            try:
                                st = os.stat(path)
                            except OSError:
                                continue
                            old = self.index.get(rel)
                            if old and old["size"] == st.st_size and old["mtime"] == st.st_mtime:
                                seen[rel] = old
                                continue
                            try:
                                parsed = fitsio.read_header(path)
                            except OSError as e:
                                log.warning("%s: %s", rel, e)
                                continue
                            if parsed is None:
                                log.warning("%s: no FITS header", rel)
                                continue
                            seen[rel] = {"kind": kind, "night": night, "size": st.st_size, "mtime": st.st_mtime,
                                         "seenAt": min(st.st_ctime, now), **frame_fields(parsed[0])}
                            changed += 1
        sets = group_sets([{"rel": rel, **f} for rel, f in seen.items() if f.get("exposureS") is not None])
        with self.lock:
            removed = len(set(self.index) - set(seen))
            self.index = seen
            self.sets = sets
            self.updated_at = time.time()
        if changed or removed:
            self._save("index.json", seen)
            log.info("library: %d calibration frames (%d new or changed, %d gone), %d sets", len(seen), changed, removed, len(sets))

    # --- master planning ---

    def desired(self) -> list[dict]:
        """Masters the sets call for, in build order (bias, darks, then flats, which need them):
        {id, set, calibrator?}. A master id carries a digest of its frames (and of the master the
        flat is calibrated with), so more frames or a better bias make a new master."""
        with self.lock:
            sets = list(self.sets)
            masters = dict(self.masters)
        plan: list[dict] = []
        for kind in ("bias", "dark", "flat"):
            for s in sets:
                if s["type"] != kind or s["count"] < MIN_FRAMES:
                    continue
                calibrator = None
                if kind == "flat":
                    flat_like = {**s, "tempC": s["sensorTempC"], "frames": s["count"]}
                    built = list(masters.values()) + [p["master"] for p in plan]
                    darkflat = pick_darkflat(built, flat_like)
                    bias = None if darkflat else pick_bias(built, {**flat_like, "sensorTempC": s["sensorTempC"],
                                                                   "at": s["firstAt"]})
                    calibrator = {"darkFlat": darkflat["id"]} if darkflat else ({"bias": bias["id"]} if bias else {})
                digest = hashlib.sha1(json.dumps([PIPELINE, s["digest"], calibrator]).encode()).hexdigest()[:6]
                mid = f"{s['id']}-{digest}"
                plan.append({"id": mid, "set": s, "calibrator": calibrator,
                             "master": masters.get(mid) or self.master_record(mid, s, calibrator, None)})
        return plan

    def master_record(self, mid: str, s: dict, calibrator: dict | None, stats: dict | None) -> dict:
        warnings = []
        if s["type"] == "flat" and not calibrator:
            warnings.append("Flat calibrated without bias or dark-flat (none matched its gain and offset)")
        return {
            "id": mid, "type": s["type"], "builtAt": None, "sets": [s["id"]], "frames": s["count"],
            "exposureS": s["exposureS"], "gain": s["gain"], "offset": s["offset"], "tempC": s["sensorTempC"],
            "setTempC": s["setTempC"], "rotatorDeg": s["rotatorDeg"], "night": s["night"], "binning": s["binning"],
            "camera": s["camera"], "width": s["width"], "height": s["height"], "filter": s.get("filter"),
            "firstAt": s["firstAt"],
            "lastAt": s["lastAt"], "median": (stats or {}).get("median"), "noise": (stats or {}).get("noise"),
            "fitsUrl": f"/masters/{mid}.fits", "calibratedWith": calibrator if s["type"] == "flat" else None,
            "warnings": warnings, "digest": s["digest"],
        }

    def pending(self) -> list[dict]:
        """Planned masters not built yet whose set has settled (no new file for `settle_s`) and
        has not failed with the same frames."""
        now = time.time()
        with self.lock:
            built, failed = set(self.masters), dict(self.failed)
        out = []
        for p in self.desired():
            if p["id"] in built or now - p["set"]["changedAt"] < self.settle_s:
                continue
            if failed.get(p["set"]["id"], {}).get("id") == p["id"]:
                continue
            out.append(p)
        return out

    def add_master(self, plan: dict, fits_path: str, stats: dict) -> dict:
        record = self.master_record(plan["id"], plan["set"], plan["calibrator"], stats)
        record["builtAt"] = time.time()
        os.replace(fits_path, self.master_path(plan["id"]))
        with self.lock:
            self.masters[plan["id"]] = record
            self.failed.pop(plan["set"]["id"], None)
        self.prune()
        self.save()
        return record

    def add_failure(self, plan: dict, error: str) -> None:
        with self.lock:
            self.failed[plan["set"]["id"]] = {"id": plan["id"], "error": error, "at": time.time()}
        self.save()

    def prune(self) -> None:
        """Masters no set calls for any more (superseded by more frames, or their frames gone),
        once their replacement exists."""
        wanted = {p["id"] for p in self.desired()}
        sets_with_master: dict[str, str] = {}
        with self.lock:
            for mid, m in self.masters.items():
                if mid in wanted:
                    sets_with_master[m["sets"][0]] = mid
            stale = [mid for mid, m in self.masters.items() if mid not in wanted
                     and (m["sets"][0] in sets_with_master or m["sets"][0] not in {s["id"] for s in self.sets})]
            for mid in stale:
                del self.masters[mid]
        for mid in stale:
            try:
                os.unlink(self.master_path(mid))
            except FileNotFoundError:
                pass
            log.info("master %s removed (superseded)", mid)

    def master_path(self, mid: str) -> str:
        return os.path.join(self.masters_dir, f"{mid}.fits")

    def masters_list(self) -> list[dict]:
        with self.lock:
            return sorted(self.masters.values(), key=lambda m: (m["night"], m["id"]))

    def set_by_id(self, sid: str) -> dict | None:
        with self.lock:
            return next((s for s in self.sets if s["id"] == sid), None)

    def json(self) -> dict:
        public_set = ("id", "type", "night", "count", "exposureS", "gain", "offset", "sensorTempC", "setTempC",
                      "binning", "rotatorDeg", "camera", "filter", "firstAt", "lastAt")
        public_master = ("id", "type", "builtAt", "sets", "frames", "exposureS", "gain", "offset", "tempC",
                         "rotatorDeg", "night", "median", "noise", "fitsUrl", "binning", "camera", "calibratedWith",
                         "warnings")
        with self.lock:
            sets = [{k: s[k] for k in public_set} for s in self.sets]
            # Flats built before filters were tracked: their night's filter from the history; bias and darks have none.
            masters = [{**{k: m.get(k) for k in public_master},
                        "filter": (m["filter"] if "filter" in m else filters.on(m["night"])) if m["type"] == "flat" else None}
                       for m in sorted(self.masters.values(), key=lambda m: (m["night"], m["id"]))]
            failed = [{"set": sid, **f} for sid, f in self.failed.items()]
            updated = self.updated_at
        pending = [p["id"] for p in self.pending()] if updated else []
        return {"sets": sets, "masters": masters, "pending": pending, "failed": failed, "updatedAt": updated}
