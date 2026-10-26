"""Tilt and backfocus inspection (A6): star size and shape in a 3×3 grid of the sensor, a verdict,
and 1:1 crops of the nine cells in one JPEG (the aberration inspector).

Measured on the green at full resolution (`green`: the frame's own green pixels, the mean of the four
green neighbours at red and blue ones; camera pixels). The analysis' superpixel green averages two
diagonal neighbours, which stretches the undersampled stars (~1.6 superpixels FWHM) along that
diagonal by ~0.1 in elongation: fine for the frame's numbers, not for a shape map. Stars as in
analysis.detect (DETECT_SIGMA, local maxima over PEAK_PX, not saturated, not lone hot pixels); of
those SHAPE_SIGMA above the local sky (the median of the window's edge) with no other star within
the window, at most SHAPE_STARS per cell, the brightest first. Shape from adaptive moments: second
moments weighted by a Gaussian matched to the star, iterated (ADAPTIVE_ROUNDS) and corrected for
the weight, give the covariance of a Gaussian star, hence the FWHM (within 5 % on synthetic
Gaussian stars, ~20 % above the true FWHM for Moffat β 2.5), the elongation 1 − minor/major and the
major axis' angle (clockwise from +x on the screen, 0–180°); plain moments in a window, as the frame
analysis uses, are inflated by noise in the wings. HFR is the flux-weighted mean radius within
HFR_RADIUS (as the frame's).
Per cell the medians, and the dominant angle (the elongation-weighted mean of the doubled angles).
A cell with fewer than MIN_CELL_STARS measured stars has nulls.

Summary from the cells' FWHM: the spread of the four corners (tilt), left against right and top
against bottom columns/rows (the direction of a tilt), the corners against the centre (field
curvature or backfocus), and whether elongated stars point the same way everywhere (tracking, not
optics) or radially/tangentially in the corners. Thresholds below; the verdict is plain words.

`Inspector` serves it: per frame on request from the archived FITS (~0.7 s, one at a time, cached
as <cache>/inspect/<frame id>.json and .jpg: frame ids change with the file), per session the
median of the cells of its SESSION_FRAMES best accepted frames (the reference score, stars / HFR),
kept in <data>/sessions/<id>/inspect.json until that choice of frames changes.
"""

from __future__ import annotations

import io
import json
import logging
import math
import os
import threading
import time

import numpy as np
from PIL import Image
from scipy import ndimage

import analysis
import fits

log = logging.getLogger("tilt")

# The session's summary: the median per cell over its best frames (seeing and the star sample of
# single frames average out; 5 frames of ~0.7 s each keep the first request within ~4 s).
SESSION_FRAMES = 5
DETECT_SIGMA = 6.0
SHAPE_SIGMA = 20.0
SHAPE_STARS = 200
PEAK_PX = 9  # local maxima over this square (camera pixels; the analysis' 5×5 on superpixels)
WINDOW = 10  # half width of the moment window (camera pixels)
ADAPTIVE_ROUNDS = 6
MAX_SIZE2 = 40.0  # px²: stars wider than FWHM 15 px are not measured
HFR_RADIUS = 10  # camera pixels (the frame HFR's 5 superpixels)
MIN_CELL_STARS = 5
GRID = 3
# Corner-to-corner FWHM spread (max − min over their mean): below TILT_OK_PCT no tilt to speak of,
# from TILT_BAD_PCT a clear tilt (a few per cent come from seeing and the star sample of one frame).
TILT_OK_PCT = 10.0
TILT_BAD_PCT = 20.0
# Corners against the centre (mean corner FWHM over the centre's): field curvature or backfocus.
CURVATURE_OK_PCT = 10.0
CURVATURE_BAD_PCT = 25.0
# Stars this elongated (median of a cell) count as elongated; directions within SAME_ANGLE_DEG of
# the field's mean in every cell are "the same way"; in a corner within RADIAL_DEG of the line to
# the centre "radial", within RADIAL_DEG of perpendicular to it "tangential".
ELONGATED = 0.2
SAME_ANGLE_DEG = 20.0
RADIAL_DEG = 30.0
CROP_PX = 256  # camera pixels per crop of the mosaic
GAP_PX = 4
CORNERS = {(0, 0): "top left", (0, 2): "top right", (2, 0): "bottom left", (2, 2): "bottom right"}


