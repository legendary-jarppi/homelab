"""Straight trails in a light frame: satellites, planes, meteors (A7).

On the analysis' half-size planes (superpixels, 1504² for the ASI533MC): their sky-subtracted sum
binned 2×2 (the work plane, 752², each pixel 4×4 camera pixels), the large-scale background (median
of 16×16 blocks, bilinear between block centres) removed and divided by the noise. Two ways to the
pieces of a trail:

- bright: pixels above THRESHOLD σ joined into 8-connected pieces;
- faint: stars blanked, a line filter (the mean of FILTER_PX pixels in a row, in FILTER_ANGLES
  directions: a trail of a fraction of σ adds up along it), pixels above FAINT_SIGMA.

In each thin piece (few pixels for its length: not a star, a galaxy or a nebula) a Hough transform
finds the straight lines it holds (two crossing trails, a trail with stars touching it). Pieces on
one line (both ends within OFFSET_PX of the line through their centres) are one trail, so a trail
broken up by noise or stars counts once; it is followed along its line as far as it stays lit (see
_follow). A trail must span MIN_LENGTH, be lit and held along most of it (MIN_LIT, MIN_HELD; or be
dashed: DASHED_PIECES pieces) and be as narrow as a star (WIDTH_FACTOR × the stars' FWHM): straight
bits of nebula filaments are wider. Trails fainter than ~1.5 σ per work pixel are missed, and faint
ones are often drawn shorter than they are.

Trails are only marked; they never reject a frame (the stack's sigma clipping removes them).
Coordinates of the result: the preview grid (superpixel display pixels: x right, y down, pixel
centres at integers, the top left pixel's centre at 0, 0), as the 1504² previews.
"""

from __future__ import annotations

import math

import numpy as np
from scipy import ndimage

BIN = 2  # work plane pixel = BIN × BIN plane pixels
BLOCK = 16  # background block (work pixels)
THRESHOLD = 3.0  # σ above the background
MARGIN = 3  # work pixels at the frame's edges left out
MIN_PIXELS = 8  # smaller pieces are noise, hot pixels, faint stars
PIECE_MIN = 10.0  # a line's length within a piece (work pixels)
SPARSE_PX = 6.0  # most pixels per unit of a piece's length: thin things only
CORE_PX = 1.5  # pixels this close to a line are on it
HOUGH_STEP_DEG = 0.5
LINES_PER_PIECE = 4
# Faint trails: stars above STAR_SIGMA (grown by STAR_GROW pixels) blanked, a line filter of
# FILTER_PX pixels in FILTER_ANGLES directions, its pixels above FAINT_SIGMA; noise makes short
# streaks along the filter, so pieces must be longer.
STAR_SIGMA = 4.0
STAR_GROW = 2
FILTER_PX = 9
FILTER_ANGLES = 8
FAINT_SIGMA = 3.5
FAINT_PIECE_MIN = 20.0
OFFSET_PX = 2.5  # pieces whose ends lie this close to a line are on it
DUPLICATE_DEG = 5.0  # a line this close in direction and lying on a found trail is that trail
# Along a trail (see _follow): the mean across it minus beside it, in σ, over windows of LIT_WINDOW.
# Lit: the window's median above LIT_SIGMA; held: its STRICT_PERCENTILE above STRICT_SIGMA (a trail
# lights a window throughout, stars crossing the line only here and there). Measured on the archive:
# trails 0.88–0.92 lit and 0.72–0.85 held; the false lines that came closest (straight bits of
# filaments, star chains) 0.47–0.56 lit, 0.17–0.32 held.
LIT_WINDOW = 15  # work pixels
LIT_SIGMA = 0.8
STRICT_PERCENTILE = 25
STRICT_SIGMA = 0.5
GAP_PX = 40  # a broken trail is followed over gaps up to this
TRIM_PX = 9
TRIM_SHARE = 0.5
TRIM_SIGMA = 0.6
MIN_LENGTH = 60.0  # work pixels: 240 camera pixels, ~4.6′ at 670 mm
MIN_LIT = 0.75  # share of its length lit …
MIN_HELD = 0.6  # … and held
DASHED_PIECES = 5  # or this many pieces on the line (a dashed plane trail) …
DASHED_COVER = 0.3  # … covering this share of its length
WIDTH_FACTOR = 1.8  # most a trail's FWHM across it, × the stars' FWHM
WIDTH_MIN_PX = 2.0  # work pixels; the limit when the stars are smaller or unknown
PRECHECK_MARGIN = 1.25  # the width where its pieces are, before following it, may be this much wider


