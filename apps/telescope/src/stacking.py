"""Warping frames onto the reference and combining them with per-pixel outlier rejection.

Aligned frames are kept as float16 .npy files (sky-subtracted, so star peaks stay within float16's
range; a 1504²×3 frame is 13.6 MB) and read back as memory maps. The combine walks the image in row
bands, so memory stays bounded however many frames there are: per pixel the median and the MAD of
all frames give a robust spread, values more than KAPPA_HIGH spreads above (satellites, planes,
cosmic rays, hot pixels that move with dithering) or KAPPA_LOW below the median are dropped, the
rest are averaged. The spread never goes below the frames' own sky noise, so with only a few frames
ordinary noise is not mistaken for outliers. Pixels a frame does not cover after warping are NaN
and count as missing.
"""

from __future__ import annotations

import warnings

import numpy as np
from scipy import ndimage

KAPPA_HIGH = 3.0
KAPPA_LOW = 4.0
MIN_CLIP_FRAMES = 3  # fewer: plain mean
BAND_BYTES = 24 << 20  # float32 values per row band (the band's working set is ~6× this)


def warp(planes: list[np.ndarray], matrix: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    """Planes (each H×W) resampled onto the reference grid (cubic spline); (H, W, C) float32,
    NaN where the frame has no data. `matrix` maps frame (x, y) → reference (x, y)."""
    h, w = shape
    inverse = np.linalg.inv(matrix)  # reference → frame
    (a, b, c), (d, e, f) = inverse[0], inverse[1]
    # scipy works in (row, col): frame (y, x) = [[e, d], [b, a]] · (y_ref, x_ref) + (f, c)
    rc_matrix = np.array([[e, d], [b, a]])
    rc_offset = np.array([f, c])
    out = np.empty((h, w, len(planes)), np.float32)
    for i, plane in enumerate(planes):
        out[..., i] = ndimage.affine_transform(
            plane.astype(np.float32, copy=False), rc_matrix, rc_offset, output_shape=(h, w),
            order=3, mode="nearest", prefilter=True,
        )
    yr, xr = np.mgrid[0:h, 0:w].astype(np.float32)
    xf = a * xr + b * yr + c
    yf = d * xr + e * yr + f
    src_h, src_w = planes[0].shape
    outside = (xf < 0) | (xf > src_w - 1) | (yf < 0) | (yf > src_h - 1)
    out[outside] = np.nan
    return out


def _median(x: np.ndarray) -> np.ndarray:
    """Median over axis 0, ignoring NaN, fast where nothing is missing (almost everywhere)."""
    m = np.median(x, axis=0)
    missing = np.isnan(m)
    if missing.any():
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            m[missing] = np.nanmedian(x[:, missing], axis=0)
    return m


def combine(frames: list[np.ndarray], noise: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Sigma-clipped mean of aligned frames (each (H, W, C), float16 or float32, NaN = no data).

    `noise`: per-channel sky noise (σ) of a single frame, the floor of the per-pixel spread.
    Returns the mean (H, W, C) float32 (NaN where no frame covers a pixel) and the fraction of
    values rejected (H, W, C) float32."""
    n = len(frames)
    h, w, c = frames[0].shape
    mean = np.empty((h, w, c), np.float32)
    rejected = np.zeros((h, w, c), np.float32)
    rows = max(1, BAND_BYTES // max(1, n * w * c * 4))
    floor = np.asarray(noise, np.float32).reshape(1, 1, c)
    for r0 in range(0, h, rows):
        r1 = min(h, r0 + rows)
        x = np.stack([np.asarray(f[r0:r1], np.float32) for f in frames])
        valid = ~np.isnan(x)
        if n < MIN_CLIP_FRAMES:
            keep = valid
        else:
            med = _median(x)
            spread = np.maximum(_median(np.abs(x - med)) * 1.4826, floor)
            diff = x - med
            keep = valid & (diff <= KAPPA_HIGH * spread) & (diff >= -KAPPA_LOW * spread)
        count = keep.sum(axis=0)
        total = np.where(keep, x, 0).sum(axis=0)
        with np.errstate(invalid="ignore", divide="ignore"):
            mean[r0:r1] = np.where(count > 0, total / count, np.nan)
            covered = valid.sum(axis=0)
            rejected[r0:r1] = np.where(covered > 0, (covered - count) / np.maximum(covered, 1), 0)
    return mean, rejected
