"""Contract 1's numbers for any image: histogram and per-channel statistics of the data.

The histogram has 256 bins over one range for all channels: the data's finite minimum to maximum
(linear data, 0–1 after normalising to that range); `min`/`max` give the range in the data's own
units (ADU for the live stack). Statistics are in the same normalised 0–1 scale: the median and the
noise (MAD of horizontal neighbour differences × 1.4826 / √2, which ignores gradients and nebulae).
Mono data is reported as r = g = b.
"""

from __future__ import annotations

import math

import numpy as np

BINS = 256
SAMPLE_PIXELS = 4_000_000  # per channel; larger images are sampled every n-th row


def row_step(height: int, width: int) -> int:
    return max(1, math.ceil(height * width / SAMPLE_PIXELS))


def describe(planes: list[np.ndarray], data_range: tuple[float, float] | None = None) -> tuple[dict, dict] | tuple[None, None]:
    """(histogram, stats) of the colour planes (1 or 3, physical values, NaN = no data), or
    (None, None) without finite data. `planes` may already be row-sampled."""
    finite = [p[np.isfinite(p)].astype(np.float64) for p in planes]
    if not any(len(f) for f in finite):
        return None, None
    if data_range is None:
        lo = min(float(f.min()) for f in finite if len(f))
        hi = max(float(f.max()) for f in finite if len(f))
    else:
        lo, hi = data_range
    span = hi - lo if hi > lo else 1.0
    counts, stats = [], []
    for plane, values in zip(planes, finite):
        hist, _ = np.histogram(values, bins=BINS, range=(lo, lo + span))
        counts.append([int(c) for c in hist])
        if len(values) == 0:
            stats.append({"median": None, "noise": None})
            continue
        diff = np.diff(np.asarray(plane, dtype=np.float64), axis=1)
        diff = diff[np.isfinite(diff)]
        noise = float(np.median(np.abs(diff - np.median(diff)))) * 1.4826 / math.sqrt(2) if len(diff) else 0.0
        stats.append({"median": round((float(np.median(values)) - lo) / span, 6), "noise": round(noise / span, 7)})
    if len(planes) == 1:
        counts, stats = counts * 3, stats * 3
    histogram = {"bins": BINS, "scale": "linear data, 0–1 after normalising to the data range",
                 "min": lo, "max": hi, "r": counts[0], "g": counts[1], "b": counts[2]}
    return histogram, {"r": stats[0], "g": stats[1], "b": stats[2]}
