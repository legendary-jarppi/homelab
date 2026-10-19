"""ASIAIR FITS frames: header, preview JPEGs, sky-quality numbers, plate solve; float FITS output.

ASIAIR writes plain 16-bit FITS (BITPIX 16, BZERO 32768), one image HDU, rows in the same order the
ASIAIR app shows them (checked against its own thumbnails). Colour cameras carry BAYERPAT; their
preview is a 2×2 superpixel debayer (half size: 3008² → 1504² for the ASI533MC), mono frames are
binned 2×2 the same way when wider than 2000 px.
"""

from __future__ import annotations

import io
import math
import os
import re
from dataclasses import dataclass

import numpy as np
from PIL import Image

BLOCK = 2880
CARD = 80


class IncompleteFrame(Exception):
    """The file is shorter than its header says: still being written."""


def parse_header(raw: bytes) -> tuple[dict[str, str], int]:
    """Header keywords (string values unquoted) and the data offset."""
    header: dict[str, str] = {}
    offset = 0
    while offset + BLOCK <= len(raw):
        block = raw[offset : offset + BLOCK]
        offset += BLOCK
        for i in range(0, BLOCK, CARD):
            card = block[i : i + CARD].decode("ascii", "replace")
            key = card[:8].strip()
            if key == "END":
                return header, offset
            if card[8:10] != "= ":
                continue
            value = card[10:].strip()
            if value.startswith("'"):
                header[key] = value[1:].split("'", 1)[0].strip()
            else:
                header[key] = value.split("/", 1)[0].strip()
    raise IncompleteFrame("no END card")


def number(header: dict[str, str], key: str) -> float | None:
    try:
        return float(header[key])
    except (KeyError, ValueError):
        return None


def read_pixels(raw: bytes, header: dict[str, str], offset: int) -> np.ndarray:
    if header.get("BITPIX") != "16" or header.get("NAXIS") != "2":
        raise ValueError(f"unsupported FITS: BITPIX {header.get('BITPIX')}, NAXIS {header.get('NAXIS')}")
    width, height = int(header["NAXIS1"]), int(header["NAXIS2"])
    if len(raw) < offset + width * height * 2:
        raise IncompleteFrame(f"{len(raw)} bytes, {offset + width * height * 2} expected")
    data = np.frombuffer(raw, ">i2", count=width * height, offset=offset).reshape(height, width)
    zero = number(header, "BZERO") or 0.0
    return data.astype(np.float32) + np.float32(zero)


@dataclass
class Rendered:
    large: bytes
    small: bytes
    width: int
    height: int
    background_adu: float
    stars: int
    hfr: float | None
    # The half-size colour planes (R, G, B; or one mono plane) for analysis and stacking, and how
    # many camera pixels one plane pixel spans.
    planes: list[np.ndarray]
    scale: float


def _channels(pixels: np.ndarray, bayer: str) -> list[np.ndarray]:
    """Half-size colour planes (R, G, B) from a Bayer mosaic, or one binned mono plane."""
    h, w = pixels.shape
    pixels = pixels[: h - h % 2, : w - w % 2]
    quads = {
        (0, 0): pixels[0::2, 0::2],
        (0, 1): pixels[0::2, 1::2],
        (1, 0): pixels[1::2, 0::2],
        (1, 1): pixels[1::2, 1::2],
    }
    if len(bayer) == 4 and set(bayer) <= set("RGB"):
        at = {(0, 0): bayer[0], (0, 1): bayer[1], (1, 0): bayer[2], (1, 1): bayer[3]}
        red = next(q for p, q in quads.items() if at[p] == "R")
        blue = next(q for p, q in quads.items() if at[p] == "B")
        greens = [q for p, q in quads.items() if at[p] == "G"]
        return [red, (greens[0] + greens[1]) / 2, blue]
    if w > 2000:
        return [sum(quads.values()) / 4]
    return [pixels]


