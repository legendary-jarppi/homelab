"""ASIAIR FITS frames: header, preview JPEGs and sky-quality numbers.

ASIAIR writes plain 16-bit FITS (BITPIX 16, BZERO 32768), one image HDU, rows in the same order the
ASIAIR app shows them (checked against its own thumbnails). Colour cameras carry BAYERPAT; their
preview is a 2×2 superpixel debayer (half size: 3008² → 1504² for the ASI533MC), mono frames are
binned 2×2 the same way when wider than 2000 px.
"""

from __future__ import annotations

import io
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


def _stretch(plane: np.ndarray, target: float = 0.2) -> np.ndarray:
    """Screen stretch like PixInsight's STF: black point just below the background, then a midtones
    curve that puts the background at `target`. Per channel, which also neutralises the colour cast
    of light pollution."""
    sample = plane[::4, ::4]
    median = float(np.median(sample))
    mad = float(np.median(np.abs(sample - median))) * 1.4826
    black = max(0.0, median - 2.8 * mad)
    top = max(float(np.percentile(sample, 99.995)), median + 1.0)
    x = np.clip((plane - black) / (top - black), 0.0, 1.0)
    m0 = (median - black) / (top - black)
    if m0 <= 0 or m0 >= 1:
        return x
    m = m0 * (target - 1) / ((2 * target - 1) * m0 - target)
    return ((m - 1) * x) / ((2 * m - 1) * x - m)


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


def render(pixels: np.ndarray, header: dict[str, str]) -> Rendered:
    planes = _channels(pixels, header.get("BAYERPAT", "").strip().upper())
    luminance = planes[1] if len(planes) == 3 else planes[0]
    stretched = [_stretch(p) for p in planes]
    array = np.stack(stretched, axis=-1) if len(stretched) == 3 else stretched[0]
    image = Image.fromarray((np.clip(array, 0, 1) * 255 + 0.5).astype(np.uint8))
    small = image.copy()
    small.thumbnail((300, 300), Image.Resampling.LANCZOS)
    stars, hfr = _stars(luminance)
    # The planes are half size for colour/binned frames: HFR in the camera's own pixels.
    scale = pixels.shape[1] / luminance.shape[1]
    return Rendered(
        large=_jpeg(image, 85),
        small=_jpeg(small, 80),
        width=image.width,
        height=image.height,
        background_adu=float(np.median(luminance[::4, ::4])),
        stars=stars,
        hfr=round(hfr * scale, 2) if hfr is not None else None,
    )
