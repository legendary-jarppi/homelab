"""Sky brightness in mag/arcsec² per frame, the sensor's read noise and dark current, and the sub
length that makes read noise negligible (R6).

**Photometry.** On the green superpixel plane (the mean of the two green pixels of each 2×2 Bayer
block, as everything else here): the stars of ASTAP's D05 database (Gaia DR3, magnitude Gaia BP, the
database's own header says so) are put into the frame through its plate solve, re-centred on the
nearest peak, measured in a circular aperture with the local sky from an annulus, and give one zero
point each: ZP = BP + 2.5·log10(F), F the star's electrons per second. The frame's zero point is
their clipped median: the magnitude that gives 1 e-/s. A green superpixel's value is the average of
what its four camera pixels would collect if they were all green, so a star's electrons are 4 × the
sum of its superpixel values above the sky, and the sky per camera pixel is the plane's median above
the bias. The sky is then ZP − 2.5·log10(sky e-/s per arcsec²). The band is the camera's green
calibrated against Gaia BP (330–680 nm, close to an SQM's band); stars' colours scatter the single
zero points by ~0.1–0.2 mag, the median takes that out for a typical field.

astap_cli (2026.09.01) has no SQM measurement of its own: its help has no `-sqm` and the binary has
no SQM or MZERO strings (only the GUI program has it), so this is done here.

**Electrons.** The ASIAIR writes the ASI533's 14-bit ADC scaled to 16 bits (every value a multiple of
4) while `EGAIN` is per ADC step: e-/ADU in the file = EGAIN / 4. The step is taken from the pixels
(`adu_step`). A photon transfer on a flat pair (2026-02-14) gave 0.261 e-/ADU against 1.0056 / 4 =
0.251. The bias level (2796 ADU at gain 100, offset 70; not 16 × the offset) and the read noise come
from two archived bias frames, the dark current from a dark of the same night.

**Sub length.** The noise of one pixel in a sub of t seconds: σ² = (S + D)·t + RN² (sky S and dark
current D in e-/s, read noise RN in e-). Read noise adds at most a fraction p to the noise of the sky
and dark alone when σ ≤ (1 + p)·√((S + D)·t), i.e. t ≥ RN² / (((1 + p)² − 1)·(S + D)); with p = 5 %
that is t ≥ 9.76·RN²/(S + D), the usual "10·RN²/S".
"""

from __future__ import annotations

import math
import os
import threading

import numpy as np
from scipy.spatial import cKDTree

import fits

# --- the D05 star database (ASTAP's .1476 files) -------------------------------------------------
# 1476 tiles in 36 declination rings of 180°/35 (the polar caps half as high); in each ring the tiles
# split the RA evenly from 0h. File d05_RRTT.1476: ring RR from the south pole, tile TT. Measured from
# the files' stars (min/max RA and Dec per file).
RING_TILES = (1, 3, 9, 15, 21, 27, 33, 38, 43, 48, 52, 56, 60, 63, 65, 67, 68, 69,
              69, 68, 67, 65, 63, 60, 56, 52, 48, 43, 38, 33, 27, 21, 15, 9, 3, 1)
RING_DEG = 180 / 35
HEADER_BYTES = 110  # a text header ("… Magnitude is BP"), its last byte the record size (5)
# Decoded tiles kept in memory (~15 000 stars, ~360 kB each).
TILE_CACHE = 64

# --- photometry ------------------------------------------------------------------------------------
APERTURE_FWHM = 2.5  # aperture radius in FWHM (plane pixels)
APERTURE_MIN_PX = 3.0
ANNULUS_GAP_PX = 2.0  # from the aperture to the sky annulus
ANNULUS_WIDTH_PX = 4.0
SEARCH_PX = 3  # a catalogue star's peak is looked for this far from where the solve puts it
# A catalogue star with a neighbour (catalogue) less than this much fainter inside its annulus is
# left out (blends).
ISOLATION_MAG = 3.0
SNR_MIN = 20.0  # aperture signal over the sky noise in it
# Plane values at or above this are near the ADC's end (65532): no flux from such stars.
LINEAR_MAX_ADU = 50000
MIN_STARS = 10  # fewer usable catalogue stars: no zero point (clouds, a bad solve)
CLIP_SIGMA = 3.0
FIELD_MARGIN_DEG = 0.05  # catalogue stars are fetched for the field's half diagonal plus this

# --- sensor ----------------------------------------------------------------------------------------
# Hot pixels and cosmic rays are left out of the dark current (beyond this many σ of the bias noise).
DARK_CLIP_SIGMA = 5.0
# The read noise from the difference of two bias frames, in the middle 2/3 of the frame.
SENSOR_CROP = 1 / 6

