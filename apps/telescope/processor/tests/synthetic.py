"""A synthetic ASIAIR archive and telescope-service answers for testing the processor end to end.

    python tests/synthetic.py <archive dir> <sessions.json> [--size 3008]

Writes, in the archive's real layout (`<YYYY>/<night>/<target>/Light_….fit`,
`<YYYY>/<night>/Bias|Dark|Flat/….fit`), 16-bit FITS frames shaped like the ASIAIR Plus with the
ZWO ASI533MC Pro (RGGB, 14-bit ADC scaled to 16 bit, gain 100 = unity, offset 70 → bias ~1120 ADU,
-20 °C) through a 670 mm telescope (1.16″/px), and the sessions JSON (what the fake service in
fake_service.py answers):

- 2026-09-06: 20 bias, 12 flats at camera angle 93° and 12 at 273° (physically the same camera
  orientation: a meridian flip turns the sky angle by 180°, not the camera against the optics);
- 2026-10-17: 12 darks of 300 s; lights of C 9 (Cave Nebula), 300 s: 6 before a meridian flip (93°),
  6 after (273°), one of them through clouds (rejected by the service), one with a satellite trail;
- 2026-10-18: lights of C 9, 180 s (no dark of that exposure: the deliberately missing one) with the
  camera turned by hand to 300° (dust on the optics moves against the sensor), and 12 flats at 300°
  the next morning (the night-1 lights only have the 41-day-old flats).

The sky is real: Gaia DR3 stars to G 16.5 around the Cave Nebula (tests/data/c9-gaia-dr3.csv.gz)
with colours from BP−RP, projected through each frame's TAN plate solve (which the header carries,
as the ASIAIR's does), so Siril's plate solver and photometric colour calibration can work on it.
Added: a synthetic emission nebula (red, fixed on the sky), an orange light-pollution gradient
changing through the night, vignetting, three dust donuts and pixel response non-uniformity
(the flat field), hot pixels and dark current, column pattern, read and shot noise.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np

TZ = ZoneInfo("Europe/Helsinki")
CATALOG = os.path.join(os.path.dirname(__file__), "data", "c9-gaia-dr3.csv.gz")
TARGET = "C 9"
RA0, DEC0 = 344.20, 62.62
FOCAL_MM, PIXEL_UM = 670.0, 3.76
SCALE_DEG = math.degrees(PIXEL_UM * 1e-3 / FOCAL_MM)  # 1.157″ per pixel
GAIN, OFFSET = 100, 70
BIAS_DN = OFFSET * 4  # 14-bit DN; × 4 in the 16-bit FITS → 1120 ADU
READ_NOISE_E = 1.5
QE = np.array([0.80, 1.00, 0.72], np.float32)  # camera response R, G, B (relative)
PANEL = np.array([0.85, 1.00, 1.05], np.float32)  # the flat panel's colour
SKY_E_S = 1.4  # sky background, e-/s/px in green
LIGHT_POLLUTION = np.array([1.35, 1.0, 0.55], np.float32)
STAR_ZERO = 2000.0  # e-/s for a G = 10 star (green, the whole PSF)


def channel_map(size: int) -> np.ndarray:
    """RGGB: 0 = R, 1 = G, 2 = B for every pixel (row 0 is the file's first row)."""
    ch = np.empty((size, size), np.int8)
    ch[0::2, 0::2], ch[0::2, 1::2], ch[1::2, 0::2], ch[1::2, 1::2] = 0, 1, 1, 2
    return ch


def planck_rgb(bp_rp: np.ndarray) -> np.ndarray:
    """Relative R, G, B flux of stars by colour, the Sun (BP−RP 0.82) white."""
    bv = 0.15 + 0.78 * np.clip(bp_rp, -0.4, 4.0) - 0.08 * np.clip(bp_rp, -0.4, 4.0) ** 2  # rough B−V
    teff = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))

    def band(t, lo, hi):
        lam = np.linspace(lo, hi, 12)[None, :] * 1e-9
        return (1 / lam**5 / (np.exp(0.014388 / (lam * t[:, None])) - 1)).sum(axis=1)

    rgb = np.stack([band(teff, 600, 680), band(teff, 500, 580), band(teff, 420, 500)], axis=1)
    sun = np.stack([band(np.array([5772.0]), 600, 680), band(np.array([5772.0]), 500, 580),
                    band(np.array([5772.0]), 420, 500)], axis=1)
    rgb = rgb / sun
    return (rgb / rgb[:, 1:2]).astype(np.float32)


