"""Per-frame star positions and shapes on a half-size plane (the superpixel green, or binned mono).

Positions feed registration (register.py); shapes give FWHM and elongation for frame rejection.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage

# Peaks at or above this (in the 16-bit scale) are saturated: no centroid or shape from them.
SATURATED = 60000
DETECT_SIGMA = 6.0
# Shapes only from bright, clean stars: second moments of faint ones are mostly noise.
SHAPE_SIGMA = 25.0
SHAPE_STARS = 150
MAX_STARS = 300
WINDOW = 4  # half width of the centroid/moment window (plane pixels)


@dataclass
class Stars:
    xy: np.ndarray  # (n, 2) x, y in plane pixels, brightest first
    flux: np.ndarray  # (n,)
    fwhm: float | None  # plane pixels, median of the bright stars
    elongation: float | None  # 1 - minor/major axis, median; 0 = round


def background(plane: np.ndarray) -> tuple[float, float]:
    """Sky level (median) and noise (MAD as σ) from every 4th pixel."""
    sample = plane[::4, ::4]
    median = float(np.median(sample))
    sigma = float(np.median(np.abs(sample - median))) * 1.4826
    return median, sigma or 1.0


def detect(plane: np.ndarray) -> Stars:
    sky, sigma = background(plane)
    peaks = (plane == ndimage.maximum_filter(plane, size=5)) & (plane > sky + DETECT_SIGMA * sigma) & (plane < SATURATED)
    # Not a lone hot pixel: at least 4 of the 3×3 neighbourhood above 3σ.
    neighbours = ndimage.uniform_filter((plane > sky + 3 * sigma).astype(np.float32), size=3) * 9
    peaks &= neighbours >= 3.5
    m = WINDOW + 2
    peaks[:m, :] = peaks[-m:, :] = False
    peaks[:, :m] = peaks[:, -m:] = False
    ys, xs = np.nonzero(peaks)
    if len(ys) == 0:
        return Stars(np.zeros((0, 2)), np.zeros(0), None, None)
    order = np.argsort(plane[ys, xs])[::-1][:MAX_STARS]
    ys, xs = ys[order], xs[order]
    oy, ox = np.mgrid[-WINDOW : WINDOW + 1, -WINDOW : WINDOW + 1]
    windows = np.clip(plane[ys[:, None, None] + oy, xs[:, None, None] + ox] - sky, 0, None)
    total = np.maximum(windows.sum(axis=(1, 2)), 1e-6)
    cx = (windows * ox).sum(axis=(1, 2)) / total
    cy = (windows * oy).sum(axis=(1, 2)) / total
    xy = np.column_stack([xs + cx, ys + cy])

    # Second moments around the centroid of the bright stars.
    bright = (plane[ys, xs] - sky > SHAPE_SIGMA * sigma)
    fwhm = elongation = None
    if bright.sum() >= 3:
        w = windows[bright][:SHAPE_STARS]
        dx = ox[None] - cx[bright][:SHAPE_STARS, None, None]
        dy = oy[None] - cy[bright][:SHAPE_STARS, None, None]
        t = np.maximum(w.sum(axis=(1, 2)), 1e-6)
        ixx = (w * dx * dx).sum(axis=(1, 2)) / t
        iyy = (w * dy * dy).sum(axis=(1, 2)) / t
        ixy = (w * dx * dy).sum(axis=(1, 2)) / t
        half_trace = (ixx + iyy) / 2
        root = np.sqrt(((ixx - iyy) / 2) ** 2 + ixy**2)
        major, minor = half_trace + root, np.maximum(half_trace - root, 1e-6)
        fwhm = float(np.median(2.3548 * np.sqrt(half_trace)))
        elongation = float(np.median(1 - np.sqrt(minor / major)))
    return Stars(xy, total, fwhm, elongation)
