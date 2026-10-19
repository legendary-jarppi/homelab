"""Registration: the transform that maps a frame's plane pixels onto the reference frame's.

Two ways in, one way out:
- the ASIAIR's plate solves of both frames (FITS WCS) give a first guess (`wcs_guess`);
- without one (Live frames) or when the guess does not hold, triangles of bright stars (side ratios
  are invariant to shift, rotation and scale) are matched between the frames, and the candidate
  transform that brings the most stars onto reference stars wins (RANSAC-like, `match_triangles`).
Either way `refine` then pairs stars by nearest neighbour with a shrinking radius and fits an affine
transform (a similarity while few pairs), dropping outliers, so a few false or missing stars do not
matter. Transforms are 3×3 homogeneous matrices on (x, y).
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

import fits

MIN_MATCHES = 8
TRIANGLE_STARS = 40  # brightest stars that form triangles
TRIANGLE_NEIGHBOURS = 6
MAX_CANDIDATES = 600
# Same camera and telescope: frames differ by shift and rotation; scale stays within a few percent.
SCALE_RANGE = (0.95, 1.05)
INLIER_PX = 2.0


@dataclass
class Registration:
    matrix: np.ndarray  # 3×3, frame → reference
    matches: int
    rms_px: float
    method: str  # "wcs" or "stars"


def apply(matrix: np.ndarray, xy: np.ndarray) -> np.ndarray:
    return xy @ matrix[:2, :2].T + matrix[:2, 2]


def fit_similarity(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """Least squares x' = a·x − b·y + tx, y' = b·x + a·y + ty."""
    n = len(src)
    a = np.zeros((2 * n, 4))
    a[0::2] = np.column_stack([src[:, 0], -src[:, 1], np.ones(n), np.zeros(n)])
    a[1::2] = np.column_stack([src[:, 1], src[:, 0], np.zeros(n), np.ones(n)])
    p, *_ = np.linalg.lstsq(a, dst.reshape(-1), rcond=None)
    return np.array([[p[0], -p[1], p[2]], [p[1], p[0], p[3]], [0, 0, 1]])


def fit_affine(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    a = np.column_stack([src, np.ones(len(src))])
    p, *_ = np.linalg.lstsq(a, dst, rcond=None)
    return np.vstack([p.T, [0, 0, 1]])


def scale_of(matrix: np.ndarray) -> float:
    return float(np.sqrt(abs(np.linalg.det(matrix[:2, :2]))))


def refine(src: np.ndarray, dst: np.ndarray, guess: np.ndarray, radii=(8.0, 4.0, 2.0)) -> Registration | None:
    """Pair stars around the guess and fit, tightening the radius; None if too few pairs."""
    if len(src) < MIN_MATCHES or len(dst) < MIN_MATCHES:
        return None
    tree = cKDTree(dst)
    matrix = guess
    pairs = None
    for radius in radii:
        distance, index = tree.query(apply(matrix, src), distance_upper_bound=radius)
        ok = np.isfinite(distance)
        # One reference star per frame star: keep the closest when several land on the same one.
        order = np.argsort(distance)
        seen: set[int] = set()
        keep = np.zeros(len(src), bool)
        for i in order:
            if ok[i] and index[i] not in seen:
                seen.add(int(index[i]))
                keep[i] = True
        if keep.sum() < MIN_MATCHES:
            return None
        s, d = src[keep], dst[index[keep]]
        fit = fit_affine if len(s) >= 20 else fit_similarity
        matrix = fit(s, d)
        residual = np.hypot(*(apply(matrix, s) - d).T)
        good = residual <= max(3 * np.median(residual), 0.5)
        if good.sum() >= MIN_MATCHES and not good.all():
            s, d = s[good], d[good]
            matrix = (fit_affine if len(s) >= 20 else fit_similarity)(s, d)
        pairs = (s, d)
    s, d = pairs
    rms = float(np.sqrt(np.mean(np.sum((apply(matrix, s) - d) ** 2, axis=1))))
    if not SCALE_RANGE[0] <= scale_of(matrix) <= SCALE_RANGE[1]:
        return None
    return Registration(matrix, len(s), rms, "stars")


def _triangles(xy: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Triangles of each star with pairs of its nearest neighbours: vertex indices in a canonical
    order (by the length of the opposite side, longest first) and invariants (side ratios)."""
    n = len(xy)
    if n < 3:
        return np.zeros((0, 3), int), np.zeros((0, 2))
    k = min(TRIANGLE_NEIGHBOURS + 1, n)
    _, neighbours = cKDTree(xy).query(xy, k=k)
    seen: set[tuple[int, int, int]] = set()
    for i in range(n):
        for j, l in itertools.combinations(neighbours[i][1:], 2):
            seen.add(tuple(sorted((i, int(j), int(l)))))
    tris = np.array(sorted(seen), int)
    p = xy[tris]  # (m, 3, 2)
    # Side opposite each vertex.
    opposite = np.stack([
        np.hypot(*(p[:, 1] - p[:, 2]).T),
        np.hypot(*(p[:, 0] - p[:, 2]).T),
        np.hypot(*(p[:, 0] - p[:, 1]).T),
    ], axis=1)
    order = np.argsort(-opposite, axis=1)
    tris = np.take_along_axis(tris, order, axis=1)
    sides = np.take_along_axis(opposite, order, axis=1)
    valid = sides[:, 2] > 3.0  # degenerate (near-coincident) triangles say nothing
    sides, tris = sides[valid], tris[valid]
    invariants = np.column_stack([sides[:, 1] / sides[:, 0], sides[:, 2] / sides[:, 0]])
    return tris, invariants