def stretch_params(sample: np.ndarray, target: float = 0.2) -> tuple[float, float, float | None]:
    """Screen stretch like PixInsight's STF: black point just below the background, then a midtones
    curve that puts the background at `target`. Per channel, which also neutralises the colour cast
    of light pollution. (black, top, midtones balance or None for a plain linear map), from a sample
    of the plane's pixels."""
    median = float(np.median(sample))
    mad = float(np.median(np.abs(sample - median))) * 1.4826
    black = max(0.0, median - 2.8 * mad)
    top = max(float(np.percentile(sample, 99.995)), median + 1.0)
    m0 = (median - black) / (top - black)
    if m0 <= 0 or m0 >= 1:
        return black, top, None
    return black, top, m0 * (target - 1) / ((2 * target - 1) * m0 - target)


def apply_stretch(plane: np.ndarray, params: tuple[float, float, float | None]) -> np.ndarray:
    black, top, m = params
    x = np.clip((plane - black) / (top - black), 0.0, 1.0)
    if m is None:
        return x
    return ((m - 1) * x) / ((2 * m - 1) * x - m)


def _stretch(plane: np.ndarray, target: float = 0.2) -> np.ndarray:
    return apply_stretch(plane, stretch_params(plane[::4, ::4], target))


def _stars(plane: np.ndarray) -> tuple[int, float | None]:
    """Star count and median half-flux radius (in the plane's pixels) of the brightest 400.

    A star is a local maximum 8σ above the background that is neither saturated nor a lone hot pixel
    (at least 4 of its 3×3 neighbourhood above 3σ)."""
    sample = plane[::4, ::4]
    background = float(np.median(sample))
    sigma = float(np.median(np.abs(sample - background))) * 1.4826 or 1.0
    maximum = plane.copy()
    above = np.zeros(plane.shape, np.uint8)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            shifted = np.roll(np.roll(plane, dy, 0), dx, 1)
            np.maximum(maximum, shifted, out=maximum)
            above += shifted > background + 3 * sigma
    peak = plane >= maximum
    stars = peak & (plane > background + 8 * sigma) & (plane < 60000) & (above >= 4)
    margin = 6
    stars[:margin, :] = stars[-margin:, :] = False
    stars[:, :margin] = stars[:, -margin:] = False
    ys, xs = np.nonzero(stars)
    if len(ys) == 0:
        return 0, None
    brightest = np.argsort(plane[ys, xs])[::-1][:400]
    ys, xs = ys[brightest], xs[brightest]
    radius = 5
    oy, ox = np.mgrid[-radius : radius + 1, -radius : radius + 1]
    r = np.hypot(oy, ox)
    windows = np.clip(plane[ys[:, None, None] + oy, xs[:, None, None] + ox] - background, 0, None) * (r <= radius)
    hfr = (windows * r).sum(axis=(1, 2)) / np.maximum(windows.sum(axis=(1, 2)), 1e-6)
    return int(stars.sum()), float(np.median(hfr))


def _jpeg(image: Image.Image, quality: int) -> bytes:
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=quality, optimize=True)
    return out.getvalue()


def previews(planes: list[np.ndarray], quality: int = 85) -> tuple[bytes, bytes, int, int]:
    """Stretched preview JPEGs (full plane size and ~300 px) and the large one's size."""
    stretched = [_stretch(p) for p in planes]
    array = np.stack(stretched, axis=-1) if len(stretched) == 3 else stretched[0]
    image = Image.fromarray((np.clip(array, 0, 1) * 255 + 0.5).astype(np.uint8))
    small = image.copy()
    small.thumbnail((300, 300), Image.Resampling.LANCZOS)
    return _jpeg(image, quality), _jpeg(small, 80), image.width, image.height


def channels(pixels: np.ndarray, header: dict[str, str]) -> list[np.ndarray]:
    """Half-size planes of a frame (R, G, B for colour, one for mono)."""
    return _channels(pixels, header.get("BAYERPAT", "").strip().upper())