def load_stars() -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    with gzip.open(CATALOG, "rt") as f:
        rows = list(csv.DictReader(f))
    ra = np.array([float(r["ra"]) for r in rows])
    dec = np.array([float(r["dec"]) for r in rows])
    g = np.array([float(r["g"]) for r in rows])
    colour = planck_rgb(np.array([float(r["bp_rp"]) for r in rows]))
    return ra, dec, g, colour


def tangent(ra: np.ndarray, dec: np.ndarray, ra0: float, dec0: float) -> tuple[np.ndarray, np.ndarray]:
    """Gnomonic projection (degrees on the tangent plane)."""
    a, d, a0, d0 = map(np.radians, (ra, dec, ra0, dec0))
    cos_c = np.sin(d0) * np.sin(d) + np.cos(d0) * np.cos(d) * np.cos(a - a0)
    xi = np.cos(d) * np.sin(a - a0) / cos_c
    eta = (np.cos(d0) * np.sin(d) - np.sin(d0) * np.cos(d) * np.cos(a - a0)) / cos_c
    return np.degrees(xi), np.degrees(eta)


def cd_matrix(angle_deg: float) -> np.ndarray:
    """CD for a camera angle (east left, north up at 0°, turning with the angle)."""
    t = math.radians(angle_deg)
    return SCALE_DEG * np.array([[-math.cos(t), math.sin(t)], [math.sin(t), math.cos(t)]])


class Optics:
    """The flat field: vignetting and dust (fixed in the optics) seen by a sensor turned by `turn`
    degrees against them, and the sensor's own pixel response."""

    def __init__(self, size: int, rng: np.random.Generator):
        self.size = size
        self.prnu = (1 + rng.normal(0, 0.006, (size, size))).astype(np.float32)
        s = size / 3008
        # Dust on the field flattener: (x, y) from the optical centre in px, outer radius, depth.
        self.dust = [(-610 * s, 420 * s, 62 * s, 0.11), (380 * s, -720 * s, 45 * s, 0.08),
                     (930 * s, 640 * s, 75 * s, 0.07)]
        self.cache: dict[float, np.ndarray] = {}

    def response(self, turn: float) -> np.ndarray:
        if turn in self.cache:
            return self.cache[turn]
        n = self.size
        y, x = np.mgrid[0:n, 0:n].astype(np.float32)
        x -= (n - 1) / 2
        y -= (n - 1) / 2
        r2 = (x * x + y * y) / ((n / 2) ** 2 * 2)
        out = (1 - 0.38 * r2 - 0.10 * r2 * r2).astype(np.float32)
        c, s = math.cos(math.radians(turn)), math.sin(math.radians(turn))
        for dx, dy, radius, depth in self.dust:
            # The optics' dust point in this sensor's coordinates.
            px, py = c * dx - s * dy, s * dx + c * dy
            r = np.hypot(x - px, y - py) / radius
            ring = np.clip(1 - np.abs(r - 0.68) / 0.32, 0, 1) ** 0.7  # donut: dark ring, lighter centre
            disc = np.clip(1 - r, 0, 1) > 0
            out *= 1 - depth * ring - 0.3 * depth * disc
        out *= self.prnu
        self.cache[turn] = out
        return out


