"""PHD2 guide logs in the archive (PHD2_GuideLog_<date>_<time>.txt, written by the ASIAIR's PHD2,
log version 2.5): guiding sections, their RMS, and what they tell about the mount (EQMod Mount).

    Guiding Begins at 2026-10-17 22:31:00
    Pixel scale = 3.11 arc-sec/px, Binning = 1, Focal length = 249 mm
    Exposure = 3000 ms
    Mount = EQMod Mount,  connected, guiding enabled, xAngle = 34.8, xRate = 0.814, yAngle = -53.4, yRate = 1.155, parity = +/-,
    Dec = 62.8 deg, Hour angle = 0.15 hr, Pier side = East, Rotator pos = Unknown
    Frame,Time,mount,dx,dy,RARawDistance,DECRawDistance,RAGuideDistance,DECGuideDistance,RADuration,RADirection,DECDuration,DECDirection,XStep,YStep,StarMass,SNR,ErrorCode
    INFO: SETTLING STATE CHANGE, Settling started
    1,3.207,"Mount",-0.064,-0.095,0.106,0.045,0.067,0.000,123,W,0,,,,2693,36.48,0
    INFO: SETTLING STATE CHANGE, Settling complete
    1156,3468.058,"DROP",,,,,,,,,,,,,536,16.19,6,"Star lost - mass changed"
    Guiding Ends at 2026-10-17 23:31:31

Times are the ASIAIR's clock; `Time` is seconds since the section began. Distances are guide
camera pixels along the mount's axes (RA, Dec), so × pixel scale = arcseconds on the sky. The
ASIAIR splits a night into sections (each auto focus, flip or lost star stops guiding) and writes no
DITHER lines (they are still counted if present).
"""

from __future__ import annotations

import csv
import json
import math
import os
import re
import threading
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np

from archive import Archive

BEGINS = re.compile(r"^Guiding Begins at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})")
ENDS = re.compile(r"^Guiding Ends at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})")
ENABLED = re.compile(r"Log enabled at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})")
PIXEL_SCALE = re.compile(r"Pixel scale = ([\d.]+) arc-sec/px")
EXPOSURE = re.compile(r"^Exposure = (\d+) ms")
MOUNT = re.compile(r"^Mount = ([^,]+),.*?xAngle = (-?[\d.]+), xRate = (-?[\d.]+), yAngle = (-?[\d.]+), yRate = (-?[\d.]+)")
POINTING = re.compile(r"^Dec = (-?[\d.]+) deg, Hour angle = (-?[\d.]+) hr, Pier side = (\w+)")
ID = re.compile(r"^PHD2_GuideLog_[0-9_-]{1,40}$")

# Periodic error: periods from PE_MIN_PERIOD_S (a few guide frames; shorter is seeing) to
# PE_MAX_PERIOD_S (above every common worm period, 478–638 s for Sky-Watcher EQ mounts; the mount
# model is not assumed). A section is analysed only when it lasts PE_MIN_SECTION_S: two cycles of the
# longest period, so a period is seen at least twice and is not confused with the removed drift.
PE_MIN_PERIOD_S = 20
PE_MAX_PERIOD_S = 1200
PE_MIN_SECTION_S = 2 * PE_MAX_PERIOD_S
PE_OVERSAMPLE = 4  # frequency step 1 / (PE_OVERSAMPLE × PE_MIN_SECTION_S)
PE_SMOOTH_S = 30  # running mean before the peak-to-peak, against seeing
PE_GAP_S = 30  # resampling does not bridge gaps longer than this (lost star)
PE_TOP = 5
PE_DISTINCT = 0.1  # a peak within 10 % of a stronger one's period is the same peak
# Dec drift over sections of at least this length.
DRIFT_MIN_S = 600
# A step with an error over JUMP_ARCSEC on either axis measured another star or a hot pixel (seen
# 2026-10-17: single steps of 50–165″ at SNR 6, then back): an outlier, left out of the RMS, the
# reconstructions and the backlash (its correction pulse still counts, the mount did move). Sections
# with over MAX_LOST_SHARE of their steps lost or outliers are left out of the periodic error and
# the drift.
JUMP_ARCSEC = 10.0
MAX_LOST_SHARE = 0.02
# A section's RMS needs this many steady steps.
RMS_MIN_STEPS = 10
SIDEREAL_RAD_PER_MIN = 2 * math.pi / 1436.068
# Backlash: steps followed after a Dec pulse, and the share of the first pulse's distance the
# error must move by to count as a response.
BACKLASH_MAX_STEPS = 20
BACKLASH_RESPONSE = 0.5
BACKLASH_MIN_EVENTS = 10
SERIES_POINTS = 3000
PE_POINTS = 1500


