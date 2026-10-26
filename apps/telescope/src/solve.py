"""Own plate solving with ASTAP (astap_cli and its D05 star database, /opt/astap in the image) for
light frames whose header has no plate solve (Live stacking) and for uploads without one.

ASTAP runs as a child process at low priority (nice 10) in a scratch folder on the cache volume. Its
.ini says whether it solved; its .wcs (a FITS header with -wcs) holds the solution: TAN, and SIP
with -sip (ASTAP's SIP polynomials also carry the constant and linear terms A_0_0, A_1_0, A_0_1).
The solution refers to the pixels of the file it was given, FITS-style: 1-based, data row 1 first.
A hint (RA/Dec) is searched within HINT_RADIUS_DEG first, then the whole sky from there.
"""

from __future__ import annotations

import math
import os
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass

import numpy as np

import fits

ASTAP = os.environ.get("ASTAP", "/opt/astap/astap_cli")
DATABASE = os.environ.get("ASTAP_DATABASE", "/opt/astap")
NICE = 10
# Measured on ASI533MC frames with D05: a hinted solve 0.15–0.2 s, a hinted search that fails ~2.4 s,
# the whole sky from the far side ~31 s.
HINT_RADIUS_DEG = 30
BLIND_RADIUS_DEG = 180
# Frames with fewer detected stars than this are not tried (clouds, darks).
MIN_STARS = 15
HINT_TIMEOUT_S = 30  # the search around the header's position while a frame is analysed
FRAME_TIMEOUT_S = 120  # a frame's whole-sky search in the background
UPLOAD_TIMEOUT_S = 600  # an upload: unknown scale, so ASTAP tries field heights 10° … 0.3°
# Uploads are binned (block mean of the channels' mean) to at most this many pixels on their longer
# side before solving (ASTAP solves best at ~1000–3000 px image height).
UPLOAD_MAX_SIDE = 3000
# ASTAP's exit codes (also its .ini ERROR).
ERRORS = {1: "no solution", 2: "not enough stars detected", 16: "image unreadable", 32: "no star database found",
          33: "star database unreadable", 34: "could not write the solution"}
SIP_TERM = re.compile(r"^(A|B|AP|BP)_(\d)_(\d)$")


class SolveError(Exception):
    def __init__(self, message: str, seconds: float):
        super().__init__(message)
        self.seconds = seconds


@dataclass
class Solution:
    cards: dict  # FITS keywords (TAN or TAN-SIP) for the given file's pixels
    seconds: float
    blind: bool


def available() -> bool:
    return os.access(ASTAP, os.X_OK) and os.path.isdir(DATABASE)


def parse_ini(text: str) -> dict[str, str]:
    """ASTAP's .ini: KEY=value lines (values may have a `//` comment)."""
    out = {}
    for line in text.splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip():
            out[key.strip()] = value.split("//", 1)[0].strip()
    return out


def cards_from_header(header: dict[str, str]) -> dict | None:
    """The solution in ASTAP's .wcs header as Contract 1's `wcs` keywords (CD matrix, SIP passed on)."""
    if header.get("PLTSOLVD", "T") != "T":
        return None
    return fits.wcs_cards(header)


def rescale(cards: dict, k: int) -> dict:
    """A solution of a k×k block-binned image for the full-size image: binned FITS pixel u covers full
    pixels k·(u − 1) + 1 … k·u, so full x = k·(u − 1) + (k + 1)/2; CD / k; SIP terms (offsets from
    CRPIX in pixels in, pixels out) A_p_q · k^(1 − p − q)."""
    if k == 1:
        return dict(cards)
    out = {}
    for key, value in cards.items():
        if key in ("CRPIX1", "CRPIX2"):
            out[key] = k * (value - 1) + (k + 1) / 2
        elif key in ("CD1_1", "CD1_2", "CD2_1", "CD2_2"):
            out[key] = value / k
        elif m := SIP_TERM.match(key):
            out[key] = value * float(k) ** (1 - int(m[2]) - int(m[3]))
        else:
            out[key] = value
    return out