def render(pixels: np.ndarray, header: dict[str, str]) -> Rendered:
    planes = channels(pixels, header)
    luminance = planes[1] if len(planes) == 3 else planes[0]
    large, small, width, height = previews(planes)
    stars, hfr = _stars(luminance)
    # The planes are half size for colour/binned frames: HFR in the camera's own pixels.
    scale = pixels.shape[1] / luminance.shape[1]
    return Rendered(
        large=large,
        small=small,
        width=width,
        height=height,
        background_adu=float(np.median(luminance[::4, ::4])),
        stars=stars,
        hfr=round(hfr * scale, 2) if hfr is not None else None,
        planes=planes,
        scale=scale,
    )


def angle(value: str | None, hours: bool = False) -> float | None:
    """Degrees from a header value: decimal ("60.25") or sexagesimal ("+60 15 00", "04:03:30";
    hours when `hours`)."""
    if value is None or not str(value).strip():
        return None
    text = str(value).strip()
    parts = [p for p in re.split(r"[\s:dhms°'\"]+", text) if p]
    try:
        if len(parts) == 1:
            degrees = float(parts[0])
        else:
            sign = -1.0 if text.startswith("-") else 1.0
            numbers = [abs(float(p)) for p in parts[:3]]
            degrees = sign * sum(n / 60**i for i, n in enumerate(numbers))
    except ValueError:
        return None
    return degrees * 15 if hours and len(parts) > 1 else degrees