@dataclass
class Section:
    started_at: float
    ended_at: float | None = None
    pixel_scale: float | None = None
    exposure_s: float | None = None
    mount: str | None = None
    x_rate: float | None = None
    y_rate: float | None = None
    dec: float | None = None
    hour_angle: float | None = None
    pier: str | None = None
    dithers: int = 0
    # Per row: time (s since start), valid (a measured star, no error code), RA/Dec raw and guide
    # distances (px), pulse durations (ms, signed by the guide distance), settling, after a dither.
    rows: list[tuple] = field(default_factory=list)


def local_time(text: str, tz: ZoneInfo) -> float:
    return datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=tz).timestamp()


def number(text: str) -> float:
    try:
        return float(text) if text else 0.0
    except ValueError:
        return 0.0


def parse(text: str, tz: ZoneInfo) -> tuple[float | None, list[Section]]:
    """The log's start (Log enabled at) and its guiding sections (calibration sections skipped)."""
    enabled = None
    sections: list[Section] = []
    section: Section | None = None
    in_rows = settling = dithering = False
    for raw in text.splitlines():
        line = raw.strip()
        if enabled is None and (m := ENABLED.search(line)):
            enabled = local_time(m[1], tz)
        if m := BEGINS.match(line):
            section = Section(local_time(m[1], tz))
            sections.append(section)
            in_rows = settling = dithering = False
            continue
        if section is None:
            continue
        if m := ENDS.match(line):
            section.ended_at = local_time(m[1], tz)
            section = None
            continue
        if line.startswith("Calibration Begins"):
            section = None
            continue
        if line.startswith("Frame,Time"):
            in_rows = True
            continue
        if line.startswith("INFO:"):
            if "Settling started" in line:
                settling = True
            elif "Settling complete" in line or "Settling failed" in line:
                settling = dithering = False
            elif "DITHER" in line:
                section.dithers += 1
                dithering = True
            continue
        if not in_rows:
            if m := PIXEL_SCALE.search(line):
                section.pixel_scale = float(m[1])
            elif m := EXPOSURE.match(line):
                section.exposure_s = int(m[1]) / 1000
            elif m := MOUNT.match(line):
                section.mount = m[1].strip()
                section.x_rate, section.y_rate = float(m[3]), float(m[5])
            elif m := POINTING.match(line):
                section.dec, section.hour_angle, section.pier = float(m[1]), float(m[2]), m[3]
            continue
        if not line[:1].isdigit():
            continue
        c = next(csv.reader([line]))
        if len(c) < 18:
            continue
        valid = c[2] != "DROP" and c[17].strip() in ("", "0") and c[5] != ""
        ra_guide, dec_guide = number(c[7]), number(c[8])
        ra_ms = number(c[9]) * (1 if ra_guide >= 0 else -1)
        dec_ms = number(c[11]) * (1 if dec_guide >= 0 else -1)
        section.rows.append((number(c[1]), valid, number(c[5]), number(c[6]), ra_guide, dec_guide,
                             ra_ms, dec_ms, settling or dithering, dithering))
    return enabled, sections


def rms(values: np.ndarray) -> float | None:
    """PHD2's RMS: the spread around the mean."""
    return float(np.std(values)) if len(values) else None


def r(value: float | None, digits: int = 2) -> float | None:
    return None if value is None or not math.isfinite(value) else round(float(value), digits)


