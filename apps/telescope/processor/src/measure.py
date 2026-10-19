"""One star measured where the user clicked: refined centroid, FWHM, HFR, elongation, SNR, peak,
saturation and the radial profile. numpy only (the telescope processor uses the same file).

Coordinates are display pixels: the array's column/row index, pixel centres at integers (display
x = FITS x − 1, rows top-down). The caller cuts a region around the click (`region_around`) from
whatever holds the pixels (a memory-mapped FITS, an .npy) and passes it with its top-left corner,
so a click never reads the whole image.

Definitions (the same for every image kind):
- the brightest star within SEARCH_PX of the click (on a 3×3 mean, so a hot pixel does not win);
  `found` is false without a peak 5σ above the local background;
- background and σ: median and MAD of the surrounding box, clipped at 3σ twice;
- an elliptical Moffat profile (β free, integrated over each pixel by 3×3 sub-samples; saturated
  pixels left out) gives the centroid and the FWHM along both axes: fwhmPx = √(major·minor),
  elongation = 1 − minor/major (0 = round), angleDeg = the major axis, degrees clockwise from +x on
  the screen (y down), 0–180; second moments when the fit does not converge;
- hfrPx: the flux-weighted mean radius within 3 × FWHM (the frames' HFR formula, but the values
  above the background not clipped at zero, so noise does not push it outwards);
- snr: aperture flux within 1.5 × FWHM over σ·√(pixels) (background-limited);
- peak: the highest pixel within 2 px of the centroid; saturated: peak ≥ the caller's level;
- profile: [[radius, mean value above the background]] in 0.5 px rings out to max(8, 3 × FWHM).
"""

from __future__ import annotations

import math

import numpy as np

SEARCH_PX = 12
BOX_PX = 48  # half size of the box for the background
REGION_PX = 100  # half size of the region the caller cuts around the click
DETECT_SIGMA = 5.0
RING_PX = 0.5
SUB = np.array([-1 / 3, 0.0, 1 / 3])
BETA_RANGE = (1.1, 50.0)


def region_around(shape: tuple[int, ...], x: float, y: float) -> tuple[int, int, int, int]:
    """Rows y0:y1 and columns x0:x1 (clipped to the image) to cut around a click."""
    h, w = shape[-2], shape[-1]
    xi, yi = int(round(x)), int(round(y))
    return max(0, yi - REGION_PX), min(h, yi + REGION_PX + 1), max(0, xi - REGION_PX), min(w, xi + REGION_PX + 1)


def _clipped(values: np.ndarray) -> tuple[float, float]:
    median = float(np.median(values))
    sigma = float(np.median(np.abs(values - median))) * 1.4826
    for _ in range(2):
        keep = values[np.abs(values - median) <= 3 * max(sigma, 1e-12)]
        if len(keep) < 20:
            break
        median = float(np.median(keep))
        sigma = float(np.median(np.abs(keep - median))) * 1.4826
    return median, sigma


def _mean3(a: np.ndarray) -> np.ndarray:
    p = np.pad(a, 1, mode="edge")
    return sum(p[dy : dy + a.shape[0], dx : dx + a.shape[1]] for dy in range(3) for dx in range(3)) / 9


def _moffat(p: np.ndarray, dx: np.ndarray, dy: np.ndarray) -> np.ndarray:
    """bg + A·(1 + a·u² + 2b·u·v + c·v²)^−β, averaged over 3×3 sub-samples of each pixel."""
    bg, amp, x0, y0, a, b, c, beta = p
    u = (dx[..., None, None] + SUB[None, :] - x0)
    v = (dy[..., None, None] + SUB[:, None] - y0)
    q = a * u * u + 2 * b * u * v + c * v * v
    return bg + amp * np.mean((1 + q) ** -beta, axis=(-1, -2))


def _valid(p: np.ndarray) -> bool:
    _, amp, _, _, a, b, c, beta = p
    return amp > 0 and a > 0 and c > 0 and a * c - b * b > 0 and BETA_RANGE[0] <= beta <= BETA_RANGE[1]