def green(pixels: np.ndarray, header: dict[str, str]) -> np.ndarray:
    """The green of a Bayer frame at full resolution (the two greens of each 2×2 as they are, the
    mean of the four green neighbours at red and blue pixels: symmetric, so it adds no elongation as
    the superpixel's diagonal pair of greens does); a mono frame as it is."""
    bayer = header.get("BAYERPAT", "").strip().upper()
    if not (len(bayer) == 4 and set(bayer) <= set("RGB")):
        return pixels
    padded = np.pad(pixels, 1, mode="reflect")
    cross = (padded[:-2, 1:-1] + padded[2:, 1:-1] + padded[1:-1, :-2] + padded[1:-1, 2:]) / 4
    out = pixels.copy()
    for (py, px), colour in zip(((0, 0), (0, 1), (1, 0), (1, 1)), bayer):
        if colour != "G":
            out[py::2, px::2] = cross[py::2, px::2]
    return out


def _stars(plane: np.ndarray) -> dict[str, np.ndarray]:
    """Shapes of the clean bright stars of a full-resolution plane: x, y, fwhm, hfr (camera px),
    elongation, angle (degrees), brightest first."""
    sky, sigma = analysis.background(plane)
    peaks = (plane == ndimage.maximum_filter(plane, size=PEAK_PX)) & (plane > sky + DETECT_SIGMA * sigma) \
        & (plane < analysis.SATURATED)
    neighbours = ndimage.uniform_filter((plane > sky + 3 * sigma).astype(np.float32), size=3) * 9
    peaks &= neighbours >= 3.5
    m = WINDOW + 2
    peaks[:m, :] = peaks[-m:, :] = False
    peaks[:, :m] = peaks[:, -m:] = False
    # Not crowded: no other star within the window (its light would skew the moments).
    side = 2 * WINDOW + 1
    nearby = np.rint(ndimage.uniform_filter(peaks.astype(np.float32), size=side, mode="constant") * side * side)
    ys, xs = np.nonzero(peaks & (nearby <= 1))
    empty = {k: np.zeros(0) for k in ("x", "y", "fwhm", "hfr", "elongation", "angle")}
    if len(ys) == 0:
        return empty
    order = np.argsort(plane[ys, xs])[::-1]
    ys, xs = ys[order], xs[order]
    oy, ox = np.mgrid[-WINDOW : WINDOW + 1, -WINDOW : WINDOW + 1]
    edge = (np.abs(ox) == WINDOW) | (np.abs(oy) == WINDOW)
    windows = plane[ys[:, None, None] + oy, xs[:, None, None] + ox].astype(np.float64)
    local = np.median(windows[:, edge], axis=1)
    keep = plane[ys, xs] - local > SHAPE_SIGMA * sigma
    if not keep.any():
        return empty
    ys, xs, windows, local = ys[keep], xs[keep], windows[keep], local[keep]
    data = windows - local[:, None, None]
    n = len(ys)
    cx, cy = np.zeros(n), np.zeros(n)
    size2 = np.full(n, 4.0)  # the weight's variance (px²), matched to the star as it goes
    cxx = cyy = cxy = np.zeros(n)
    valid = np.ones(n, bool)
    for _ in range(ADAPTIVE_ROUNDS):
        dx, dy = ox[None] - cx[:, None, None], oy[None] - cy[:, None, None]
        iw = data * np.exp(-(dx * dx + dy * dy) / (2 * size2[:, None, None]))
        total = iw.sum(axis=(1, 2))
        valid &= total > 0
        total = np.where(valid, total, 1.0)
        cx = np.clip(cx + (iw * dx).sum(axis=(1, 2)) / total, -3, 3)
        cy = np.clip(cy + (iw * dy).sum(axis=(1, 2)) / total, -3, 3)
        mxx = (iw * dx * dx).sum(axis=(1, 2)) / total
        myy = (iw * dy * dy).sum(axis=(1, 2)) / total
        mxy = (iw * dx * dy).sum(axis=(1, 2)) / total
        # A Gaussian star (covariance C) under a Gaussian weight (variance s): M⁻¹ = C⁻¹ + 1/s.
        det = mxx * myy - mxy * mxy
        valid &= det > 0
        det = np.where(valid, det, 1.0)
        ixx, iyy, ixy = myy / det - 1 / size2, mxx / det - 1 / size2, -mxy / det
        cdet = ixx * iyy - ixy * ixy
        valid &= (cdet > 0) & (ixx > 0)
        cdet = np.where(valid, cdet, 1.0)
        cxx, cyy, cxy = iyy / cdet, ixx / cdet, -ixy / cdet
        size2 = np.clip(np.where(valid, (cxx + cyy) / 2, size2), 0.5, MAX_SIZE2)
    valid &= ((cxx + cyy) / 2 > 0) & ((cxx + cyy) / 2 < MAX_SIZE2)
    cxx, cyy, cxy, cx, cy = cxx[valid], cyy[valid], cxy[valid], cx[valid], cy[valid]
    data, xs, ys = data[valid], xs[valid], ys[valid]
    half = (cxx + cyy) / 2
    root = np.sqrt(((cxx - cyy) / 2) ** 2 + cxy**2)
    major, minor = half + root, np.maximum(half - root, 0)
    dx, dy = ox[None] - cx[:, None, None], oy[None] - cy[:, None, None]
    r = np.hypot(dx, dy)
    w = np.clip(data, 0, None) * (r <= HFR_RADIUS)
    return {
        "x": xs + cx, "y": ys + cy,
        "fwhm": 2.3548 * np.sqrt(half),
        "hfr": (w * r).sum(axis=(1, 2)) / np.maximum(w.sum(axis=(1, 2)), 1e-9),
        "elongation": 1 - np.sqrt(minor / major),
        "angle": np.degrees(0.5 * np.arctan2(2 * cxy, cxx - cyy)) % 180,
    }