def downsample(points: list, limit: int) -> list:
    if len(points) <= limit:
        return points
    step = len(points) / limit
    return [points[int(i * step)] for i in range(limit)]


def amplitude_spectrum(t: np.ndarray, y: np.ndarray, freqs: np.ndarray) -> np.ndarray:
    """Least-squares sinusoid amplitude at each frequency (a Lomb–Scargle periodogram in amplitude
    units: a pure sine of amplitude A gives A at its frequency), for unevenly sampled `y` (mean removed)."""
    out = np.empty(len(freqs))
    y = y - y.mean()
    for start in range(0, len(freqs), 128):  # bounded memory: 128 × samples per block
        w = 2 * np.pi * freqs[start:start + 128, None] * t[None, :]
        c, s = np.cos(w), np.sin(w)
        cc, ss, cs = (c * c).sum(1), (s * s).sum(1), (c * s).sum(1)
        cy, sy = c @ y, s @ y
        det = cc * ss - cs * cs
        a = (cy * ss - sy * cs) / det
        b = (sy * cc - cy * cs) / det
        out[start:start + 128] = np.hypot(a, b)
    return out


PE_FREQS = np.arange(1 / PE_MAX_PERIOD_S, 1 / PE_MIN_PERIOD_S, 1 / (PE_OVERSAMPLE * PE_MIN_SECTION_S))


def peak_indices(amplitudes: np.ndarray, freqs: np.ndarray = PE_FREQS, count: int = PE_TOP) -> list[int]:
    """The strongest local maxima, distinct by period, strongest first."""
    peaks = [i for i in range(1, len(amplitudes) - 1)
             if amplitudes[i] >= amplitudes[i - 1] and amplitudes[i] > amplitudes[i + 1]]
    peaks.sort(key=lambda i: -amplitudes[i])
    chosen: list[int] = []
    for i in peaks:
        if all(abs(1 / freqs[i] - 1 / freqs[j]) > PE_DISTINCT * (1 / freqs[j]) for j in chosen):
            chosen.append(i)
        if len(chosen) == count:
            break
    return chosen


def top_periods(curves: list[tuple[float, np.ndarray, np.ndarray]], amplitudes: np.ndarray,
                count: int = PE_TOP) -> list[dict]:
    """The strongest periods of the duration-weighted spectrum `amplitudes` of `curves` (weight,
    times, drift-free positions), each refined on a fine grid between its neighbouring frequencies
    (the coarse grid's period step is ~P² / 9600 s, 24 s at 480 s)."""
    weights = np.array([w for w, _, _ in curves])
    out = []
    for i in peak_indices(amplitudes, count=count):
        fine = np.linspace(PE_FREQS[i - 1], PE_FREQS[i + 1], 41)
        amp = sum(w * amplitude_spectrum(t, y, fine) for w, t, y in curves) / weights.sum()
        k = int(np.argmax(amp))
        out.append({"periodS": round(float(1 / fine[k]), 1), "amplitudeArcsec": round(float(amp[k]), 2)})
    return out