def _fit(p0: np.ndarray, dx: np.ndarray, dy: np.ndarray, data: np.ndarray) -> np.ndarray | None:
    """Levenberg–Marquardt with a numerical Jacobian; None when it does not converge."""
    p = p0.copy()
    resid = _moffat(p, dx, dy) - data
    cost = float(resid @ resid)
    lam = 1e-3
    for _ in range(80):
        jac = np.empty((len(data), len(p)))
        for i in range(len(p)):
            step = 1e-6 * max(abs(p[i]), 1e-3)
            q = p.copy()
            q[i] += step
            jac[:, i] = (_moffat(q, dx, dy) - data - resid) / step
        jtj, grad = jac.T @ jac, jac.T @ resid
        while True:
            try:
                delta = np.linalg.solve(jtj + lam * np.diag(np.diag(jtj) + 1e-12), -grad)
            except np.linalg.LinAlgError:
                return None
            trial = p + delta
            trial[7] = min(max(trial[7], BETA_RANGE[0]), BETA_RANGE[1])
            if _valid(trial):
                r = _moffat(trial, dx, dy) - data
                c = float(r @ r)
                if c < cost:
                    break
            lam *= 4
            if lam > 1e10:
                return p if _valid(p) else None
        improvement = (cost - c) / max(cost, 1e-30)
        p, resid, cost, lam = trial, r, c, max(lam / 3, 1e-9)
        if improvement < 1e-9:
            break
    return p if _valid(p) else None


def _axes(a: float, b: float, c: float, beta: float) -> tuple[float, float, float]:
    """FWHM along the major and minor axes and the major axis' angle (clockwise from +x, y down)."""
    eigenvalues, vectors = np.linalg.eigh(np.array([[a, b], [b, c]]))
    k = 2 ** (1 / beta) - 1
    major = 2 * math.sqrt(k / eigenvalues[0])
    minor = 2 * math.sqrt(k / eigenvalues[1])
    vx, vy = vectors[:, 0]
    return major, minor, math.degrees(math.atan2(vy, vx)) % 180


def _moments(values: np.ndarray, dx: np.ndarray, dy: np.ndarray, x0: float, y0: float):
    w = np.clip(values, 0, None)
    total = max(float(w.sum()), 1e-12)
    ux, uy = dx - x0, dy - y0
    ixx, iyy, ixy = (w * ux * ux).sum() / total, (w * uy * uy).sum() / total, (w * ux * uy).sum() / total
    half, root = (ixx + iyy) / 2, math.sqrt(((ixx - iyy) / 2) ** 2 + ixy**2)
    major, minor = 2.3548 * math.sqrt(max(half + root, 1e-6)), 2.3548 * math.sqrt(max(half - root, 1e-6))
    return major, minor, math.degrees(0.5 * math.atan2(2 * ixy, ixx - iyy)) % 180


def _num(value: float, digits: int = 5) -> float:
    return float(f"{value:.{digits}g}")