def _axial_mean(angles: np.ndarray, weights: np.ndarray) -> float | None:
    """Mean direction of axes (degrees, 0–180), weighted."""
    if len(angles) == 0 or float(weights.sum()) <= 0:
        return None
    doubled = np.radians(angles) * 2
    return float(np.degrees(0.5 * math.atan2(float((weights * np.sin(doubled)).sum()),
                                             float((weights * np.cos(doubled)).sum()))) % 180)


def r2(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(float(value), digits)


def measure_grid(plane: np.ndarray, scale: float, arcsec_per_px: float | None) -> list[dict]:
    """The 3×3 cells of a plane (row-major from the top left): bounds in camera pixels, stars
    measured, median FWHM (camera px and arcsec), HFR (camera px), elongation, dominant angle.
    `scale`: camera pixels per plane pixel; `arcsec_per_px`: per camera pixel."""
    stars = _stars(plane)
    h, w = plane.shape
    cells = []
    for row in range(GRID):
        for col in range(GRID):
            x0, x1 = w * col / GRID, w * (col + 1) / GRID
            y0, y1 = h * row / GRID, h * (row + 1) / GRID
            inside = (stars["x"] >= x0) & (stars["x"] < x1) & (stars["y"] >= y0) & (stars["y"] < y1)
            idx = np.nonzero(inside)[0][:SHAPE_STARS]
            cell = {"row": row, "col": col, "x0": round(x0 * scale), "y0": round(y0 * scale),
                    "x1": round(x1 * scale), "y1": round(y1 * scale), "stars": int(len(idx)),
                    "fwhmPx": None, "fwhmArcsec": None, "hfrPx": None, "elongation": None, "angleDeg": None}
            if len(idx) >= MIN_CELL_STARS:
                fwhm = float(np.median(stars["fwhm"][idx])) * scale
                elongation = stars["elongation"][idx]
                cell.update(fwhmPx=r2(fwhm), fwhmArcsec=r2(fwhm * arcsec_per_px) if arcsec_per_px else None,
                            hfrPx=r2(float(np.median(stars["hfr"][idx])) * scale),
                            elongation=r2(float(np.median(elongation)), 3),
                            angleDeg=r2(_axial_mean(stars["angle"][idx], elongation), 1))
            cells.append(cell)
    return cells


def combine(per_frame: list[list[dict]]) -> list[dict]:
    """Cells of several frames as one: the median of each number per cell (seeing averages out),
    the angle as the elongation-weighted mean direction, stars summed."""
    cells = []
    for k, first in enumerate(per_frame[0]):
        values = [frame[k] for frame in per_frame]
        cell = {key: first[key] for key in ("row", "col", "x0", "y0", "x1", "y1")}
        cell["stars"] = sum(v["stars"] for v in values)
        for key, digits in (("fwhmPx", 2), ("fwhmArcsec", 2), ("hfrPx", 2), ("elongation", 3)):
            numbers = [v[key] for v in values if v[key] is not None]
            cell[key] = r2(float(np.median(numbers)), digits) if numbers else None
        measured = [v for v in values if v["angleDeg"] is not None and v["elongation"] is not None]
        cell["angleDeg"] = r2(_axial_mean(np.array([v["angleDeg"] for v in measured]),
                                          np.array([v["elongation"] for v in measured])), 1) if measured else None
        cells.append(cell)
    return cells


def _angle_diff(a: float, b: float) -> float:
    """Difference of two axis directions (degrees), 0–90."""
    return abs((a - b + 90) % 180 - 90)


def summarize(cells: list[dict]) -> dict:
    """Tilt, curvature and elongation pattern from the cells, with a verdict in plain words.
    `level`: ok, minor (worth a look) or check (fix the optics or the mount)."""
    at = {(c["row"], c["col"]): c for c in cells}
    fwhm = {k: c["fwhmPx"] for k, c in at.items()}
    out = {"centerFwhmPx": fwhm.get((1, 1)), "cornersFwhmPx": None, "tiltPct": None, "worstCorner": None,
           "bestCorner": None, "leftRightPct": None, "topBottomPct": None, "curvaturePct": None,
           "cornerElongation": None, "sameDirection": False, "level": None, "verdict": None}
    corners = {k: fwhm[k] for k in CORNERS if fwhm.get(k)}
    if len(corners) < 4 or not fwhm.get((1, 1)):
        out["verdict"] = "Too few stars in the corners or the centre to judge tilt and backfocus."
        return out
    mean_corners = sum(corners.values()) / 4
    worst, best = max(corners, key=corners.get), min(corners, key=corners.get)
    tilt = (corners[worst] - corners[best]) / mean_corners * 100

    def side(keys) -> float | None:
        values = [fwhm[k] for k in keys if fwhm.get(k)]
        return sum(values) / len(values) if values else None

    left, right = side([(r, 0) for r in range(GRID)]), side([(r, 2) for r in range(GRID)])
    top, bottom = side([(0, c) for c in range(GRID)]), side([(2, c) for c in range(GRID)])
    left_right = (left - right) / ((left + right) / 2) * 100 if left and right else None
    top_bottom = (top - bottom) / ((top + bottom) / 2) * 100 if top and bottom else None
    curvature = (mean_corners - fwhm[(1, 1)]) / fwhm[(1, 1)] * 100
    out.update(cornersFwhmPx=r2(mean_corners), tiltPct=r2(tilt, 1), worstCorner=CORNERS[worst],
               bestCorner=CORNERS[best], leftRightPct=r2(left_right, 1), topBottomPct=r2(top_bottom, 1),
               curvaturePct=r2(curvature, 1))

    # Elongation pattern.
    measured = [c for c in cells if c["elongation"] is not None and c["angleDeg"] is not None]
    elongated = [c for c in measured if c["elongation"] >= ELONGATED]
    mean_angle = _axial_mean(np.array([c["angleDeg"] for c in measured]), np.array([c["elongation"] for c in measured]))
    same = (len(elongated) == len(measured) == len(cells) and mean_angle is not None
            and all(_angle_diff(c["angleDeg"], mean_angle) <= SAME_ANGLE_DEG for c in measured))
    out["sameDirection"] = bool(same)
    corner_kinds = []
    for (row, col) in CORNERS:
        c = at[(row, col)]
        if c["elongation"] is None or c["elongation"] < ELONGATED or c["angleDeg"] is None:
            continue
        # The line to the centre, in screen terms (y down), as an axis direction.
        radial = math.degrees(math.atan2((1 - row), (1 - col))) % 180
        diff = _angle_diff(c["angleDeg"], radial)
        corner_kinds.append("radial" if diff <= RADIAL_DEG else "tangential" if diff >= 90 - RADIAL_DEG else "mixed")
    if not same and len(corner_kinds) >= 3:
        kinds = set(corner_kinds)
        out["cornerElongation"] = corner_kinds[0] if len(kinds) == 1 else "mixed"

    words, level = [], "ok"
    if same:
        words.append(f"Stars are elongated the same way across the whole field (about {mean_angle:.0f}°): "
                     "tracking, guiding or wind, not the optics.")
        level = "check"
    if tilt >= TILT_BAD_PCT:
        words.append(f"Tilt: the {CORNERS[worst]} corner's stars are {tilt:.0f} % larger than the {CORNERS[best]} corner's"
                     + _direction(left_right, top_bottom) + ".")
        level = "check"
    elif tilt >= TILT_OK_PCT:
        words.append(f"Slight tilt: corners differ by {tilt:.0f} % ({CORNERS[worst]} largest)"
                     + _direction(left_right, top_bottom) + ".")
        level = "minor" if level == "ok" else level
    else:
        words.append(f"No tilt to speak of: the corners are within {tilt:.0f} % of each other.")
    if curvature >= CURVATURE_BAD_PCT or (curvature >= CURVATURE_OK_PCT and out["cornerElongation"] in ("radial", "tangential")):
        shape = {"radial": " and their stars are stretched towards the centre",
                 "tangential": " and their stars are stretched across the line to the centre"}.get(out["cornerElongation"] or "", "")
        words.append(f"The corners are {curvature:.0f} % larger than the centre{shape}: backfocus (the spacing to the "
                     "flattener or reducer) or field curvature.")
        level = "check" if curvature >= CURVATURE_BAD_PCT else ("minor" if level == "ok" else level)
    elif curvature >= CURVATURE_OK_PCT:
        words.append(f"The corners are {curvature:.0f} % larger than the centre: a little field curvature or backfocus.")
        level = "minor" if level == "ok" else level
    else:
        words.append("The corners are as sharp as the centre: backfocus looks right.")
    out["level"], out["verdict"] = level, " ".join(words)
    return out


def _direction(left_right: float | None, top_bottom: float | None) -> str:
    """Which side is worse, when one side clearly is (half the tilt limit)."""
    parts = []
    if left_right is not None and abs(left_right) >= TILT_OK_PCT / 2:
        parts.append(f"the {'left' if left_right > 0 else 'right'} side by {abs(left_right):.0f} %")
    if top_bottom is not None and abs(top_bottom) >= TILT_OK_PCT / 2:
        parts.append(f"the {'top' if top_bottom > 0 else 'bottom'} by {abs(top_bottom):.0f} %")
    return f"; larger on {' and '.join(parts)}" if parts else ""


def crop_origins(width: int, height: int) -> list[dict]:
    """Where the nine crops sit (camera pixels, even so the Bayer pattern starts the same): the
    corners, the middles of the edges and the centre."""
    xs = [0, (width - CROP_PX) // 2 & ~1, (width - CROP_PX) & ~1]
    ys = [0, (height - CROP_PX) // 2 & ~1, (height - CROP_PX) & ~1]
    return [{"row": r, "col": c, "x": xs[c], "y": ys[r]} for r in range(GRID) for c in range(GRID)]


def _debayer(raw: np.ndarray, bayer: str) -> np.ndarray:
    """Bilinear demosaic of a Bayer crop (even origin) to (h, w, 3) at full resolution."""
    h, w = raw.shape
    at = {(0, 0): bayer[0], (0, 1): bayer[1], (1, 0): bayer[2], (1, 1): bayer[3]}
    out = np.zeros((h, w, 3), np.float32)
    yy, xx = np.mgrid[0:h, 0:w]
    kernels = {"G": np.array([[0, 1, 0], [1, 4, 1], [0, 1, 0]], np.float32) / 4,
               "R": np.array([[1, 2, 1], [2, 4, 2], [1, 2, 1]], np.float32) / 4}
    kernels["B"] = kernels["R"]
    for i, colour in enumerate("RGB"):
        mask = np.zeros((h, w), bool)
        for (py, px), c in at.items():
            if c == colour:
                mask |= (yy % 2 == py) & (xx % 2 == px)
        out[..., i] = ndimage.convolve(np.where(mask, raw, 0).astype(np.float32), kernels[colour], mode="mirror")
    return out


def mosaic(pixels: np.ndarray, header: dict[str, str], planes: list[np.ndarray], quality: int = 90) -> bytes:
    """The nine 1:1 crops (CROP_PX camera pixels, debayered colour) in one JPEG, 3 × 3 with GAP_PX
    black between them, in the frame preview's per-channel screen stretch."""
    height, width = pixels.shape
    bayer = header.get("BAYERPAT", "").strip().upper()
    colour = len(bayer) == 4 and set(bayer) <= set("RGB") and len(planes) == 3
    params = [fits.stretch_params(p[::4, ::4]) for p in planes]
    size = GRID * CROP_PX + (GRID - 1) * GAP_PX
    canvas = np.zeros((size, size, 3), np.uint8)
    margin = 2  # for the demosaic at the crop's edges
    for o in crop_origins(width, height):
        y0, x0 = max(o["y"] - margin, 0) & ~1, max(o["x"] - margin, 0) & ~1
        y1, x1 = min(o["y"] + CROP_PX + margin, height), min(o["x"] + CROP_PX + margin, width)
        raw = pixels[y0:y1, x0:x1]
        if colour:
            rgb = _debayer(raw, bayer)
            stretched = np.stack([fits.apply_stretch(rgb[..., i], params[i]) for i in range(3)], axis=-1)
        else:
            grey = fits.apply_stretch(raw, params[0])
            stretched = np.repeat(grey[..., None], 3, axis=-1)
        part = stretched[o["y"] - y0 : o["y"] - y0 + CROP_PX, o["x"] - x0 : o["x"] - x0 + CROP_PX]
        top, left = o["row"] * (CROP_PX + GAP_PX), o["col"] * (CROP_PX + GAP_PX)
        canvas[top : top + part.shape[0], left : left + part.shape[1]] = (np.clip(part, 0, 1) * 255 + 0.5).astype(np.uint8)
    out = io.BytesIO()
    Image.fromarray(canvas).save(out, format="JPEG", quality=quality, optimize=True)
    return out.getvalue()


def arcsec_per_pixel(header: dict[str, str]) -> float | None:
    """Arcseconds per camera pixel: the plate solve, else the pixel size and focal length."""
    solution = fits.wcs(header)
    if solution:
        return solution.pixel_scale_arcsec()
    size, focal = fits.number(header, "XPIXSZ"), fits.number(header, "FOCALLEN")
    return 206.265 * size / focal if size and focal else None


def inspect_frame(raw: bytes) -> tuple[dict, bytes]:
    """A frame's FITS bytes → (cells, summary and crop positions; the mosaic JPEG)."""
    header, offset = fits.parse_header(raw)
    pixels = fits.read_pixels(raw, header, offset)
    arcsec = arcsec_per_pixel(header)
    cells = measure_grid(green(pixels, header), 1.0, arcsec)
    jpeg = mosaic(pixels, header, fits.channels(pixels, header))
    result = {
        "width": int(pixels.shape[1]), "height": int(pixels.shape[0]),
        "pixelScaleArcsec": r2(arcsec, 4),
        "cells": cells,
        "summary": summarize(cells),
        "cropPx": CROP_PX, "gapPx": GAP_PX,
        "crops": crop_origins(pixels.shape[1], pixels.shape[0]),
    }
    return result, jpeg


class Inspector:
    """The inspection of a session's frames and of the session, cached (see the module docstring)."""

    def __init__(self, store):
        self.store = store
        self.folder = os.path.join(store.cache, "inspect")
        # One frame at a time: ~300 MB while one is measured, and the worker shares the CPU.
        self.lock = threading.Lock()

    def _frame(self, sid: str, fid: str) -> dict | None:
        """The frame's rel, size, number and time when it is analysed and archived."""
        store = self.store
        with store.lock:
            s = store.sessions.get(sid)
            f = next((x for x in s["frames"] if x.get("id") == fid and x["state"] == "done"), None) if s else None
            if f is None:
                return None
            entry = {"rel": f["rel"], "size": f["size"], "number": f["number"], "at": f["info"]["at"]}
        return entry if store.archive.has(entry["rel"], entry["size"]) else None

    def _path(self, fid: str, ext: str) -> str:
        return os.path.join(self.folder, f"{fid}.{ext}")

    def _measure(self, fid: str, rel: str) -> dict:
        """The frame's cached inspection, measured (with its mosaic) when missing."""
        try:
            with open(self._path(fid, "json")) as f:
                return json.load(f)
        except (OSError, ValueError):
            pass
        with self.lock:
            try:  # measured meanwhile by another request
                with open(self._path(fid, "json")) as f:
                    return json.load(f)
            except (OSError, ValueError):
                pass
            started = time.time()
            result, jpeg = inspect_frame(self.store.archive.read(rel))
            os.makedirs(self.folder, exist_ok=True)
            for ext, data in (("jpg", jpeg), ("json", json.dumps(result, separators=(",", ":")).encode())):
                tmp = self._path(fid, f"tmp.{ext}")
                with open(tmp, "wb") as out:
                    out.write(data)
                os.replace(tmp, self._path(fid, ext))
            log.info("inspected %s: tilt %s %%, curvature %s %% (%.1f s)", rel, result["summary"]["tiltPct"],
                     result["summary"]["curvaturePct"], time.time() - started)
            return result

    def frame(self, sid: str, fid: str) -> dict | None:
        """GET /api/sessions/<id>/frames/<frame id>/inspect; None: no such analysed, archived frame."""
        entry = self._frame(sid, fid)
        if entry is None:
            return None
        result = self._measure(fid, entry["rel"])
        return {"sessionId": sid, "frameId": fid, "number": entry["number"], "at": entry["at"],
                "mosaicUrl": f"/frames/{fid}-inspect.jpg", **result}

    def mosaic_path(self, fid: str) -> str | None:
        """The frame's mosaic JPEG (measured when missing); None for an unknown frame."""
        path = self._path(fid, "jpg")
        if not os.path.exists(path):
            with self.store.lock:
                sid = next((s["id"] for s in self.store.sessions.values()
                            if any(f.get("id") == fid for f in s["frames"])), None)
            entry = self._frame(sid, fid) if sid else None
            if entry is None:
                return None
            self._measure(fid, entry["rel"])
        return path

    def session(self, sid: str) -> dict | None:
        """GET /api/sessions/<id>/inspect: the SESSION_FRAMES best accepted frames' cells combined."""
        store = self.store
        with store.lock:
            s = store.sessions.get(sid)
            if s is None:
                return None
            scores = store._scores(s)  # the reference choice's quality: stars (capped) / HFR
            accepted = [f for f in s["frames"] if store.accepted(f)]
            best = sorted(accepted, key=lambda f: -scores.get(f["rel"], 0.0))[:SESSION_FRAMES]
            chosen = [(f["id"], f["rel"], f["size"], f["number"]) for f in best]
        chosen = [c for c in chosen if store.archive.has(c[1], c[2])]
        ids = [c[0] for c in chosen]
        path = os.path.join(store.folder(sid), "inspect.json")
        try:
            with open(path) as f:
                cached = json.load(f)
            if [x["id"] for x in cached["frames"]] == ids:
                return cached
        except (OSError, ValueError, KeyError, TypeError):
            pass
        if not chosen:
            return {"sessionId": sid, "frames": [], "cells": None, "summary": None, "pixelScaleArcsec": None,
                    "width": None, "height": None, "computedAt": None}
        results = [self._measure(fid, rel) for fid, rel, _, _ in chosen]
        cells = combine([r["cells"] for r in results])
        out = {
            "sessionId": sid,
            "frames": [{"id": fid, "number": number} for fid, _, _, number in chosen],
            "cells": cells,
            "summary": summarize(cells),
            "pixelScaleArcsec": results[0]["pixelScaleArcsec"],
            "width": results[0]["width"], "height": results[0]["height"],
            "computedAt": time.time(),
        }
        tmp = os.path.join(store.folder(sid), f".inspect.{threading.get_ident()}.json")  # requests may overlap
        with open(tmp, "w") as f:
            json.dump(out, f, separators=(",", ":"))
        os.replace(tmp, path)
        return out
