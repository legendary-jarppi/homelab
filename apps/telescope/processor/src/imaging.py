"""numpy around Siril: master statistics and the colour calibration used when Siril's photometric
one cannot run (no plate solve, catalogue not reachable, too few stars matched)."""

from __future__ import annotations

import numpy as np

import fitsio

ADU = 65535.0  # Siril's 32-bit floats are the 16-bit ADU / 65535


def master_stats(path: str) -> dict:
    """Median and pixel noise in 16-bit ADU over the central 80 %: the noise from differences of
    neighbouring pixels of the same CFA colour (two apart), so vignetting, dust and the colour
    channels' levels do not count (robust: MAD × 1.4826 / √2)."""
    data, _ = fitsio.read_float(path)
    plane = data[0]
    h, w = plane.shape
    crop = plane[h // 10 : h - h // 10, w // 10 : w - w // 10].astype(np.float64) * ADU
    median = float(np.median(crop[::3, ::3]))
    diff = (crop[:, 2:] - crop[:, :-2])[::3, ::3]
    noise = float(np.median(np.abs(diff - np.median(diff))) * 1.4826 / np.sqrt(2))
    return {"median": round(median, 2), "noise": round(noise, 3)}


def covered_rectangle(covered: np.ndarray, step: int = 4) -> tuple[int, int, int, int]:
    """(x0, y0, x1, y1) of a large axis-aligned rectangle with data everywhere: from the bounding
    box of the covered pixels, the side with the most empty pixels moves in until (almost) none
    are left. A summed-area table makes each count O(1)."""
    ys, xs = np.nonzero(covered)
    if ys.size == 0:
        raise ValueError("empty image")
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    sat = np.zeros((covered.shape[0] + 1, covered.shape[1] + 1), np.int64)
    sat[1:, 1:] = np.cumsum(np.cumsum(~covered, axis=0), axis=1)

    def empty(a: int, b: int, c: int, d: int) -> int:  # rows a:b, columns c:d
        return int(sat[b, d] - sat[a, d] - sat[b, c] + sat[a, c])

    while x1 - x0 > 2 * step and y1 - y0 > 2 * step and empty(y0, y1, x0, x1) > 0.0005 * (x1 - x0) * (y1 - y0):
        sides = {
            "top": empty(y0, y0 + step, x0, x1), "bottom": empty(y1 - step, y1, x0, x1),
            "left": empty(y0, y1, x0, x0 + step), "right": empty(y0, y1, x1 - step, x1),
        }
        side = max(sides, key=sides.get)
        if side == "top":
            y0 += step
        elif side == "bottom":
            y1 -= step
        elif side == "left":
            x0 += step
        else:
            x1 -= step
    return x0, y0, x1, y1


def crop_to_coverage(src: str, dst: str) -> tuple[int, int, int, int, int, int]:
    """`dst`: the stack cut to where every frame-covered pixel has data (stacked with -maximize,
    the canvas is the bounding box of all frames: other nights and camera angles leave empty
    corners). Returns (x0, y0, width, height, full width, full height)."""
    data, _ = fitsio.read_float(src)
    covered = np.all(data != 0, axis=0) & np.all(np.isfinite(data), axis=0)
    x0, y0, x1, y1 = covered_rectangle(covered)
    fitsio.write_cropped(src, dst, data[:, y0:y1, x0:x1], x0, y0)
    return x0, y0, x1 - x0, y1 - y0, data.shape[2], data.shape[1]


def _local_max(plane: np.ndarray, radius: int) -> np.ndarray:
    out = plane.copy()
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            if dx or dy:
                np.maximum(out, np.roll(plane, (dy, dx), axis=(0, 1)), out=out)
    return out


def star_white_balance(src: str, dst: str) -> str:
    """Background neutralised per channel (median of the sky), then channels scaled so that the
    median star (aperture photometry of up to 400 unsaturated stars) comes out white: the average
    star as white reference, like a G2V-ish white point. Returns a description for the log."""
    data, _ = fitsio.read_float(src)
    if data.shape[0] != 3:
        raise ValueError("not a colour image")
    sky = np.array([float(np.nanmedian(p[::4, ::4])) for p in data])
    noise = np.array([float(np.nanmedian(np.abs(p[::4, ::4] - s))) * 1.4826 for p, s in zip(data, sky)])
    lum = np.nan_to_num(data.mean(axis=0) - sky.mean())
    peaks = (lum == _local_max(lum, 4)) & (lum > 20 * noise.mean()) & (data.max(axis=0) < 0.9)
    peaks[:16], peaks[-16:], peaks[:, :16], peaks[:, -16:] = False, False, False, False
    ys, xs = np.nonzero(peaks)
    order = np.argsort(lum[ys, xs])[::-1][:400]
    fluxes = []
    r_in, r_out = 5, 9
    oy, ox = np.mgrid[-r_out : r_out + 1, -r_out : r_out + 1]
    rr = np.hypot(oy, ox)
    aperture, annulus = rr <= r_in, (rr > r_in + 2) & (rr <= r_out)
    for i in order:
        y, x = ys[i], xs[i]
        cut = data[:, y - r_out : y + r_out + 1, x - r_out : x + r_out + 1]
        if cut.shape[1:] != rr.shape:
            continue
        local = np.median(cut[:, annulus], axis=1)
        flux = (cut[:, aperture] - local[:, None]).sum(axis=1)
        if np.all(flux > 0):
            fluxes.append(flux)
    if len(fluxes) < 20:
        raise ValueError(f"only {len(fluxes)} stars measured")
    f = np.array(fluxes)
    ratio = np.median(f / f[:, 1:2], axis=0)  # R/G, 1, B/G
    factors = 1 / ratio
    factors /= factors.max()
    pedestal = float(sky.mean() * factors.mean())
    out = np.stack([(p - s) * k + pedestal for p, s, k in zip(data, sky, factors)]).astype(np.float32)
    fitsio.rewrite_float(src, dst, out)
    return (f"stars' average as white ({len(fluxes)} stars): R × {factors[0]:.3f}, G × {factors[1]:.3f}, "
            f"B × {factors[2]:.3f}, background neutralised")