class Camera:
    def __init__(self, size: int, seed: int = 533):
        self.size = size
        self.rng = np.random.default_rng(seed)
        self.ch = channel_map(size)
        self.qe = QE[self.ch]
        self.optics = Optics(size, self.rng)
        self.columns = self.rng.normal(0, 0.5, size).astype(np.float32)  # DN, fixed pattern
        hot = self.rng.choice(size * size, size * size // 2000, replace=False)
        self.hot = (hot // size, hot % size)
        self.hot_rate = self.rng.lognormal(math.log(0.15), 1.0, hot.size).astype(np.float32)  # e-/s at -20 °C

    def dark_current(self, temp: float) -> np.ndarray:
        factor = 2 ** ((temp + 20) / 6.3)
        rate = np.full((self.size, self.size), 0.0006 * factor, np.float32)
        rate[self.hot] += self.hot_rate * factor
        return rate

    def read(self, electrons: np.ndarray) -> np.ndarray:
        """Shot noise, read noise, bias, 14-bit ADC, 16-bit FITS values."""
        e = self.rng.poisson(np.clip(electrons, 0, None)).astype(np.float32)
        e += self.rng.normal(0, READ_NOISE_E, e.shape).astype(np.float32)
        dn = np.rint(e + BIAS_DN + self.columns[None, :])
        return (np.clip(dn, 0, 16383) * 4).astype(np.uint16)


def nebula(xi: np.ndarray, eta: np.ndarray) -> np.ndarray:
    """Emission (e-/s/px in R, G, B before the camera's response): an arc of Hα with a dark lane,
    in tangent-plane degrees, so it stays on the sky."""
    def blob(x0, y0, sx, sy, angle, amp):
        c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
        u, v = c * (xi - x0) + s * (eta - y0), -s * (xi - x0) + c * (eta - y0)
        return amp * np.exp(-0.5 * ((u / sx) ** 2 + (v / sy) ** 2))

    ha = (blob(0.02, 0.05, 0.22, 0.06, 35, 0.9) + blob(-0.12, -0.08, 0.10, 0.12, 0, 0.6)
          + blob(0.15, 0.17, 0.08, 0.05, -20, 0.5) + blob(0.0, 0.0, 0.35, 0.30, 0, 0.18))
    ha *= 1 - 0.7 * np.exp(-0.5 * ((eta + 0.6 * xi - 0.02) / 0.012) ** 2)  # dark lane
    return np.stack([ha, 0.12 * ha, 0.22 * ha])


def write_fits(path: str, data: np.ndarray, cards: list[tuple[str, object, str]], mtime: float) -> None:
    lines = [("SIMPLE", True, "file does conform to FITS standard"), ("BITPIX", 16, "number of bits per data pixel"),
             ("NAXIS", 2, "number of data axes"), ("NAXIS1", data.shape[1], "length of data axis 1"),
             ("NAXIS2", data.shape[0], "length of data axis 2"),
             ("EXTEND", True, "FITS dataset may contain extensions"),
             ("BZERO", 32768, "offset data range to that of unsigned short"), ("BSCALE", 1, "default scaling factor")]
    lines += cards
    text = ""
    for key, value, comment in lines:
        if isinstance(value, bool):
            v = f"{'T' if value else 'F':>20}"
        elif isinstance(value, (int, float)):
            v = f"{value:>20}"
        else:
            v = f"{chr(39) + str(value) + chr(39):<20}"
        text += f"{key:<8}= {v} / {comment}"[:80].ljust(80)
    text += "END".ljust(80)
    text += " " * (-len(text) % 2880)
    body = (data.astype(np.int32) - 32768).astype(">i2").tobytes()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(text.encode("ascii"))
        f.write(body)
        f.write(b"\0" * (-len(body) % 2880))
    os.utime(path, (mtime, mtime))


def common_cards(kind: str, exposure: float, start: datetime, temp: float, angle: float | None) -> list:
    cards = [
        ("IMAGETYP", kind, "Type of exposure"),
        ("EXPOSURE", round(exposure, 6), "Exposure time in seconds"),
        ("EXPTIME", round(exposure, 6), "Exposure time in seconds"),
        ("DATE-OBS", start.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3], "Exposure start time (UTC)"),
        ("XPIXSZ", PIXEL_UM, "X pixel size microns"), ("YPIXSZ", PIXEL_UM, "Y pixel size microns"),
        ("XBINNING", 1, "Camera binning mode"), ("YBINNING", 1, "Camera binning mode"),
        ("CCD-TEMP", round(temp, 1), "Sensor temperature in C"), ("SET-TEMP", -20.0, "Cooler set point in C"),
        ("INSTRUME", "ZWO ASI533MC Pro", "Camera model"), ("BAYERPAT", "RGGB", "Bayer pattern"),
        ("XBAYROFF", 0, "X offset of Bayer array"), ("YBAYROFF", 0, "Y offset of Bayer array"),
        ("GAIN", GAIN, "Camera gain"), ("OFFSET", OFFSET, "Camera offset"),
        ("FOCALLEN", FOCAL_MM, "Focal length in mm"), ("FOCUSPOS", 5321, "Focuser position"),
        ("SITELAT", 61.496, "Site latitude"), ("SITELONG", 27.5761, "Site longitude"),
    ]
    if angle is not None:
        cards.append(("ROTATOR", round(angle % 360, 2), "Camera angle"))
    return cards


def name_time(t: datetime) -> str:
    return t.astimezone(TZ).strftime("%Y%m%d-%H%M%S")


def calibration(cam: Camera, root: str, night: str, kind: str, n: int, start: datetime, exposure: float,
                angle: float | None, turn: float = 0.0, temp: float = -20.0) -> list[str]:
    folder = os.path.join(root, night[:4], night, kind)
    files = []
    dark = cam.dark_current(temp)
    flat = cam.optics.response(turn) * cam.qe * PANEL[cam.ch] if kind == "Flat" else None
    for i in range(n):
        t = start + timedelta(seconds=i * (exposure + 2))
        jitter = temp + float(cam.rng.normal(0, 0.08))
        electrons = dark * exposure
        if flat is not None:
            electrons = electrons + flat * (6800 / exposure) * exposure * float(1 + cam.rng.normal(0, 0.002))
        data = cam.read(electrons)
        exp_text = f"{exposure * 1000:.1f}ms" if exposure < 10 else f"{exposure:.1f}s"
        angle_text = f"{round(angle) % 360}deg_" if angle is not None else ""
        name = f"{kind}_{angle_text}{exp_text}_Bin1_{name_time(t)}_{i + 1:04d}.fit"
        path = os.path.join(folder, name)
        write_fits(path, data, common_cards(kind, exposure, t, jitter, angle), (t + timedelta(seconds=exposure + 1)).timestamp())
        files.append(os.path.relpath(path, root))
    print(f"{night} {kind}: {n} × {exposure:g} s", file=sys.stderr)
    return files


def lights(cam: Camera, root: str, night: str, plan: list[dict], stars) -> list[dict]:
    ra, dec, g, colour = stars
    n = cam.size
    folder = os.path.join(root, night[:4], night, TARGET)
    out = []
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    for i, p in enumerate(plan):
        t, exposure, angle = p["start"], p["exposure"], p["angle"]
        ra_c, dec_c = p["center"]
        cd = cd_matrix(angle)
        inv = np.linalg.inv(cd)
        crpix = ((n + 1) / 2, (n + 1) / 2)
        xi, eta = tangent(ra, dec, ra_c, dec_c)
        px = inv[0, 0] * xi + inv[0, 1] * eta + crpix[0] - 1  # 0-based column
        py = inv[1, 0] * xi + inv[1, 1] * eta + crpix[1] - 1  # 0-based row
        inside = (px > -20) & (px < n + 20) & (py > -20) & (py < n + 20)
        # Sky per pixel: tangent-plane coordinates of every pixel (linear WCS), nebula, gradient.
        dx, dy = xx - (crpix[0] - 1), yy - (crpix[1] - 1)
        pxi, peta = cd[0, 0] * dx + cd[0, 1] * dy, cd[1, 0] * dx + cd[1, 1] * dy
        # Nebula centre: the target position, on the sky.
        oxi, oeta = tangent(np.array([RA0]), np.array([DEC0]), ra_c, dec_c)
        neb = nebula(pxi - oxi[0], peta - oeta[0])
        ch = cam.ch
        sky_rate = np.choose(ch, neb).astype(np.float32)
        phi = math.radians(p["gradientDeg"])
        grad = 1 + 0.3 * ((xx - n / 2) * math.cos(phi) + (yy - n / 2) * math.sin(phi)) / n
        sky_rate += SKY_E_S * p["sky"] * LIGHT_POLLUTION[ch] * grad
        signal = sky_rate * exposure
        # Stars: Gaussian core plus a faint wide wing, flux into each pixel's colour channel.
        sigma = p["fwhm"] / 2.3548
        flux = STAR_ZERO * 10 ** (-0.4 * (g - 10)) * exposure * p["transparency"]
        for k in np.flatnonzero(inside):
            f = flux[k]
            half = int(min(40, max(5, 3 * sigma + 2.2 * math.log10(max(f, 10)))))
            x0, y0 = int(round(px[k])), int(round(py[k]))
            r0, r1, c0, c1 = max(0, y0 - half), min(n, y0 + half + 1), max(0, x0 - half), min(n, x0 + half + 1)
            if r0 >= r1 or c0 >= c1:
                continue
            gy, gx = yy[r0:r1, c0:c1] - py[k], xx[r0:r1, c0:c1] - px[k]
            r2 = gx * gx + gy * gy
            psf = 0.92 * np.exp(-0.5 * r2 / sigma**2) / (2 * math.pi * sigma**2)
            psf += 0.08 * np.exp(-0.5 * r2 / (3 * sigma) ** 2) / (2 * math.pi * (3 * sigma) ** 2)
            signal[r0:r1, c0:c1] += f * psf * colour[k][ch[r0:r1, c0:c1]]
        if p.get("satellite"):
            # A satellite crossing: a bright line through the frame.
            dist = np.abs((yy - 0.3 * n) * 0.94 - (xx - 0.1 * n) * 0.34)
            signal += 900 * np.exp(-0.5 * (dist / 1.2) ** 2)
        electrons = signal * cam.optics.response(p["turn"]) * cam.qe + cam.dark_current(-20) * exposure
        data = cam.read(electrons)
        number = p["number"]
        name = f"Light_{TARGET}_{exposure:.1f}s_Bin1_{name_time(t)}_{round(angle) % 360}deg_{number:04d}.fit"
        path = os.path.join(folder, name)
        cards = common_cards("Light", exposure, t, -20 + float(cam.rng.normal(0, 0.08)), angle)
        cards += [
            ("OBJECT", TARGET, "Target"), ("RA", round(ra_c, 6), "Target right ascension (deg)"),
            ("DEC", round(dec_c, 6), "Target declination (deg)"), ("EQUINOX", 2000.0, "Equinox"),
            ("CTYPE1", "RA---TAN-SIP", ""), ("CTYPE2", "DEC--TAN-SIP", ""),
            ("CRVAL1", round(ra_c, 8), ""), ("CRVAL2", round(dec_c, 8), ""),
            ("CRPIX1", crpix[0], ""), ("CRPIX2", crpix[1], ""),
            ("CD1_1", float(f"{cd[0, 0]:.10e}"), ""), ("CD1_2", float(f"{cd[0, 1]:.10e}"), ""),
            ("CD2_1", float(f"{cd[1, 0]:.10e}"), ""), ("CD2_2", float(f"{cd[1, 1]:.10e}"), ""),
            ("A_ORDER", 2, ""), ("A_0_2", 0.0, ""), ("A_1_1", 0.0, ""), ("A_2_0", 0.0, ""),
            ("B_ORDER", 2, ""), ("B_0_2", 0.0, ""), ("B_1_1", 0.0, ""), ("B_2_0", 0.0, ""),
        ]
        write_fits(path, data, cards, (t + timedelta(seconds=exposure + 1)).timestamp())
        out.append({**p, "rel": os.path.relpath(path, root), "name": name})
        print(f"{night} light {number}: {exposure:g} s, {angle:g}°{' clouds' if p['transparency'] < 0.5 else ''}"
              f"{' satellite' if p.get('satellite') else ''}", file=sys.stderr)
    return out


def local(night: str, hhmm: str, next_day: bool = False) -> datetime:
    d = datetime.fromisoformat(f"{night}T{hhmm}:00").replace(tzinfo=TZ)
    return d + timedelta(days=1) if next_day else d


def plan(rng: np.random.Generator) -> tuple[list[dict], list[dict]]:
    def dither():
        return rng.normal(0, 12) * SCALE_DEG, rng.normal(0, 12) * SCALE_DEG

    night1, night2 = [], []
    t = local("2026-10-17", "20:34")
    for i in range(12):
        flipped = i >= 6
        dra, ddec = dither()
        night1.append({
            "number": i + 1, "start": t, "exposure": 300.0,
            "angle": (93.0 if not flipped else 273.0) + float(rng.normal(0, 0.05)),
            "center": (RA0 + (0.012 if flipped else 0.0) + dra / math.cos(math.radians(DEC0)),
                       DEC0 + (-0.008 if flipped else 0.0) + ddec),
            "turn": 0.0, "fwhm": 2.6 + float(rng.normal(0, 0.1)), "sky": 1.0 + 0.04 * i,
            "gradientDeg": 30 + 4 * i, "transparency": 0.28 if i == 9 else 1.0, "satellite": i == 4,
        })
        t += timedelta(seconds=300 + 8 + (1500 if i == 5 else 0))  # the flip (with refocusing) after frame 6
    t = local("2026-10-18", "21:05")
    for i in range(10):
        dra, ddec = dither()
        night2.append({
            "number": i + 1, "start": t, "exposure": 180.0, "angle": 300.0 + float(rng.normal(0, 0.05)),
            "center": (RA0 - 0.02 + dra / math.cos(math.radians(DEC0)), DEC0 + 0.015 + ddec),
            "turn": 27.0, "fwhm": 2.9 + float(rng.normal(0, 0.1)), "sky": 0.9 + 0.03 * i,
            "gradientDeg": 200 + 3 * i, "transparency": 1.0, "satellite": False,
        })
        t += timedelta(seconds=180 + 8)
    return night1, night2


def session_json(night: str, frames: list[dict]) -> dict:
    first = frames[0]["start"]
    sid = f"{first.astimezone(TZ).strftime('%Y%m%d-%H%M')}-c-9"
    out = []
    for f in frames:
        clouds = f["transparency"] < 0.5
        out.append({
            "id": hashlib.sha1(f["name"].encode()).hexdigest()[:16], "number": f["number"], "at": f["start"].timestamp(),
            "exposureS": f["exposure"], "backgroundAdu": 2700 if not clouds else 4100, "stars": 900 if not clouds else 240,
            "hfr": round(f["fwhm"] / 1.2, 2), "fwhmPx": round(f["fwhm"], 2), "elongation": 0.08, "guidingRmsArcsec": 0.7,
            "accepted": not clouds, "rejectReason": "stars 27 % of session median: clouds" if clouds else None,
            "manual": False, "aligned": True, "sensorTempC": -20.0, "archivePath": f["rel"],
            "rotatorDeg": round(f["angle"] % 360, 2),
        })
    accepted = [f for f in out if f["accepted"]]
    return {
        "id": sid, "night": night, "target": TARGET, "mode": "autorun",
        "firstFrameAt": first.timestamp(), "lastFrameAt": frames[-1]["start"].timestamp() + frames[-1]["exposure"],
        "frames": len(out), "accepted": len(accepted), "rejected": len(out) - len(accepted),
        "integrationS": round(sum(f["exposureS"] for f in accepted)), "active": False, "hasStack": True,
        "ra": RA0, "dec": DEC0, "exposureS": frames[0]["exposure"], "gain": GAIN, "camera": "ZWO ASI533MC Pro",
        "focalLengthMm": FOCAL_MM, "site": {"lat": 61.496, "lon": 27.5761}, "pending": 0,
        "detail_frames": out,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("root")
    parser.add_argument("sessions", help="where to write the fake service's sessions (JSON)")
    parser.add_argument("--size", type=int, default=3008)
    args = parser.parse_args()
    cam = Camera(args.size)
    stars = load_stars()
    calibration(cam, args.root, "2026-09-06", "Bias", 20, local("2026-09-06", "23:10"), 0.001, 93.0)
    calibration(cam, args.root, "2026-09-06", "Flat", 12, local("2026-09-06", "06:20", True), 1.25, 93.0)
    calibration(cam, args.root, "2026-09-06", "Flat", 12, local("2026-09-06", "06:25", True), 1.25, 273.0)
    calibration(cam, args.root, "2026-10-17", "Dark", 12, local("2026-10-17", "17:05"), 300.0, None)
    night1, night2 = plan(cam.rng)
    n1 = lights(cam, args.root, "2026-10-17", night1, stars)
    n2 = lights(cam, args.root, "2026-10-18", night2, stars)
    calibration(cam, args.root, "2026-10-18", "Flat", 12, local("2026-10-18", "07:40", True), 1.25, 300.0, turn=27.0)
    sessions = [session_json("2026-10-18", n2), session_json("2026-10-17", n1)]
    with open(args.sessions, "w") as f:
        json.dump(sessions, f, indent=1)


if __name__ == "__main__":
    main()