def match_triangles(src: np.ndarray, dst: np.ndarray) -> Registration | None:
    """Transform from matching star triangles, without any prior guess (any rotation, small scale)."""
    s, d = src[:TRIANGLE_STARS], dst[:TRIANGLE_STARS]
    s_tris, s_inv = _triangles(s)
    d_tris, d_inv = _triangles(d)
    if len(s_tris) == 0 or len(d_tris) == 0:
        return None
    distance, index = cKDTree(d_inv).query(s_inv, distance_upper_bound=0.01)
    candidates = np.nonzero(np.isfinite(distance))[0]
    if len(candidates) == 0:
        return None
    candidates = candidates[np.argsort(distance[candidates])][:MAX_CANDIDATES]
    tree = cKDTree(dst)
    best, best_inliers = None, 0
    for c in candidates:
        matrix = fit_similarity(s[s_tris[c]], d[d_tris[index[c]]])
        if not SCALE_RANGE[0] <= scale_of(matrix) <= SCALE_RANGE[1]:
            continue
        dist, _ = tree.query(apply(matrix, src), distance_upper_bound=INLIER_PX * 2)
        inliers = int(np.isfinite(dist).sum())
        if inliers > best_inliers:
            best, best_inliers = matrix, inliers
    if best is None or best_inliers < MIN_MATCHES:
        return None
    return refine(src, dst, best, radii=(4.0, 2.0))


def wcs_guess(frame: fits.Wcs, reference: fits.Wcs, shape: tuple[int, int], scale: float) -> np.ndarray:
    """Frame → reference plane transform from both plate solves, fitted over a grid of the plane.
    Plane pixel p spans camera pixels scale·p … scale·p + scale - 1: FITS pixel = scale·p + (scale+1)/2."""
    h, w = shape
    gy, gx = np.mgrid[0 : h : h / 6, 0 : w : w / 6]
    plane = np.column_stack([gx.ravel(), gy.ravel()])
    offset = (scale + 1) / 2
    ra, dec = frame.to_sky(plane[:, 0] * scale + offset, plane[:, 1] * scale + offset)
    x, y = reference.to_pixel(ra, dec)
    target = np.column_stack([(x - offset) / scale, (y - offset) / scale])
    return fit_affine(plane, target)


def register(src: np.ndarray, dst: np.ndarray, guess: np.ndarray | None = None) -> Registration | None:
    """Frame stars `src` onto reference stars `dst` (both (n, 2), brightest first)."""
    enough = max(MIN_MATCHES, int(0.25 * min(len(src), len(dst))))
    if guess is not None:
        result = refine(src, dst, guess)
        if result and result.matches >= enough:
            result.method = "wcs"
            return result
    result = match_triangles(src, dst)
    return result if result and result.matches >= MIN_MATCHES else None
