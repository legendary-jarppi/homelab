"""The viewer's data for a final (B1/B2): the plate solve of the processed image, the linear data's
histogram and noise, and stars measured on the linear data (measure.py, the same file as the
telescope service's).

Coordinates: the processed image (full.jpg) shows the cropped stack's data row 1 at the top
(`mirrorx` before saving), so a display pixel (x, y) (0-based, from the top-left) is column
x0 + x, row y0 + y of linear.fits, where (x0, y0) is the crop's corner. The WCS is given in FITS
terms for the cropped data array (1-based, y in data rows): x_disp = x_fits − 1, y_disp = y_fits − 1.
"""

from __future__ import annotations

import math
import re

import numpy as np

import fitsio
import measure

SATURATION = 0.98  # Siril's 0…1 floats: the channels' mean this high was clipped in the frames
SIP = re.compile(r"^[AB]_(ORDER|\d+_\d+)$")


def crop_wcs(header: dict[str, str], x0: int, y0: int) -> dict | None:
    """The plate solve of a stack's header as FITS keywords for its crop starting at column `x0`,
    row `y0` (0-based): CTYPE, CRVAL, CRPIX moved by the crop, the CD matrix (from CD, or CDELT
    with PC or CROTA2) and SIP terms when present (they are relative to CRPIX, so they move with
    it). None without a celestial TAN solve."""
    n = lambda k: fitsio.number(header, k)  # noqa: E731
    ctype1, ctype2 = header.get("CTYPE1", ""), header.get("CTYPE2", "")
    if not (ctype1.startswith("RA---TAN") and ctype2.startswith("DEC--TAN")):
        return None
    if None in (n("CRVAL1"), n("CRVAL2"), n("CRPIX1"), n("CRPIX2")):
        return None
    if n("CD1_1") is not None and n("CD2_2") is not None:
        cd = [[n("CD1_1"), n("CD1_2") or 0.0], [n("CD2_1") or 0.0, n("CD2_2")]]
    elif n("CDELT1") is not None and n("CDELT2") is not None:
        d1, d2 = n("CDELT1"), n("CDELT2")
        if any(n(k) is not None for k in ("PC1_1", "PC1_2", "PC2_1", "PC2_2")):
            pc = [[n("PC1_1") or 1.0, n("PC1_2") or 0.0], [n("PC2_1") or 0.0, n("PC2_2") or 1.0]]
        else:
            rot = math.radians(n("CROTA2") or 0.0)
            pc = [[math.cos(rot), -math.sin(rot) * d2 / d1], [math.sin(rot) * d1 / d2, math.cos(rot)]]
        cd = [[d1 * pc[0][0], d1 * pc[0][1]], [d2 * pc[1][0], d2 * pc[1][1]]]
    else:
        return None
    if cd[0][0] * cd[1][1] - cd[0][1] * cd[1][0] == 0:
        return None
    wcs: dict = {
        "CTYPE1": ctype1, "CTYPE2": ctype2, "CRVAL1": n("CRVAL1"), "CRVAL2": n("CRVAL2"),
        "CRPIX1": round(n("CRPIX1") - x0, 6), "CRPIX2": round(n("CRPIX2") - y0, 6),
        "CD1_1": cd[0][0], "CD1_2": cd[0][1], "CD2_1": cd[1][0], "CD2_2": cd[1][1],
    }
    sip = {k: (int(n(k)) if k.endswith("ORDER") else n(k)) for k in header if SIP.match(k) and n(k) is not None}
    if "A_ORDER" in sip and "B_ORDER" in sip:
        wcs.update(sorted(sip.items()))
    elif ctype1.endswith("-SIP"):  # SIP named but no terms: plain TAN
        wcs["CTYPE1"], wcs["CTYPE2"] = "RA---TAN", "DEC--TAN"
    return wcs


def pixel_scale(wcs: dict | None) -> float | None:
    """Arcseconds per pixel from the CD matrix."""
    if not wcs:
        return None
    det = abs(wcs["CD1_1"] * wcs["CD2_2"] - wcs["CD1_2"] * wcs["CD2_1"])
    return round(math.sqrt(det) * 3600, 4)


def histogram_stats(planes: np.ndarray, step: int = 2) -> tuple[dict, dict]:
    """256-bin histograms of the linear data per channel (every `step`-th pixel), normalised to the
    data range (the minimum and maximum of all channels → 0…1), and per channel the median and the
    pixel-to-pixel noise (differences of neighbours, MAD × 1.4826 / √2: nebulae and gradients do
    not count) on the same 0…1 scale."""
    sample = [np.asarray(p[::step, ::step], np.float32) for p in planes]
    finite = [s[np.isfinite(s)] for s in sample]
    lo = min(float(f.min()) for f in finite)
    hi = max(float(f.max()) for f in finite)
    span = hi - lo if hi > lo else 1.0
    names = ("r", "g", "b")[: len(planes)]
    histogram: dict = {"bins": 256, "scale": "linear data, 0–1 after normalising to the data range",
                       "min": lo, "max": hi}
    stats: dict = {}
    for name, f, plane in zip(names, finite, planes):
        counts, _ = np.histogram(f, 256, (lo, lo + span))
        histogram[name] = counts.tolist()
        rows = np.asarray(plane[:: 2 * step], np.float32)
        diff = (rows[:, 1:] - rows[:, :-1]).ravel()
        diff = diff[np.isfinite(diff)]
        noise = float(np.median(np.abs(diff - np.median(diff))) * 1.4826 / math.sqrt(2))
        stats[name] = {"median": round((float(np.median(f)) - lo) / span, 7), "noise": round(noise / span, 7)}
    if len(planes) == 1:  # mono: the same for every channel
        for name in ("g", "b"):
            histogram[name], stats[name] = histogram["r"], stats["r"]
    return histogram, stats


def star(planes: np.ndarray, crop: dict, x: float, y: float, scale_arcsec: float | None) -> dict:
    """The star nearest display pixel (`x`, `y`) of a final, measured on the mean of the channels of
    its linear stack `planes` (fitsio.open_float: only the region around the click is read), whose
    crop (`x`, `y`, `width`, `height` in the stack) is the processed image."""
    if not (0 <= x < crop["width"] and 0 <= y < crop["height"]):
        return {"found": False, "linear": True}
    y0, y1, x0, x1 = measure.region_around((crop["height"], crop["width"]), x, y)
    cut = np.asarray(planes[:, crop["y"] + y0 : crop["y"] + y1, crop["x"] + x0 : crop["x"] + x1], np.float32)
    return measure.measure(cut.mean(axis=0), x, y, origin=(x0, y0), saturation=SATURATION,
                           scale_arcsec=scale_arcsec, linear=True)