def measure(region: np.ndarray, x: float, y: float, *, origin: tuple[int, int] = (0, 0), saturation: float,
            scale_arcsec: float | None = None, linear: bool = True) -> dict:
    """The star nearest the brightest peak within SEARCH_PX of display pixel (x, y).

    `region`: 2-D (luminance) pixels, NaN where there is no data; `origin`: its top-left (column,
    row) in the image; `saturation`: the level a pixel counts as clipped at, in the data's units."""
    not_found = {"found": False, "linear": linear}
    ox, oy = origin
    h, w = region.shape
    cx, cy = x - ox, y - oy
    if not (0 <= cx < w and 0 <= cy < h):
        return not_found
    y0, y1 = max(0, int(cy) - BOX_PX), min(h, int(cy) + BOX_PX + 1)
    x0, x1 = max(0, int(cx) - BOX_PX), min(w, int(cx) + BOX_PX + 1)
    box = np.asarray(region[y0:y1, x0:x1], dtype=np.float64)
    finite = np.isfinite(box)
    if finite.sum() < 100:
        return not_found
    bg, sigma = _clipped(box[finite])
    sigma = sigma or 1e-12
    box = np.where(finite, box, bg)
    gy, gx = np.mgrid[y0:y1, x0:x1].astype(np.float64)
    smooth = _mean3(box)
    near = (gx - cx) ** 2 + (gy - cy) ** 2 <= SEARCH_PX**2
    i = int(np.argmax(np.where(near, smooth, -np.inf)))
    py, px = np.unravel_index(i, box.shape)
    if smooth[py, px] - bg < DETECT_SIGMA * sigma / 3:  # the 3×3 mean has a third of the noise
        return not_found

    # First guess: the half-maximum area and the centroid of the core.
    amp0 = float(box[max(py - 1, 0) : py + 2, max(px - 1, 0) : px + 2].max()) - bg
    r = np.hypot(gx - gx[py, px], gy - gy[py, px])
    half = (box - bg >= amp0 / 2) & (r <= 15)
    fwhm0 = min(max(2 * math.sqrt(half.sum() / math.pi), 1.5), 30.0)
    core = r <= max(fwhm0, 2.0)
    wc = np.clip(box[core] - bg, 0, None)
    xc = float((wc * gx[core]).sum() / max(wc.sum(), 1e-12)) if wc.sum() > 0 else float(gx[py, px])
    yc = float((wc * gy[core]).sum() / max(wc.sum(), 1e-12)) if wc.sum() > 0 else float(gy[py, px])

    fit_r = min(max(3 * fwhm0, 5.0), 25.0)
    window = (np.hypot(gx - xc, gy - yc) <= fit_r) & finite & (box < saturation)
    k0 = (2 ** (1 / 3) - 1) / (fwhm0 / 2) ** 2
    params = None
    if window.sum() >= 12:
        params = _fit(np.array([bg, max(amp0, sigma), xc, yc, k0, 0.0, k0, 3.0]), gx[window], gy[window], box[window])
    if params is not None and np.hypot(params[2] - xc, params[3] - yc) <= max(fwhm0, 3.0):
        xc, yc = float(params[2]), float(params[3])
        major, minor, angle = _axes(*params[4:8])
        if not (0.3 < minor <= major < 100):
            params = None
    if params is None:
        ring = np.hypot(gx - xc, gy - yc) <= max(2 * fwhm0, 4.0)
        major, minor, angle = _moments(box[ring] - bg, gx[ring], gy[ring], xc, yc)
    fwhm = math.sqrt(major * minor)

    dist = np.hypot(gx - xc, gy - yc)
    above = box - bg
    ap = (dist <= max(3 * fwhm, 4.0)) & finite
    # Not clipped at zero (unlike the frames' quick HFR): clipped noise would push it outwards.
    flux = float(above[ap].sum())
    hfr = float((above[ap] * dist[ap]).sum()) / flux if flux > 0 else None
    snr_ap = (dist <= max(1.5 * fwhm, 2.0)) & finite
    snr = float(above[snr_ap].sum() / (sigma * math.sqrt(snr_ap.sum())))
    raw = np.asarray(region[y0:y1, x0:x1], dtype=np.float64)
    peak = float(np.nanmax(np.where(dist <= 2, raw, np.nan)))

    limit = max(8.0, 3 * fwhm)
    inside = (dist <= limit) & finite
    rings = (dist[inside] / RING_PX).astype(int)
    sums = np.bincount(rings, weights=above[inside])
    counts = np.bincount(rings)
    profile = [[round((k + 0.5) * RING_PX, 2), _num(sums[k] / counts[k])] for k in range(len(counts)) if counts[k]]

    return {
        "found": True,
        "x": round(xc + ox, 3),
        "y": round(yc + oy, 3),
        "fwhmPx": round(fwhm, 3),
        "fwhmArcsec": round(fwhm * scale_arcsec, 3) if scale_arcsec else None,
        "hfrPx": round(hfr, 3) if hfr is not None else None,
        "elongation": round(1 - minor / major, 3),
        "angleDeg": round(angle, 1),
        "peak": _num(peak),
        "background": _num(bg),
        "snr": round(snr, 1),
        "saturated": bool(peak >= saturation),
        "linear": linear,
        "profile": profile,
    }