@dataclass(frozen=True)
class Wcs:
    """A TAN (gnomonic) plate solution: FITS pixel (1-based) ↔ RA/Dec in degrees."""

    crpix: tuple[float, float]
    crval: tuple[float, float]
    cd: tuple[tuple[float, float], tuple[float, float]]

    def to_sky(self, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        (a, b), (c, d) = self.cd
        dx, dy = x - self.crpix[0], y - self.crpix[1]
        xi, eta = np.radians(a * dx + b * dy), np.radians(c * dx + d * dy)
        ra0, dec0 = math.radians(self.crval[0]), math.radians(self.crval[1])
        rho = np.hypot(xi, eta)
        c_ = np.arctan(rho)
        sin_c, cos_c = np.sin(c_), np.cos(c_)
        with np.errstate(invalid="ignore", divide="ignore"):
            dec = np.arcsin(cos_c * math.sin(dec0) + np.where(rho > 0, eta * sin_c * math.cos(dec0) / rho, 0))
        ra = ra0 + np.arctan2(xi * sin_c, rho * math.cos(dec0) * cos_c - eta * math.sin(dec0) * sin_c)
        return np.degrees(ra) % 360, np.degrees(dec)

    def to_pixel(self, ra: np.ndarray, dec: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        ra, dec = np.radians(ra), np.radians(dec)
        ra0, dec0 = math.radians(self.crval[0]), math.radians(self.crval[1])
        cos_c = math.sin(dec0) * np.sin(dec) + math.cos(dec0) * np.cos(dec) * np.cos(ra - ra0)
        xi = np.degrees(np.cos(dec) * np.sin(ra - ra0) / cos_c)
        eta = np.degrees((math.cos(dec0) * np.sin(dec) - math.sin(dec0) * np.cos(dec) * np.cos(ra - ra0)) / cos_c)
        (a, b), (c, d) = self.cd
        det = a * d - b * c
        return self.crpix[0] + (d * xi - b * eta) / det, self.crpix[1] + (-c * xi + a * eta) / det

    def plane(self, scale: float) -> Wcs:
        """The solution on the half-size plane: plane pixel p (0-based) spans camera pixels
        scale·p … scale·p + scale − 1, so camera FITS x = scale·(P − 1) + (scale + 1)/2 for plane
        FITS P = p + 1 (as register.wcs_guess)."""
        offset = (scale + 1) / 2
        crpix = tuple((c - offset) / scale + 1 for c in self.crpix)
        return Wcs(crpix, self.crval, tuple(tuple(v * scale for v in row) for row in self.cd))

    def through(self, matrix: np.ndarray) -> Wcs:
        """The solution of the grid that `matrix` (3×3 affine, 0-based pixels: this grid → that
        grid) maps this one onto. Exact for an affine map: sky(Q) = TAN(CD·A·(Q − CRPIX'))."""
        inverse = np.linalg.inv(matrix)
        a = inverse[:2, :2]
        crpix = matrix[:2, :2] @ (np.array(self.crpix) - 1) + matrix[:2, 2] + 1
        cd = np.array(self.cd) @ a
        return Wcs((float(crpix[0]), float(crpix[1])), self.crval, tuple(tuple(float(v) for v in row) for row in cd))

    def pixel_scale_arcsec(self) -> float:
        (a, b), (c, d) = self.cd
        return math.sqrt(abs(a * d - b * c)) * 3600

    def cards(self) -> dict:
        """FITS keywords (Contract 1's `wcs`)."""
        (a, b), (c, d) = self.cd
        return {"CTYPE1": "RA---TAN", "CTYPE2": "DEC--TAN", "CRVAL1": self.crval[0], "CRVAL2": self.crval[1],
                "CRPIX1": self.crpix[0], "CRPIX2": self.crpix[1], "CD1_1": a, "CD1_2": b, "CD2_1": c, "CD2_2": d}

    def json(self) -> dict:
        return {"crpix": list(self.crpix), "crval": list(self.crval), "cd": [list(r) for r in self.cd]}

    @staticmethod
    def from_json(data: dict | None) -> Wcs | None:
        if not data:
            return None
        return Wcs(tuple(data["crpix"]), tuple(data["crval"]), tuple(tuple(r) for r in data["cd"]))


SIP = re.compile(r"^(?:[AB]_ORDER|[AB]_\d_\d|[AB]P_ORDER|[AB]P_\d_\d)$")


def wcs_cards(header: dict[str, str]) -> dict | None:
    """Contract 1's `wcs` from a header with a TAN solution: the linear part as a CD matrix, plus
    the SIP distortion keywords when CTYPE says TAN-SIP."""
    solution = wcs(header)
    if solution is None:
        return None
    cards = solution.cards()
    if header.get("CTYPE1", "").endswith("-SIP") and header.get("CTYPE2", "").endswith("-SIP"):
        cards["CTYPE1"], cards["CTYPE2"] = "RA---TAN-SIP", "DEC--TAN-SIP"
        for key in header:
            if SIP.match(key) and (value := number(header, key)) is not None:
                cards[key] = int(value) if key.endswith("ORDER") else value
    return cards


def wcs(header: dict[str, str]) -> Wcs | None:
    """The frame's plate solution, if the header has one (CD matrix, or CDELT with CROTA2/PC)."""
    if "TAN" not in header.get("CTYPE1", "") or "TAN" not in header.get("CTYPE2", ""):
        return None
    values = [number(header, k) for k in ("CRPIX1", "CRPIX2", "CRVAL1", "CRVAL2")]
    if any(v is None for v in values):
        return None
    crpix1, crpix2, crval1, crval2 = values
    if number(header, "CD1_1") is not None or number(header, "CD2_2") is not None:
        cd = tuple(tuple(number(header, f"CD{i}_{j}") or 0.0 for j in (1, 2)) for i in (1, 2))
    else:
        cdelt1, cdelt2 = number(header, "CDELT1"), number(header, "CDELT2")
        if not cdelt1 or not cdelt2:
            return None
        if number(header, "PC1_1") is not None:
            pc = [[number(header, f"PC{i}_{j}") or 0.0 for j in (1, 2)] for i in (1, 2)]
        else:
            rot = math.radians(number(header, "CROTA2") or 0.0)
            pc = [[math.cos(rot), -math.sin(rot) * cdelt2 / cdelt1], [math.sin(rot) * cdelt1 / cdelt2, math.cos(rot)]]
        cd = ((cdelt1 * pc[0][0], cdelt1 * pc[0][1]), (cdelt2 * pc[1][0], cdelt2 * pc[1][1]))
    if abs(cd[0][0] * cd[1][1] - cd[0][1] * cd[1][0]) < 1e-14:
        return None
    return Wcs((crpix1, crpix2), (crval1, crval2), cd)


def write_float(path: str, data: np.ndarray, cards: dict[str, str | float | int]) -> None:
    """A 32-bit float FITS image: (height, width) or (height, width, channels) → NAXIS 2 or 3."""
    planes = data[np.newaxis] if data.ndim == 2 else np.moveaxis(data, -1, 0)
    header = [("SIMPLE", True), ("BITPIX", -32), ("NAXIS", 2 if data.ndim == 2 else 3),
              ("NAXIS1", data.shape[1]), ("NAXIS2", data.shape[0])]
    if data.ndim == 3:
        header.append(("NAXIS3", data.shape[2]))
    header += list(cards.items())
    lines = []
    for key, value in header:
        if isinstance(value, bool):
            text = "T" if value else "F"
            lines.append(f"{key:<8}= {text:>20}")
        elif isinstance(value, (int, float)):
            lines.append(f"{key:<8}= {value:>20}")
        else:
            quoted = "'" + str(value).replace("'", "''")[:66] + "'"
            lines.append(f"{key:<8}= {quoted:<20}")
    lines.append("END")
    text = "".join(f"{line:<80}"[:80] for line in lines)
    text += " " * (-len(text) % BLOCK)
    body = np.ascontiguousarray(planes, dtype=">f4").tobytes()
    with open(path, "wb") as f:
        f.write(text.encode("ascii"))
        f.write(body)
        f.write(b"\0" * (-len(body) % BLOCK))


def read_header_file(f) -> tuple[dict[str, str], int]:
    """The header of an open FITS file (read block by block) and the data offset."""
    raw = b""
    while True:
        block = f.read(BLOCK)
        if len(block) < BLOCK:
            raise ValueError("not a FITS file (no END card)")
        raw += block
        if len(raw) > 100 * BLOCK:
            raise ValueError("FITS header too long")
        try:
            return parse_header(raw)
        except IncompleteFrame:
            continue


DTYPES = {"8": ">u1", "16": ">i2", "32": ">i4", "-32": ">f4", "-64": ">f8"}


def open_image(path: str) -> tuple[dict[str, str], np.ndarray, float, float]:
    """A FITS file's primary image, memory-mapped: (header, raw array (planes, height, width),
    BSCALE, BZERO); physical value = raw · BSCALE + BZERO. NAXIS 2 or 3 (colour planes)."""
    with open(path, "rb") as f:
        if f.read(30)[:9] != b"SIMPLE  =":
            raise ValueError("not a FITS file")
        f.seek(0)
        header, offset = read_header_file(f)
    dtype = DTYPES.get(header.get("BITPIX", ""))
    naxis = header.get("NAXIS")
    if dtype is None or naxis not in ("2", "3"):
        raise ValueError(f"unsupported FITS image: BITPIX {header.get('BITPIX')}, NAXIS {naxis}")
    width, height = int(header["NAXIS1"]), int(header["NAXIS2"])
    planes = int(header.get("NAXIS3", "1")) if naxis == "3" else 1
    if planes not in (1, 3) or width < 1 or height < 1:
        raise ValueError(f"unsupported FITS image: {width}×{height}×{planes}")
    need = offset + width * height * planes * np.dtype(dtype).itemsize
    if os.path.getsize(path) < need:
        raise ValueError("FITS file is shorter than its header says")
    data = np.memmap(path, dtype=dtype, mode="r", offset=offset, shape=(planes, height, width))
    return header, data, number(header, "BSCALE") or 1.0, number(header, "BZERO") or 0.0
