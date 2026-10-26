"""Automatic frame rejection: each frame against its own session's median, with the reason in words.

Re-judged whenever the session changes, so the first frames (judged on absolute limits only while
fewer than MIN_FRAMES exist) get the full verdict later. A manual decision overrides it elsewhere.
"""

from __future__ import annotations

import statistics

# Session statistics need this many analysed frames; before that only the absolute limits apply.
MIN_FRAMES = 5
# Fewer stars than this is never a usable frame (clouds, dew, the mount pointing elsewhere).
MIN_STARS = 15
# Stars below this fraction of the session median: clouds, fog, dew.
STARS_MIN_RATIO = 0.5
# Half-flux radius above this multiple of the session median: focus drift, bad seeing.
HFR_MAX_RATIO = 1.35
# Sky background above this multiple of the session median: clouds lit from below, moon, dawn.
BACKGROUND_MAX_RATIO = 1.5
# Elongation (1 - minor/major axis, 0 = round) above the larger of this and the session median plus
# ELONGATION_MARGIN: trailing (wind, a mount hiccup, guiding lost).
ELONGATION_MAX = 0.35
ELONGATION_MARGIN = 0.15
# Guiding RMS during the exposure above the larger of this and GUIDING_RMS_RATIO × session median,
# judged only once the session has statistics: guiding is a cause, the stars are the effect, and an
# absolute limit alone rejected good first frames on a night of steady 1.5″ guiding (2026-10-19).
GUIDING_RMS_MIN_ARCSEC = 1.5
GUIDING_RMS_RATIO = 2.0


def _median(values: list[float | None]) -> float | None:
    present = [v for v in values if v is not None]
    return statistics.median(present) if present else None


def judge(frames: list[dict]) -> list[tuple[bool, str | None]]:
    """Frames: dicts with stars, hfr, backgroundAdu, elongation, guidingRmsArcsec (each may be None)
    and alignError (None when aligned). Returns (accepted, reason) per frame, in order."""
    stats = len(frames) >= MIN_FRAMES
    stars_m = _median([f.get("stars") for f in frames]) if stats else None
    hfr_m = _median([f.get("hfr") for f in frames]) if stats else None
    bg_m = _median([f.get("backgroundAdu") for f in frames]) if stats else None
    elong_m = _median([f.get("elongation") for f in frames]) if stats else None
    guide_m = _median([f.get("guidingRmsArcsec") for f in frames]) if stats else None
    elong_limit = max(ELONGATION_MAX, elong_m + ELONGATION_MARGIN) if elong_m is not None else ELONGATION_MAX + ELONGATION_MARGIN
    out = []
    for f in frames:
        reasons = []
        stars, hfr, bg = f.get("stars"), f.get("hfr"), f.get("backgroundAdu")
        elong, guide = f.get("elongation"), f.get("guidingRmsArcsec")
        if stars is not None and stars < MIN_STARS:
            reasons.append(f"only {stars} stars: clouds or not on target")
        elif stars is not None and stars_m and stars < STARS_MIN_RATIO * stars_m:
            reasons.append(f"stars {round(100 * stars / stars_m)} % of session median: clouds")
        if hfr is not None and hfr_m and hfr > HFR_MAX_RATIO * hfr_m:
            reasons.append(f"HFR {hfr / hfr_m:.1f}× session median: focus or seeing")
        if bg is not None and bg_m and bg > BACKGROUND_MAX_RATIO * bg_m:
            reasons.append(f"background {bg / bg_m:.1f}× session median: clouds lit, moon or dawn")
        if elong is not None and elong > elong_limit:
            session = f" (session {elong_m:.2f})" if elong_m is not None else ""
            reasons.append(f"stars elongated {elong:.2f}{session}: trailing or wind")
        if guide is not None and guide_m is not None and guide > max(GUIDING_RMS_MIN_ARCSEC, GUIDING_RMS_RATIO * guide_m):
            session = f" (session {guide_m:.1f}″)" if guide_m is not None else ""
            reasons.append(f"guiding RMS {guide:.1f}″{session}")
        if f.get("alignError"):
            reasons.append(f"not aligned: {f['alignError']}")
        out.append((not reasons, "; ".join(reasons) or None))
    return out