def reconstruct(t: np.ndarray, valid: np.ndarray, raw: np.ndarray, guide: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The uncorrected position at the measured steps: the raw offset plus every correction sent
    before it (PHD2's guide distance has the sign of the error it corrects, and a pulse moves the
    star after its step's measurement). Returns (times, positions) of the valid steps."""
    applied = np.concatenate([[0.0], np.cumsum(guide)[:-1]])
    return t[valid], (raw + applied)[valid]


def moved(guide: np.ndarray, ms: np.ndarray, rate: float | None) -> np.ndarray:
    """What each correction moved (px): the guide distance, unless the pulse was cut short (Max
    duration 2000 ms): then its duration × the calibrated rate (px/s). PHD2 logs the distance it
    wanted (a 165″ "correction" after an outlier on 2026-10-17 was a 2000 ms pulse, 2.3 px)."""
    if not rate:
        return guide
    limit = np.abs(ms) / 1000 * rate
    return np.where(np.abs(guide) > limit * 1.05, np.sign(guide) * limit, guide)


def periodic_error(t: np.ndarray, pos: np.ndarray) -> dict:
    """Linear drift removed, the amplitude spectrum and the smoothed peak-to-peak (arcsec in, arcsec out)."""
    slope, offset = np.polyfit(t, pos, 1)
    residual = pos - (slope * t + offset)
    amplitudes = amplitude_spectrum(t, residual, PE_FREQS)
    step = float(np.median(np.diff(t))) if len(t) > 1 else 3.0
    grid = np.arange(t[0], t[-1], step)
    uniform = np.interp(grid, t, residual)
    # Grid points inside a gap (lost star) are left out of the running mean.
    nearest = np.minimum(np.abs(t[np.clip(np.searchsorted(t, grid), 0, len(t) - 1)] - grid),
                         np.abs(t[np.clip(np.searchsorted(t, grid) - 1, 0, len(t) - 1)] - grid))
    ok = nearest <= PE_GAP_S / 2
    width = max(1, int(round(PE_SMOOTH_S / step)))
    kernel = np.ones(width)
    weight = np.convolve(ok.astype(float), kernel, "same")
    smooth = np.convolve(np.where(ok, uniform, 0.0), kernel, "same") / np.maximum(weight, 1e-9)
    inner = ok & (weight >= width * 0.8)
    p2p = float(smooth[inner].max() - smooth[inner].min()) if inner.any() else None
    return {"amplitudes": amplitudes, "residual": residual, "grid": grid, "smooth": np.where(inner, smooth, np.nan),
            "peakToPeak": p2p, "rms": float(np.std(residual)), "driftPerS": float(slope)}


def backlash_events(rows: list[tuple]) -> tuple[list[tuple[float, float, int]], list[tuple[float, float, int]], int, int]:
    """Dec pulses after a reversal and after a pulse the same way: for each, the pulse time (ms)
    and guide distance (px) sent until the Dec error had moved back by BACKLASH_RESPONSE × the
    first pulse's distance, and the number of pulses. Returns (reversals, same way, reversals
    seen, reversals without a response within BACKLASH_MAX_STEPS)."""
    reversals, same, seen, unanswered = [], [], 0, 0
    last_sign = 0
    for i, row in enumerate(rows):
        if not row[1] or row[8] or row[5] == 0:
            continue
        sign = 1 if row[5] > 0 else -1
        reversal = last_sign != 0 and sign != last_sign
        last_sign = sign
        if reversal:
            seen += 1
        ms = px = 0.0
        pulses = 0
        start = row[3]
        answered = False
        for k in range(i, min(len(rows), i + BACKLASH_MAX_STEPS + 1)):
            step = rows[k]
            if k > i and step[1] and sign * (start - step[3]) >= BACKLASH_RESPONSE * abs(row[5]):
                answered = True
                break
            if step[5] != 0:
                if (1 if step[5] > 0 else -1) != sign:
                    break  # reversed again before any response: no measurement
                ms += abs(step[7])
                px += abs(step[5])
                pulses += 1
        if answered:
            (reversals if reversal else same).append((ms, px, pulses))
        elif reversal:
            unanswered += 1
    return reversals, same, seen, unanswered


def corrections(rows: list[tuple], axis: int) -> dict:
    """Pulse statistics for RA (axis 0) or Dec (axis 1) over the steady steps."""
    ms = np.array([row[6 + axis] for row in rows if row[1] and not row[8]])
    steps = len(ms)
    pulses = ms[ms != 0]
    return {
        "steps": steps,
        "pulses": int(len(pulses)),
        "share": r(len(pulses) / steps, 3) if steps else None,
        "meanMs": r(float(np.abs(pulses).mean()), 0) if len(pulses) else None,
        "maxMs": r(float(np.abs(pulses).max()), 0) if len(pulses) else None,
        # Pulses with a positive guide distance (W in RA, the Dec direction PHD2 logged for them) vs negative.
        "positive": int((pulses > 0).sum()),
        "negative": int((pulses < 0).sum()),
    }


def analyse(text: str, tz: ZoneInfo) -> dict:
    """A whole log: sections, RMS, periodic error, Dec drift, backlash, corrections, chart series."""
    enabled, sections = parse(text, tz)
    out_sections = []
    series: list[list] = []
    pe_curve: list[list] = []
    pe_inputs: list[tuple[float, np.ndarray, np.ndarray]] = []
    steady_ra: list[np.ndarray] = []
    steady_dec: list[np.ndarray] = []
    spectra: list[tuple[float, np.ndarray]] = []
    p2ps: list[tuple[float, float, float | None]] = []
    events_rev: list = []
    events_same: list = []
    reversals_seen = unanswered = 0
    all_rows: list[tuple] = []
    mount = None
    for index, s in enumerate(sections):
        if not s.rows:
            continue
        scale = s.pixel_scale or float("nan")
        a = np.array([row[:8] for row in s.rows], dtype=float)
        t = a[:, 0]
        ra, dec = a[:, 2] * scale, a[:, 3] * scale
        outlier = a[:, 1].astype(bool) & ((np.abs(ra) > JUMP_ARCSEC) | (np.abs(dec) > JUMP_ARCSEC))
        rows = [(row[0], False, *row[2:]) if o else row for row, o in zip(s.rows, outlier)]
        valid = a[:, 1].astype(bool) & ~outlier
        excluded = np.array([row[8] for row in s.rows], dtype=bool)
        dithered = sum(1 for row, ok in zip(s.rows, valid) if row[9] and ok)
        steady = valid & ~excluded
        mount = s.mount or mount
        duration = float(t[-1] - t[0]) if len(t) > 1 else 0.0
        ended = s.ended_at or s.started_at + float(t[-1])
        ra_rms, dec_rms = (rms(ra[steady]), rms(dec[steady])) if steady.sum() >= RMS_MIN_STEPS else (None, None)
        steady_ra.append(ra[steady])
        steady_dec.append(dec[steady])
        clean = float((~valid).mean()) <= MAX_LOST_SHARE
        entry = {
            "index": index + 1,
            "startedAt": s.started_at,
            "endedAt": ended,
            "durationS": round(duration),
            "pierSide": s.pier,
            "decDeg": s.dec,
            "hourAngleH": s.hour_angle,
            "pixelScaleArcsec": s.pixel_scale,
            "exposureS": s.exposure_s,
            "steps": int(valid.sum()),
            "lost": int((~a[:, 1].astype(bool)).sum()),
            "outliers": int(outlier.sum()),
            "settling": int((valid & excluded).sum()) - dithered,
            "dithered": dithered,
            "dithers": s.dithers,
            "rmsArcsec": {"ra": r(ra_rms), "dec": r(dec_rms),
                          "total": r(math.hypot(ra_rms, dec_rms)) if ra_rms is not None and dec_rms is not None else None},
            "peakArcsec": {"ra": r(float(np.abs(ra[steady]).max())) if steady.any() else None,
                           "dec": r(float(np.abs(dec[steady]).max())) if steady.any() else None},
            "corrections": {"ra": corrections(rows, 0), "dec": corrections(rows, 1)},
            "decDrift": None,
            "pe": None,
        }
        for row, ra_v, dec_v in zip(rows, ra, dec):
            if row[1]:
                series.append([round(s.started_at + row[0], 1), round(float(ra_v), 2), round(float(dec_v), 2), bool(row[8])])
        if duration >= DRIFT_MIN_S and valid.sum() > 10 and clean:
            td, pos = reconstruct(t, valid, a[:, 3] * scale, moved(a[:, 5], a[:, 7], s.y_rate) * scale)
            slope = float(np.polyfit(td, pos, 1)[0]) * 60
            entry["decDrift"] = {
                "arcsecPerMin": r(slope, 3),
                "polarErrorArcmin": r(abs(slope) / SIDEREAL_RAD_PER_MIN / 60, 1),
            }
        if duration >= PE_MIN_SECTION_S and valid.sum() > 100 and clean:
            tp, pos = reconstruct(t, valid, a[:, 2] * scale, moved(a[:, 4], a[:, 6], s.x_rate) * scale)
            pe = periodic_error(tp, pos)
            cos_dec = math.cos(math.radians(s.dec)) if s.dec is not None else None
            entry["pe"] = {
                "periods": top_periods([(duration, tp, pe["residual"])], pe["amplitudes"], count=3),
                "peakToPeakArcsec": r(pe["peakToPeak"]),
                "peakToPeakAxisArcsec": r(pe["peakToPeak"] / cos_dec) if pe["peakToPeak"] and cos_dec else None,
                "unguidedRmsArcsec": r(pe["rms"]),
                "raDriftArcsecPerMin": r(pe["driftPerS"] * 60, 3),
            }
            spectra.append((duration, pe["amplitudes"]))
            pe_inputs.append((duration, tp, pe["residual"]))
            p2ps.append((duration, pe["peakToPeak"] or 0.0, entry["pe"]["peakToPeakAxisArcsec"]))
            # [time, drift-free position, its running mean (null in gaps)] at every measured step.
            smooth = np.interp(tp, pe["grid"], pe["smooth"]) if len(pe["grid"]) else np.full(len(tp), np.nan)
            for ti, v, sm in zip(tp, pe["residual"], smooth):
                pe_curve.append([round(s.started_at + float(ti), 1), round(float(v), 2),
                                 round(float(sm), 2) if np.isfinite(sm) else None])
        rev, same, seen, unans = backlash_events(rows)
        events_rev += rev
        events_same += same
        reversals_seen += seen
        unanswered += unans
        all_rows += rows
        out_sections.append(entry)

    ra_all = np.concatenate(steady_ra) if steady_ra else np.array([])
    dec_all = np.concatenate(steady_dec) if steady_dec else np.array([])
    ra_rms, dec_rms = rms(ra_all), rms(dec_all)
    guiding_s = sum(x["durationS"] for x in out_sections)
    pe = None
    if spectra:
        weights = np.array([w for w, _ in spectra])
        combined = (np.array([amp for _, amp in spectra]) * weights[:, None]).sum(0) / weights.sum()
        p2p = float(np.average([p for _, p, _ in p2ps], weights=[w for w, _, _ in p2ps]))
        axis = [(w, x) for w, _, x in p2ps if x is not None]
        pe = {
            "sections": len(spectra),
            "minSectionS": PE_MIN_SECTION_S,
            "periodRangeS": [PE_MIN_PERIOD_S, PE_MAX_PERIOD_S],
            "periods": top_periods(pe_inputs, combined),
            "peakToPeakArcsec": r(p2p),
            "peakToPeakAxisArcsec": r(float(np.average([x for _, x in axis], weights=[w for w, _ in axis]))) if axis else None,
            "periodogram": [[round(1 / f, 1), round(float(v), 3)] for f, v in zip(PE_FREQS, combined)],
            "curve": downsample(pe_curve, PE_POINTS),
        }
    drifts = [x["decDrift"] for x in out_sections if x["decDrift"]]
    dec_drift = None
    if drifts:
        strongest = max(drifts, key=lambda d: abs(d["arcsecPerMin"]))
        dec_drift = {
            "sections": len(drifts),
            "maxArcsecPerMin": strongest["arcsecPerMin"],
            "polarErrorArcmin": strongest["polarErrorArcmin"],
        }
    backlash = None
    scale = next((s.pixel_scale for s in sections if s.pixel_scale), None)
    if events_rev or events_same:
        def median(values: list[float]) -> float | None:
            return float(np.median(values)) if values else None
        rev_ms, same_ms = median([e[0] for e in events_rev]), median([e[0] for e in events_same])
        rev_px, same_px = median([e[1] for e in events_rev]), median([e[1] for e in events_same])
        enough = len(events_rev) >= BACKLASH_MIN_EVENTS and len(events_same) >= BACKLASH_MIN_EVENTS
        backlash = {
            "reversals": reversals_seen,
            "measured": len(events_rev),
            "unanswered": unanswered,
            "sameWay": len(events_same),
            "reversalMs": r(rev_ms, 0),
            "reversalPulses": r(median([e[2] for e in events_rev]), 1),
            "sameWayMs": r(same_ms, 0),
            "sameWayPulses": r(median([e[2] for e in events_same]), 1),
            "estimateMs": r(max(0.0, rev_ms - same_ms), 0) if enough else None,
            "estimateArcsec": r(max(0.0, rev_px - same_px) * scale, 2) if enough and scale else None,
        }
    first = out_sections[0]["startedAt"] if out_sections else enabled
    last = out_sections[-1]["endedAt"] if out_sections else enabled
    return {
        "startedAt": first,
        "endedAt": last,
        "sections": len(out_sections),
        "guidingS": guiding_s,
        "rmsArcsec": {"ra": r(ra_rms), "dec": r(dec_rms),
                      "total": r(math.hypot(ra_rms, dec_rms)) if ra_rms is not None and dec_rms is not None else None},
        "sectionRms": [[x["startedAt"], x["durationS"], x["rmsArcsec"]["total"]] for x in out_sections],
        "mount": mount,
        "pixelScaleArcsec": scale,
        "guidingSections": out_sections,
        "pe": pe,
        "decDrift": dec_drift,
        "backlash": backlash,
        "corrections": {"ra": corrections(all_rows, 0), "dec": corrections(all_rows, 1)},
        "series": downsample(series, SERIES_POINTS),
    }


SUMMARY_KEYS = ("id", "night", "startedAt", "endedAt", "sections", "guidingS", "rmsArcsec", "sectionRms")


class GuideLogs:
    """The archive's PHD2 logs, each analysed once per file size (a finished log never changes; the
    newest may still grow) and kept as JSON in `cache` (disposable); summaries stay in memory."""

    def __init__(self, archive: Archive, tz: ZoneInfo, cache: str):
        self.archive, self.tz, self.cache = archive, tz, cache
        self.lock = threading.Lock()
        self.summaries: dict[str, tuple[int, dict]] = {}

    def _logs(self) -> dict[str, tuple[str, int]]:
        with self.archive.lock:
            return {os.path.basename(rel)[:-4]: (rel, size) for rel, (size, _) in self.archive.files.items()
                    if os.path.basename(rel).startswith("PHD2_GuideLog_") and rel.endswith(".txt")}

    def _path(self, ident: str, size: int) -> str:
        return os.path.join(self.cache, f"{ident}-{size}.json")

    def _detail(self, ident: str, rel: str, size: int) -> dict | None:
        path = self._path(ident, size)
        try:
            with open(path) as f:
                return json.load(f)
        except (OSError, ValueError):
            pass
        try:
            text = self.archive.read(rel).decode("utf-8", "replace")
        except OSError:
            return None
        night = rel.split(os.sep)[1] if rel.count(os.sep) >= 2 else None
        detail = {"id": ident, "night": night, **analyse(text, self.tz)}
        os.makedirs(self.cache, exist_ok=True)
        for name in os.listdir(self.cache):
            if name.startswith(ident + "-"):
                os.unlink(os.path.join(self.cache, name))  # an older size of a log that grew
        with open(path + ".tmp", "w") as f:
            json.dump(detail, f, separators=(",", ":"))
        os.replace(path + ".tmp", path)
        return detail

    def list(self) -> list[dict]:
        out = []
        for ident, (rel, size) in self._logs().items():
            with self.lock:
                cached = self.summaries.get(ident)
                if cached is None or cached[0] != size:
                    detail = self._detail(ident, rel, size)
                    if detail is None:
                        continue
                    cached = (size, {k: detail[k] for k in SUMMARY_KEYS})
                    self.summaries[ident] = cached
            out.append(cached[1])
        return sorted(out, key=lambda x: x["startedAt"] or 0, reverse=True)

    def get(self, ident: str) -> dict | None:
        entry = self._logs().get(ident) if ID.match(ident) else None
        if entry is None:
            return None
        with self.lock:
            return self._detail(ident, *entry)