def frame_hints(header: dict[str, str]) -> tuple[float | None, float | None, float]:
    """RA, Dec (degrees) and field height (degrees, 0 = unknown) from an ASIAIR header."""
    ra = fits.number(header, "RA")
    if ra is None:
        ra = fits.angle(header.get("OBJCTRA"), hours=True)
    dec = fits.number(header, "DEC")
    if dec is None:
        dec = fits.angle(header.get("OBJCTDEC"))
    height, pixel, focal = (fits.number(header, k) for k in ("NAXIS2", "XPIXSZ", "FOCALLEN"))
    fov = math.degrees(height * pixel * 1e-3 / focal) if height and pixel and focal else 0.0
    return ra, dec, fov


def write_luminance(pixels: np.ndarray, path: str, full_scale: float, max_side: int = UPLOAD_MAX_SIDE,
                    band_rows: int = 512) -> int:
    """A mono float FITS for ASTAP from (height, width[, 3]) pixels: the channels' mean, block-binned
    by the smallest integer k that brings the longer side to max_side or less, scaled to 0–65535.
    Rows stay in order (array row 0 = FITS row 1), so the solution is in the upload's own convention
    after rescale(cards, k). Returns k."""
    height, width = pixels.shape[:2]
    k = max(1, math.ceil(max(height, width) / max_side))
    rows, cols = height // k, width // k
    out = np.empty((rows, cols), np.float32)
    step = k * max(1, band_rows // k)
    gain = np.float32(65535 / full_scale) if full_scale else np.float32(1)
    for y0 in range(0, rows * k, step):
        y1 = min(y0 + step, rows * k)
        band = np.asarray(pixels[y0:y1, : cols * k], dtype=np.float32)
        if band.ndim == 3:
            band = band.mean(axis=2)
        band = np.nan_to_num(band, nan=0.0) * gain
        out[y0 // k : y1 // k] = band.reshape((y1 - y0) // k, k, cols, k).mean(axis=(1, 3))
    fits.write_float(path, out, {})
    return k


def _run(path: str, base: str, ra: float | None, dec: float | None, fov: float, radius: float,
         timeout: float) -> tuple[dict | None, str]:
    command = ["nice", "-n", str(NICE), ASTAP, "-f", path, "-d", DATABASE, "-o", base, "-wcs", "-sip",
               "-z", "0", "-r", f"{radius:g}", "-fov", f"{fov:.4f}"]
    if ra is not None and dec is not None:
        command += ["-ra", f"{(ra % 360) / 15:.6f}", "-spd", f"{dec + 90:.6f}"]
    try:
        done = subprocess.run(command, capture_output=True, text=True, timeout=max(1.0, timeout))
    except subprocess.TimeoutExpired:
        return None, f"ASTAP timed out after {timeout:.0f} s"
    try:
        with open(base + ".ini") as f:
            ini = parse_ini(f.read())
    except OSError:
        ini = {}
    if ini.get("PLTSOLVD") == "T":
        with open(base + ".wcs", "rb") as f:
            header, _ = fits.parse_header(f.read())
        cards = cards_from_header(header)
        if cards:
            return cards, ""
    message = ini.get("ERROR") or ERRORS.get(done.returncode) or f"ASTAP exit code {done.returncode}"
    return None, message


def solve(path: str, scratch: str, ra: float | None = None, dec: float | None = None, fov: float = 0.0,
          timeout: float = FRAME_TIMEOUT_S, blind: bool = True) -> Solution:
    """Plate solve a FITS/JPEG/PNG/TIFF file: around (ra, dec) first if given, then (if `blind`) the
    whole sky. `fov` is the image height in degrees (0: ASTAP tries 10° … 0.3°). SolveError when it
    does not solve."""
    started = time.time()
    attempts = ([(HINT_RADIUS_DEG, False)] if ra is not None and dec is not None else []) + \
        ([(BLIND_RADIUS_DEG, True)] if blind else [])
    if not attempts:
        raise SolveError("no position to search around", 0.0)
    os.makedirs(scratch, exist_ok=True)
    work = tempfile.mkdtemp(dir=scratch)
    # No dots in the output name: ASTAP cuts its -o path at the last one.
    base = os.path.join(work, "solve")
    errors = []
    try:
        for radius, whole_sky in attempts:
            remaining = timeout - (time.time() - started)
            if remaining <= 1:
                errors.append("out of time")
                break
            cards, error = _run(path, base, ra, dec, fov, radius, remaining)
            if cards:
                return Solution(cards, time.time() - started, whole_sky)
            errors.append(f"{'whole sky' if whole_sky else f'within {radius}°'}: {error}")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    raise SolveError("; ".join(errors), time.time() - started)