# --- sub length ------------------------------------------------------------------------------------
READ_NOISE_MAX_ADD = 0.05  # read noise may add 5 % to the noise of the sky (and dark current) alone
# Never longer than this: a sub lost to a gust, a guiding jump, a plane or cloud costs the whole sub
# (12 % of the archive's frames were rejected, two thirds of them for too few stars), and 10 min
# already gives fewer than 10 frames in a 1.5 h window for the stack's outlier rejection.
MAX_SUB_S = 600
MIN_SUB_S = 10
# What the advice rounds up to (the ASIAIR takes any length; these are the usual ones).
SUB_STEPS_S = (10, 15, 20, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 420, 480, 600)


class Catalog:
    """Stars of an ASTAP .1476 database around a position: RA, Dec (degrees) and magnitude."""

    def __init__(self, folder: str, name: str = "d05"):
        self.folder, self.name = folder, name
        self.tiles: dict[tuple[int, int], tuple[np.ndarray, np.ndarray, np.ndarray]] = {}
        self.lock = threading.Lock()

    def available(self) -> bool:
        return os.path.exists(self.path(1, 1))

    def path(self, ring: int, tile: int) -> str:
        return os.path.join(self.folder, f"{self.name}_{ring:02d}{tile:02d}.1476")

    @staticmethod
    def ring_range(ring: int) -> tuple[float, float]:
        low = max(-90.0, -90 + (ring - 1.5) * RING_DEG)
        return low, min(90.0, -90 + (ring - 0.5) * RING_DEG)

    @staticmethod
    def tiles_around(ra: float, dec: float, radius: float) -> list[tuple[int, int]]:
        out = []
        for ring, count in enumerate(RING_TILES, start=1):
            low, high = Catalog.ring_range(ring)
            if high < dec - radius or low > dec + radius:
                continue
            nearest = min(max(dec, low), high)
            cos = math.cos(math.radians(min(89.0, abs(nearest) + radius)))
            half = radius / cos if cos > 0 else 360.0
            if count == 1 or half >= 180:
                out += [(ring, t) for t in range(1, count + 1)]
                continue
            width = 360 / count
            first, last = math.floor((ra - half) / width), math.floor((ra + half) / width)
            out += sorted({(ring, i % count + 1) for i in range(first, last + 1)})
        return out

    @staticmethod
    def decode(data: bytes) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """A tile's records: 5 bytes each, RA as 24 bits (little-endian, full circle / (2²⁴ − 1)) and
        the low 16 bits of Dec (a quarter circle / (2²³ − 1) per unit); a record with RA 0xFFFFFF
        starts a group: its Dec bytes are the group's high Dec byte + 128 and magnitude × 10 + 16."""
        raw = np.frombuffer(data, np.uint8)
        if len(raw) < HEADER_BYTES or raw[HEADER_BYTES - 1] != 5:
            raise ValueError("not a 5-byte .1476 star database tile")
        records = raw[HEADER_BYTES: HEADER_BYTES + (len(raw) - HEADER_BYTES) // 5 * 5].reshape(-1, 5).astype(np.int64)
        head = (records[:, 0] == 255) & (records[:, 1] == 255) & (records[:, 2] == 255)
        group = np.cumsum(head) - 1
        stars = ~head & (group >= 0)
        high = (records[head, 3] - 128)[group[stars]]
        mag = ((records[head, 4] - 16) / 10)[group[stars]]
        r = records[stars]
        ra = (r[:, 0] + (r[:, 1] << 8) + (r[:, 2] << 16)) * (360 / (2**24 - 1))
        dec = ((high << 16) + (r[:, 4] << 8) + r[:, 3]) * (90 / (2**23 - 1))
        return ra, dec, mag

    def _tile(self, ring: int, tile: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        key = (ring, tile)
        with self.lock:
            if key in self.tiles:
                return self.tiles[key]
        with open(self.path(ring, tile), "rb") as f:
            decoded = self.decode(f.read())
        with self.lock:
            if len(self.tiles) >= TILE_CACHE:
                self.tiles.pop(next(iter(self.tiles)))
            self.tiles[key] = decoded
        return decoded

    def around(self, ra: float, dec: float, radius: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        parts = [self._tile(*t) for t in self.tiles_around(ra, dec, radius)]
        if not parts:
            return np.zeros(0), np.zeros(0), np.zeros(0)
        ras, decs, mags = (np.concatenate([p[i] for p in parts]) for i in range(3))
        d0, r0 = math.radians(dec), math.radians(ra)
        cos = (math.sin(d0) * np.sin(np.radians(decs))
               + math.cos(d0) * np.cos(np.radians(decs)) * np.cos(np.radians(ras) - r0))
        near = cos >= math.cos(math.radians(radius))
        return ras[near], decs[near], mags[near]


def adu_step(pixels: np.ndarray) -> int:
    """The ADC's step in the file's units: 4 for a 14-bit ADC written as 16 bits (1, 2, 4, 8 or 16)."""
    sample = pixels[::97, ::89].astype(np.int64).ravel()
    step = int(np.gcd.reduce(sample)) if len(sample) else 1
    return next((s for s in (16, 8, 4, 2) if step and step % s == 0), 1)


def electrons_per_adu(header: dict[str, str], step: int) -> float | None:
    gain = fits.number(header, "EGAIN")
    return gain / step if gain and gain > 0 else None


def zero_point(plane: np.ndarray, plane_wcs: fits.Wcs, exposure_s: float, e_per_adu: float,
               fwhm_px: float | None, ra: np.ndarray, dec: np.ndarray, mag: np.ndarray) -> dict | None:
    """The frame's zero point from catalogue stars (RA, Dec, magnitude) on a superpixel plane (ADU,
    bias included) with its plate solve: { zeroPoint, spread, stars } or None with too few stars."""
    h, w = plane.shape
    x, y = plane_wcs.to_pixel(ra, dec)
    x, y = np.asarray(x) - 1, np.asarray(y) - 1  # FITS pixels are 1-based
    r_ap = max(APERTURE_MIN_PX, APERTURE_FWHM * fwhm_px) if fwhm_px else APERTURE_MIN_PX * 1.5
    r_in, r_out = r_ap + ANNULUS_GAP_PX, r_ap + ANNULUS_GAP_PX + ANNULUS_WIDTH_PX
    half = int(math.ceil(r_out)) + SEARCH_PX + 1
    inside = (x >= half) & (x < w - half - 1) & (y >= half) & (y < h - half - 1)
    if inside.sum() < MIN_STARS:
        return None
    # Blends: a catalogue neighbour inside the annulus that is not much fainter.
    tree = cKDTree(np.column_stack([x, y]))
    isolated = np.ones(len(x), bool)
    for i, j in tree.query_pairs(r_out + SEARCH_PX):
        if mag[j] < mag[i] + ISOLATION_MAG:
            isolated[i] = False
        if mag[i] < mag[j] + ISOLATION_MAG:
            isolated[j] = False
    oy, ox = np.mgrid[-half: half + 1, -half: half + 1]
    gy, gx = np.mgrid[-2:3, -2:3]
    zps = []
    for i in np.nonzero(inside & isolated)[0]:
        xi, yi = int(round(x[i])), int(round(y[i]))
        box = plane[yi - half: yi + half + 1, xi - half: xi + half + 1]
        level = float(np.median(box))
        noise = float(np.median(np.abs(box - level))) * 1.4826 or 1.0
        # The brightest pixel near the predicted position (the solve is linear: SIP and seeing
        # move stars by a pixel or two), then the centroid around it.
        search = box[half - SEARCH_PX: half + SEARCH_PX + 1, half - SEARCH_PX: half + SEARCH_PX + 1]
        py, px = np.unravel_index(int(np.argmax(search)), search.shape)
        cy, cx = py - SEARCH_PX + half, px - SEARCH_PX + half
        if box[cy, cx] - level < 5 * noise:
            continue
        win = np.clip(box[cy - 2: cy + 3, cx - 2: cx + 3] - level, 0, None)
        cx_f = cx + float((win * gx).sum() / win.sum())
        cy_f = cy + float((win * gy).sum() / win.sum())
        r = np.hypot(ox + half - cx_f, oy + half - cy_f)
        ring = box[(r >= r_in) & (r <= r_out)]
        sky = float(np.median(ring))
        sigma = float(np.median(np.abs(ring - sky))) * 1.4826 or 1.0
        aperture = r <= r_ap
        values = box[aperture]
        if values.max() >= LINEAR_MAX_ADU:
            continue
        flux = float((values - sky).sum())
        if flux < SNR_MIN * sigma * math.sqrt(aperture.sum()):
            continue
        electrons_s = 4 * flux * e_per_adu / exposure_s
        zps.append(float(mag[i]) + 2.5 * math.log10(electrons_s))
    if len(zps) < MIN_STARS:
        return None
    zps = np.array(zps)
    keep = np.ones(len(zps), bool)
    for _ in range(3):
        median = float(np.median(zps[keep]))
        spread = float(np.median(np.abs(zps[keep] - median))) * 1.4826
        keep = np.abs(zps - median) <= CLIP_SIGMA * max(spread, 0.02)
    if keep.sum() < MIN_STARS:
        return None
    return {"zeroPoint": float(np.median(zps[keep])), "spread": spread, "stars": int(keep.sum())}


def sky_magnitude(zero_point_mag: float, sky_eps: float, pixel_arcsec: float) -> float | None:
    """mag/arcsec² of a sky of `sky_eps` e-/s per camera pixel of `pixel_arcsec`″."""
    if sky_eps <= 0 or pixel_arcsec <= 0:
        return None
    return zero_point_mag - 2.5 * math.log10(sky_eps / pixel_arcsec**2)


def measure(plane: np.ndarray, header: dict[str, str], plate: fits.Wcs | None, scale: float, step: int,
            sensor: dict | None, catalog: Catalog, fwhm_px: float | None) -> dict:
    """A frame's `sky` record from its green (or mono) plane, header and plate solve (camera pixels;
    `scale` camera pixels per plane pixel): { zeroPoint, skyMag, skyEps, stars, spread }, with an
    `error` when (part of) it cannot be measured; `needs` "sensor" or "solve" when a bias measurement
    or a plate solve may still come."""
    exposure = fits.number(header, "EXPTIME") or fits.number(header, "EXPOSURE")
    e_per_adu = electrons_per_adu(header, step)
    if not exposure or exposure <= 0 or e_per_adu is None:
        return {"error": "no exposure time or EGAIN in the header"}
    if sensor is None:
        return {"error": "no bias frames of this gain and offset in the archive", "needs": "sensor"}
    sky_adu = float(np.median(plane[::4, ::4])) - sensor["biasAdu"]
    sky_eps = sky_adu * e_per_adu / exposure
    record = {"skyEps": round(sky_eps, 5), "zeroPoint": None, "skyMag": None, "stars": 0}
    if plate is None:
        return {**record, "error": "no plate solve", "needs": "solve"}
    pixel_arcsec = plate.pixel_scale_arcsec()
    if not catalog.available():
        return {**record, "error": "no star database"}
    plane_wcs = plate.plane(scale)
    h, w = plane.shape
    centre_ra, centre_dec = plane_wcs.to_sky(np.array([(w + 1) / 2]), np.array([(h + 1) / 2]))
    radius = math.hypot(w, h) / 2 * plane_wcs.pixel_scale_arcsec() / 3600 + FIELD_MARGIN_DEG
    ra, dec, mag = catalog.around(float(centre_ra[0]), float(centre_dec[0]), radius)
    zp = zero_point(plane, plane_wcs, exposure, e_per_adu, fwhm_px, ra, dec, mag)
    if zp is None:
        return {**record, "error": "too few catalogue stars measured"}
    sky_mag = sky_magnitude(zp["zeroPoint"], sky_eps, pixel_arcsec)
    return {**record, "zeroPoint": round(zp["zeroPoint"], 3), "spread": round(zp["spread"], 3), "stars": zp["stars"],
            "skyMag": None if sky_mag is None else round(sky_mag, 2),
            **({} if sky_mag is not None else {"error": "sky at or below the bias level"})}


def clipped_mean(values: np.ndarray, centre: float, sigma: float) -> float:
    return float(values[np.abs(values - centre) <= DARK_CLIP_SIGMA * sigma].mean())


def sensor_noise(bias_a: np.ndarray, bias_b: np.ndarray, header: dict[str, str], dark: np.ndarray | None = None,
                 dark_s: float | None = None) -> dict:
    """Bias level, read noise and (with a dark of `dark_s` seconds) dark current from two bias frames:
    read noise = σ(A − B)/√2 (the bias pattern cancels), σ of the difference clipped at 5σ (hot
    pixels, random telegraph noise); dark current = (clipped mean of the dark − that of the bias)
    × e-/ADU / exposure, never below 0."""
    step = adu_step(bias_a)
    e_per_adu = electrons_per_adu(header, step)
    h, w = bias_a.shape
    y0, y1, x0, x1 = int(h * SENSOR_CROP), int(h * (1 - SENSOR_CROP)), int(w * SENSOR_CROP), int(w * (1 - SENSOR_CROP))
    a, b = bias_a[y0:y1, x0:x1].astype(np.float64), bias_b[y0:y1, x0:x1].astype(np.float64)
    diff = (a - b).ravel()
    sigma = float(np.std(diff))
    for _ in range(3):
        sigma = float(np.std(diff[np.abs(diff - diff.mean()) <= DARK_CLIP_SIGMA * sigma]))
    read_adu = sigma / math.sqrt(2)
    level = float(np.median(a))
    bias_mean = clipped_mean(a.ravel(), level, read_adu)
    out = {
        "gain": fits.number(header, "GAIN"),
        "offset": fits.number(header, "OFFSET"),
        "aduStep": step,
        "ePerAdu": None if e_per_adu is None else round(e_per_adu, 5),
        "biasAdu": round(bias_mean, 2),
        "readNoiseAdu": round(read_adu, 3),
        "readNoiseE": None if e_per_adu is None else round(read_adu * e_per_adu, 3),
        "sensorTempC": fits.number(header, "CCD-TEMP"),
        "darkCurrentEps": None,
    }
    if dark is not None and dark_s and e_per_adu is not None:
        d = dark[y0:y1, x0:x1].astype(np.float64).ravel()
        current = (clipped_mean(d, float(np.median(d)), read_adu * 1.5) - bias_mean) * e_per_adu / dark_s
        out["darkCurrentEps"] = round(max(0.0, current), 5)
    return out


def recommended_sub(read_noise_e: float, sky_eps: float, dark_eps: float = 0.0) -> float | None:
    """Shortest sub (s) at which read noise adds no more than READ_NOISE_MAX_ADD to the noise."""
    rate = sky_eps + (dark_eps or 0.0)
    if rate <= 0 or read_noise_e <= 0:
        return None
    return read_noise_e**2 / (((1 + READ_NOISE_MAX_ADD) ** 2 - 1) * rate)


def read_noise_share(read_noise_e: float, sky_eps: float, dark_eps: float, sub_s: float) -> float:
    """Read noise's fraction of a sub's noise variance."""
    rn2 = read_noise_e**2
    return rn2 / ((sky_eps + (dark_eps or 0.0)) * sub_s + rn2)


def noise_added(read_noise_e: float, sky_eps: float, dark_eps: float, sub_s: float) -> float:
    """How much read noise adds to the noise of the sky and dark current alone (0.05 = 5 %)."""
    shot = (sky_eps + (dark_eps or 0.0)) * sub_s
    return math.sqrt((shot + read_noise_e**2) / shot) - 1 if shot > 0 else math.inf


def advice(read_noise_e: float | None, dark_eps: float | None, sky_eps: float | None,
           current_sub_s: float | None) -> dict | None:
    """The session report's `exposure`: the sub length the measured sky asks for, against the one used."""
    if read_noise_e is None or sky_eps is None or sky_eps <= 0:
        return None
    dark = dark_eps or 0.0
    needed = recommended_sub(read_noise_e, sky_eps, dark)
    if needed is None:
        return None
    rounded = next((s for s in SUB_STEPS_S if s >= needed), MAX_SUB_S)
    recommended = max(MIN_SUB_S, min(MAX_SUB_S, rounded))
    share = read_noise_share(read_noise_e, sky_eps, dark, current_sub_s) if current_sub_s else None
    added = noise_added(read_noise_e, sky_eps, dark, current_sub_s) if current_sub_s else None
    pct = int(READ_NOISE_MAX_ADD * 100)
    sky_text = f"Sky {sky_eps:.3g} e-/s per pixel, read noise {read_noise_e:.2f} e-"
    if needed > MAX_SUB_S:
        reason = (f"{sky_text}: read noise would need {needed / 60:.0f} min subs to stay under {pct} %; "
                  f"{MAX_SUB_S // 60} min is the longest worth risking (a gust, a guiding jump or cloud costs the whole sub)")
    else:
        reason = f"{sky_text}: subs of {recommended:g} s or longer keep read noise under {pct} % of the noise"
    if current_sub_s and added is not None:
        verdict = (f"{current_sub_s:g} s subs add {added * 100:.0f} % (read noise {share * 100:.0f} % of the noise variance)")
        if added <= READ_NOISE_MAX_ADD or current_sub_s >= recommended:
            verdict += ": long enough"
        elif current_sub_s < recommended:
            verdict += f": {recommended:g} s would be better"
        reason += f"; {verdict}"
    return {
        "readNoiseE": round(read_noise_e, 2),
        "darkCurrentEps": None if dark_eps is None else round(dark_eps, 5),
        "skyEps": round(sky_eps, 4),
        "recommendedSubS": recommended,
        "neededSubS": round(needed),
        "currentSubS": current_sub_s,
        "readNoiseShare": None if share is None else round(share, 3),
        "noiseAddedPct": None if added is None else round(added * 100, 1),
        "text": reason + ".",
    }