def work_plane(planes: list[np.ndarray], sky: list[tuple[float, float]]) -> np.ndarray:
    """The sky-subtracted sum of the planes, binned, background removed, in units of its noise."""
    total = np.zeros(planes[0].shape, np.float32)
    for plane, (median, _) in zip(planes, sky):
        total += plane
        total -= np.float32(median)
    h, w = (total.shape[0] // BIN) * BIN, (total.shape[1] // BIN) * BIN
    work = total[:h, :w].reshape(h // BIN, BIN, w // BIN, BIN).mean(axis=(1, 3))
    work -= _background(work)
    sample = work[::2, ::2]
    sigma = float(np.median(np.abs(sample - np.median(sample)))) * 1.4826 or 1.0
    return work / np.float32(sigma)


def _background(work: np.ndarray) -> np.ndarray:
    h, w = work.shape
    by, bx = h // BLOCK, w // BLOCK
    blocks = work[: by * BLOCK, : bx * BLOCK].reshape(by, BLOCK, bx, BLOCK)
    medians = np.median(blocks.transpose(0, 2, 1, 3).reshape(by, bx, -1), axis=2)
    # Bilinear between block centres, separably: rows first, then columns.
    yy = (np.arange(h, dtype=np.float32) + 0.5) / BLOCK - 0.5
    xx = (np.arange(w, dtype=np.float32) + 0.5) / BLOCK - 0.5
    y0 = np.clip(np.floor(yy).astype(int), 0, by - 1)
    fy = np.clip(yy - y0, 0, 1)[:, None]
    rows = medians[y0] * (1 - fy) + medians[np.minimum(y0 + 1, by - 1)] * fy
    x0 = np.clip(np.floor(xx).astype(int), 0, bx - 1)
    fx = np.clip(xx - x0, 0, 1)[None, :]
    return (rows[:, x0] * (1 - fx) + rows[:, np.minimum(x0 + 1, bx - 1)] * fx).astype(np.float32)


def detect(planes: list[np.ndarray], sky: list[tuple[float, float]], star_fwhm: float | None) -> list[dict]:
    """Trails as [{x0, y0, x1, y1, widthPx}] on the preview grid (see the module docstring);
    `star_fwhm` in plane pixels (the analysis' median), None when unknown."""
    if min(planes[0].shape) < BIN * (MIN_LENGTH + 2 * MARGIN + BLOCK):
        return []
    return find(work_plane(planes, sky), star_fwhm / BIN if star_fwhm else None)


def _hough(x: np.ndarray, y: np.ndarray) -> tuple[float, float, float]:
    """The strongest line through the pixels: a point on it and its direction (radians)."""
    cx, cy = float(x.mean()), float(y.mean())
    thetas = np.radians(np.arange(0, 180, HOUGH_STEP_DEG))
    rho = np.rint((x - cx)[:, None] * np.cos(thetas) + (y - cy)[:, None] * np.sin(thetas)).astype(np.int64)
    reach = int(np.abs(rho).max()) + 1
    votes = np.bincount((rho + reach + np.arange(len(thetas)) * (2 * reach + 1)).ravel(),
                        minlength=len(thetas) * (2 * reach + 1))
    best = int(votes.argmax())
    theta, r = thetas[best // (2 * reach + 1)], best % (2 * reach + 1) - reach
    # theta is the normal's direction; the line runs at theta + 90°.
    return cx + r * math.cos(theta), cy + r * math.sin(theta), theta + math.pi / 2


def _fit(x: np.ndarray, y: np.ndarray) -> tuple[float, float, float]:
    """Centre and direction (radians) of the pixels' principal axis."""
    cx, cy = float(x.mean()), float(y.mean())
    dx, dy = x - cx, y - cy
    return cx, cy, 0.5 * math.atan2(2 * float((dx * dy).mean()), float((dx * dx).mean() - (dy * dy).mean()))


def _across(x: np.ndarray, y: np.ndarray, cx: float, cy: float, angle: float) -> tuple[np.ndarray, np.ndarray]:
    """Positions along and distances across a line."""
    ux, uy = math.cos(angle), math.sin(angle)
    return (x - cx) * ux + (y - cy) * uy, -(x - cx) * uy + (y - cy) * ux


def _faint(work: np.ndarray) -> np.ndarray:
    """Pixels on faint lines: stars (and bright trails, found without this) blanked, then the
    largest of FILTER_ANGLES mean values over FILTER_PX pixels in a row through each pixel (a line
    filter: a trail of a fraction of σ adds up along it, noise only by √FILTER_PX)."""
    blank = ndimage.binary_dilation(work > STAR_SIGMA, iterations=STAR_GROW)
    clean = np.where(blank, np.float32(0), work)
    r = FILTER_PX // 2
    padded = np.pad(clean, r)
    h, w = work.shape
    best = np.full(work.shape, -np.inf, np.float32)
    for k in range(FILTER_ANGLES):
        theta = math.pi * k / FILTER_ANGLES
        c, s = math.cos(theta), math.sin(theta)
        # FILTER_PX distinct pixels along the direction (one per column or per row).
        steps = [(i, round(i * s / c)) if abs(c) >= abs(s) else (round(i * c / s), i) for i in range(-r, r + 1)]
        total = np.zeros(work.shape, np.float32)
        for dx, dy in steps:
            total += padded[r + dy : r + dy + h, r + dx : r + dx + w]
        np.maximum(best, total, out=best)
    # A sum of FILTER_PX unit-noise pixels has noise √FILTER_PX.
    return best / np.float32(math.sqrt(FILTER_PX)) > FAINT_SIGMA


def _pieces(mask: np.ndarray, min_length: float) -> list[dict]:
    """Straight runs of pixels in a mask: {x, y (their pixels), cx, cy, angle, length}."""
    mask = mask.copy()
    mask[:MARGIN, :] = mask[-MARGIN:, :] = False
    mask[:, :MARGIN] = mask[:, -MARGIN:] = False
    labels, count = ndimage.label(mask, structure=np.ones((3, 3), bool))
    if count == 0:
        return []
    ys, xs = np.nonzero(mask)
    ids = labels[ys, xs]
    n = np.bincount(ids, minlength=count + 1).astype(np.float64)
    xs_f, ys_f = xs.astype(np.float64), ys.astype(np.float64)
    with np.errstate(invalid="ignore", divide="ignore"):
        mx = np.bincount(ids, xs_f, count + 1) / n
        my = np.bincount(ids, ys_f, count + 1) / n
        cxx = np.bincount(ids, xs_f * xs_f, count + 1) / n - mx * mx
        cyy = np.bincount(ids, ys_f * ys_f, count + 1) / n - my * my
        cxy = np.bincount(ids, xs_f * ys_f, count + 1) / n - mx * my
        major = (cxx + cyy) / 2 + np.sqrt(((cxx - cyy) / 2) ** 2 + cxy**2)
        length = np.sqrt(12 * np.maximum(major, 0))  # a uniform line's length from its second moment
        candidate = (n >= MIN_PIXELS) & (length >= min_length) & (n <= SPARSE_PX * length)
    candidate[0] = False
    keep = np.nonzero(candidate)[0]
    if len(keep) == 0:
        return []
    order = np.argsort(ids, kind="stable")
    starts = np.concatenate([[0], np.cumsum(n.astype(np.int64))])
    pieces = []
    for k in keep:
        idx = order[starts[k] : starts[k + 1]]
        px, py = xs_f[idx], ys_f[idx]
        for _ in range(LINES_PER_PIECE):
            if len(px) < MIN_PIXELS:
                break
            cx, cy, angle = _hough(px, py)
            on = np.abs(_across(px, py, cx, cy, angle)[1]) <= CORE_PX
            if on.sum() < MIN_PIXELS:
                break
            cx, cy, angle = _fit(px[on], py[on])
            t, d = _across(px, py, cx, cy, angle)
            on = np.abs(d) <= CORE_PX
            extent = float(t[on].max() - t[on].min()) if on.any() else 0.0
            if on.sum() < MIN_PIXELS or extent < min_length:
                break
            pieces.append({"x": px[on], "y": py[on], "cx": cx, "cy": cy, "angle": angle, "length": extent})
            px, py = px[~on], py[~on]
    return pieces


def _on_line(piece: dict, cx: float, cy: float, angle: float) -> bool:
    """Both ends of the piece (along its own axis) within OFFSET_PX of the line: a short piece's
    direction is uncertain, so the angle it may differ by shrinks with its length."""
    half = piece["length"] / 2
    ex = piece["cx"] + np.array([-half, half]) * math.cos(piece["angle"])
    ey = piece["cy"] + np.array([-half, half]) * math.sin(piece["angle"])
    return bool(np.all(np.abs(_across(ex, ey, cx, cy, angle)[1]) <= OFFSET_PX))


def _chord(shape: tuple[int, int], cx: float, cy: float, angle: float) -> tuple[float, float]:
    """Positions along the line where it enters and leaves the frame (inside the margins)."""
    ux, uy = math.cos(angle), math.sin(angle)
    lo, hi = -1e9, 1e9
    for c, u, size in ((cx, ux, shape[1]), (cy, uy, shape[0])):
        if abs(u) < 1e-9:
            continue
        a, b = (MARGIN - c) / u, (size - 1 - MARGIN - c) / u
        lo, hi = max(lo, min(a, b)), min(hi, max(a, b))
    return lo, hi


def _sample(work: np.ndarray, cx: float, cy: float, angle: float, t: np.ndarray, offsets: np.ndarray) -> np.ndarray:
    """Work plane values at positions t along and offsets across a line: (offsets, t)."""
    ux, uy = math.cos(angle), math.sin(angle)
    xs = cx + t[None, :] * ux - offsets[:, None] * uy
    ys = cy + t[None, :] * uy + offsets[:, None] * ux
    return ndimage.map_coordinates(work, [ys.ravel(), xs.ravel()], order=1, mode="nearest").reshape(xs.shape)


def _width(work: np.ndarray, cx: float, cy: float, angle: float, t: np.ndarray) -> float:
    """FWHM across the trail (work pixels; 0 when there is no peak): the median profile across it."""
    offsets = np.arange(-8, 8.01, 0.25)
    profile = np.median(_sample(work, cx, cy, angle, t, offsets), axis=1)
    profile -= np.median(profile[np.abs(offsets) >= 6])
    i = int(np.argmax(profile[np.abs(offsets) <= 2])) + int(np.argmax(np.abs(offsets) <= 2))
    peak = float(profile[i])
    if peak <= 0:
        return 0.0
    half = peak / 2
    left = i
    while left > 0 and profile[left - 1] > half:
        left -= 1
    right = i
    while right < len(offsets) - 1 and profile[right + 1] > half:
        right += 1
    step = offsets[1] - offsets[0]
    # Linear between the samples either side of each half-maximum crossing.
    lx = offsets[left] - step * (profile[left] - half) / max(profile[left] - profile[left - 1], 1e-9) if left > 0 else offsets[0]
    rx = offsets[right] + step * (profile[right] - half) / max(profile[right] - profile[right + 1], 1e-9) \
        if right < len(offsets) - 1 else offsets[-1]
    return float(rx - lx)


def _follow(work: np.ndarray, cx: float, cy: float, angle: float, t0: float,
            t1: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """The trail's positions along the line, which of them are lit and which held (see LIT_WINDOW).

    From its pieces' extent t0…t1 it is followed outwards to further lit runs of at least LIT_WINDOW
    over gaps up to GAP_PX, then each end is trimmed back (not into its pieces) to where the median of
    TRIM_PX samples reaches TRIM_SHARE of the trail's median (at least TRIM_SIGMA): the window would
    otherwise carry it past its end, and a star just beyond it would hold a mean."""
    lo, hi = _chord(work.shape, cx, cy, angle)
    along = np.arange(math.ceil(lo), math.floor(hi) + 1, 1.0)
    if len(along) < LIT_WINDOW:
        return along[:0], along[:0].astype(bool), along[:0].astype(bool)
    # The mean across it (±1 px) minus the median beside it (±4…6 px).
    on = _sample(work, cx, cy, angle, along, np.array([-1.0, 0.0, 1.0])).mean(axis=0)
    beside = np.median(_sample(work, cx, cy, angle, along, np.array([-6.0, -5.0, -4.0, 4.0, 5.0, 6.0])), axis=0)
    raw = on - beside
    lit = ndimage.median_filter(raw, size=LIT_WINDOW, mode="nearest") > LIT_SIGMA
    held = ndimage.percentile_filter(raw, STRICT_PERCENTILE, size=LIT_WINDOW, mode="nearest") > STRICT_SIGMA
    first = int(np.clip(round(t0 - along[0]), 0, len(along) - 1))
    last = int(np.clip(round(t1 - along[0]), 0, len(along) - 1))
    a, b = first, last
    runs, _ = ndimage.label(lit)
    spans = [s[0] for s in ndimage.find_objects(runs)]
    for s in sorted(spans, key=lambda s: -s.start):  # runs before, nearest first
        if s.start < a and (s.stop > a or (s.stop - s.start >= LIT_WINDOW and a - s.stop <= GAP_PX)):
            a = s.start
    for s in sorted(spans, key=lambda s: s.start):  # runs after
        if s.stop - 1 > b and (s.start <= b or (s.stop - s.start >= LIT_WINDOW and s.start - b <= GAP_PX)):
            b = s.stop - 1
    level_at = ndimage.median_filter(raw, size=TRIM_PX, mode="nearest")
    inside = raw[a : b + 1][lit[a : b + 1]]
    level = max(TRIM_SIGMA, TRIM_SHARE * float(np.median(inside))) if len(inside) else TRIM_SIGMA
    while a < first and level_at[a] < level:
        a += 1
    while b > last and level_at[b] < level:
        b -= 1
    return along[a : b + 1], lit[a : b + 1], held[a : b + 1]


def _ends(pieces: list[dict]) -> np.ndarray:
    """Both ends of every piece along its own axis: (pieces, 2 ends, x/y)."""
    c = np.array([[p["cx"], p["cy"]] for p in pieces])
    u = np.array([[math.cos(p["angle"]), math.sin(p["angle"])] for p in pieces])
    half = np.array([p["length"] / 2 for p in pieces])[:, None]
    return np.stack([c - u * half, c + u * half], axis=1)


def _partners(pieces: list[dict], ends: np.ndarray, i: int, free: np.ndarray) -> list[int]:
    """The free pieces on one line with piece i. Short pieces' own directions are too uncertain to
    join pieces far apart, so the candidate lines run through the centres of i and of each other
    piece; a piece is on such a line when both its ends are within OFFSET_PX of it, and the line
    most piece length lies on wins."""
    centres = ends.mean(axis=1)
    d = centres - centres[i]
    candidate = free & (np.hypot(d[:, 0], d[:, 1]) > 0)
    candidate[i] = False
    if not candidate.any():
        return []
    theta = np.arctan2(d[candidate, 1], d[candidate, 0])
    ux, uy = np.cos(theta), np.sin(theta)
    rel = ends - centres[i]  # (pieces, 2, 2)
    # Distance of every piece's ends from every candidate line: (lines, pieces).
    dist = np.maximum(np.abs(-rel[None, :, 0, 0] * uy[:, None] + rel[None, :, 0, 1] * ux[:, None]),
                      np.abs(-rel[None, :, 1, 0] * uy[:, None] + rel[None, :, 1, 1] * ux[:, None]))
    on = (dist <= OFFSET_PX) & (free | (np.arange(len(pieces)) == i))[None, :]
    on &= on[:, i : i + 1]  # piece i itself must lie on the line
    lengths = np.array([p["length"] for p in pieces])
    support = (on * lengths[None, :]).sum(axis=1)
    best = int(np.argmax(support))
    if not on[best, i]:
        return []
    return [j for j in np.nonzero(on[best])[0] if j != i]


def find(work: np.ndarray, star_fwhm: float | None = None) -> list[dict]:
    """Trails on a work plane (background removed, in units of the noise); `star_fwhm` in work pixels."""
    pieces = _pieces(work > THRESHOLD, PIECE_MIN) + _pieces(_faint(work), FAINT_PIECE_MIN)
    pieces.sort(key=lambda p: -p["length"])
    if not pieces:
        return []
    ends = _ends(pieces)
    used = np.zeros(len(pieces), bool)
    max_width = max(WIDTH_MIN_PX, WIDTH_FACTOR * star_fwhm) if star_fwhm else WIDTH_MIN_PX
    trails, lines = [], []
    for i in range(len(pieces)):
        if used[i]:
            continue
        members = [i] + _partners(pieces, ends, i, ~used)
        for _ in range(2):  # refit on all their pixels, gather along the longer baseline
            x = np.concatenate([pieces[j]["x"] for j in members])
            y = np.concatenate([pieces[j]["y"] for j in members])
            cx, cy, angle = _fit(x, y)
            members = [i] + [j for j, p in enumerate(pieces) if j != i and not used[j] and _on_line(p, cx, cy, angle)]
        x = np.concatenate([pieces[j]["x"] for j in members])
        y = np.concatenate([pieces[j]["y"] for j in members])
        cx, cy, angle = _fit(x, y)
        # The same trail again (pixels at the edge of a bright one, its fragments): not another.
        if any(abs((angle - a + math.pi / 2) % math.pi - math.pi / 2) <= math.radians(DUPLICATE_DEG)
               and np.median(np.abs(_across(x, y, lx, ly, a)[1])) <= OFFSET_PX + w / 2 for lx, ly, a, w in lines):
            used[members] = True
            continue
        t, _ = _across(x, y, cx, cy, angle)
        # Too wide across where its pieces are (a nebula's filament): no need to follow it.
        if not 0 < _width(work, cx, cy, angle, np.unique(np.round(t))) <= max_width * PRECHECK_MARGIN:
            continue
        along, lit, held = _follow(work, cx, cy, angle, float(t.min()), float(t.max()))
        if len(along) < 2 or along[-1] - along[0] < MIN_LENGTH:
            continue
        # Lit and held along most of it, or a dashed one: many pieces covering a good part of it.
        dashed = len(members) >= DASHED_PIECES and sum(pieces[j]["length"] for j in members) >= DASHED_COVER * (along[-1] - along[0])
        if (lit.mean() < MIN_LIT or held.mean() < MIN_HELD) and not dashed:
            continue
        width = _width(work, cx, cy, angle, along[lit] if lit.sum() >= LIT_WINDOW else np.unique(np.round(t)))
        if not 0 < width <= max_width:
            continue
        lines.append((cx, cy, angle, width))
        # Its pieces, and any other piece lying along it (fragments of the same trail whose own
        # direction strayed), are done.
        for j, p in enumerate(pieces):
            if not used[j]:
                pt, pd = _across(p["x"], p["y"], cx, cy, angle)
                if j in members or (np.median(np.abs(pd)) <= OFFSET_PX + width / 2
                                    and along[0] - GAP_PX <= np.median(pt) <= along[-1] + GAP_PX):
                    used[j] = True
        ux, uy = math.cos(angle), math.sin(angle)
        # Work pixel w spans plane pixels BIN·w … BIN·w + BIN − 1: centre BIN·w + (BIN − 1)/2.
        trails.append({
            "x0": round(float(BIN * (cx + along[0] * ux) + (BIN - 1) / 2), 1),
            "y0": round(float(BIN * (cy + along[0] * uy) + (BIN - 1) / 2), 1),
            "x1": round(float(BIN * (cx + along[-1] * ux) + (BIN - 1) / 2), 1),
            "y1": round(float(BIN * (cy + along[-1] * uy) + (BIN - 1) / 2), 1),
            "widthPx": round(width * BIN, 1),
        })
    return trails
