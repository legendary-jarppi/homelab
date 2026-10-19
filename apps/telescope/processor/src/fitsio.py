"""FITS headers (the archive's ASIAIR frames) and Siril's 32-bit float images.

ASIAIR frames: one 16-bit image HDU (BITPIX 16, BZERO 32768). Siril writes 32-bit floats scaled to
0…1 (16-bit input / 65535), colour images as NAXIS3 = 3 planes. Only headers are read from the
archive here; Siril reads the pixels.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

import numpy as np

BLOCK = 2880
CARD = 80
MAX_HEADER_BLOCKS = 64


def parse_header(raw: bytes) -> tuple[dict[str, str], int] | None:
    """Header keywords (string values unquoted) and the data offset; None without an END card."""
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
    return None


def read_header(path: str) -> tuple[dict[str, str], int] | None:
    raw = b""
    with open(path, "rb") as f:
        for _ in range(MAX_HEADER_BLOCKS):
            block = f.read(BLOCK)
            if len(block) < BLOCK:
                return None
            raw += block
            if b"END     " in block or block.rstrip(b" ").endswith(b"END"):
                parsed = parse_header(raw)
                if parsed:
                    return parsed
    return None


def number(header: dict[str, str], key: str) -> float | None:
    try:
        return float(header[key])
    except (KeyError, ValueError):
        return None


def date_obs(value: str | None) -> float | None:
    """DATE-OBS (UTC, ISO) → unix seconds."""
    if not value:
        return None
    try:
        t = datetime.fromisoformat(value.strip().rstrip("Z"))
    except ValueError:
        return None
    return (t if t.tzinfo else t.replace(tzinfo=timezone.utc)).timestamp()


def angle(value: str | None, hours: bool = False) -> float | None:
    """Degrees from a header value: decimal ("60.25") or sexagesimal ("+60 15 00", "04:03:30";
    hours when `hours`), as the telescope service reads RA and DEC."""
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


def read_float(path: str) -> tuple[np.ndarray, int]:
    """A float image as (planes, height, width) float32 and the header length (for rewrite_float)."""
    with open(path, "rb") as f:
        raw = f.read()
    parsed = parse_header(raw)
    if parsed is None:
        raise ValueError(f"{path}: no FITS header")
    header, offset = parsed
    if header.get("BITPIX") != "-32":
        raise ValueError(f"{path}: BITPIX {header.get('BITPIX')}, 32-bit float expected")
    width, height = int(header["NAXIS1"]), int(header["NAXIS2"])
    planes = int(header.get("NAXIS3", "1")) if header.get("NAXIS") == "3" else 1
    data = np.frombuffer(raw, ">f4", count=planes * width * height, offset=offset).reshape(planes, height, width)
    scale, zero = number(header, "BSCALE") or 1.0, number(header, "BZERO") or 0.0
    out = data.astype(np.float32)
    if scale != 1.0 or zero != 0.0:
        out = out * np.float32(scale) + np.float32(zero)
    return out, offset


def rewrite_float(src: str, dst: str, data: np.ndarray) -> None:
    """`dst`: the header of `src` unchanged (plate solve, history, …) with new pixels of the same
    shape (BSCALE 1, BZERO 0 assumed: Siril writes neither for floats)."""
    with open(src, "rb") as f:
        raw = f.read(BLOCK * MAX_HEADER_BLOCKS)
    parsed = parse_header(raw)
    if parsed is None:
        raise ValueError(f"{src}: no FITS header")
    header, offset = parsed
    if (number(header, "BSCALE") or 1.0) != 1.0 or (number(header, "BZERO") or 0.0) != 0.0:
        raise ValueError(f"{src}: scaled float data")
    body = np.ascontiguousarray(data, dtype=">f4").tobytes()
    with open(dst, "wb") as f:
        f.write(raw[:offset])
        f.write(body)
        f.write(b"\0" * (-len(body) % BLOCK))


def _set_card(header: bytearray, offset: int, key: str, value: float | int) -> None:
    """Replace a numeric card's value in place (the card must exist)."""
    for i in range(0, offset, CARD):
        if header[i : i + 8].decode("ascii").strip() == key and header[i + 8 : i + 10] == b"= ":
            header[i : i + CARD] = f"{key:<8}= {value:>20}".ljust(CARD).encode("ascii")
            return
    raise ValueError(f"no {key} card")


def write_cropped(src: str, dst: str, data: np.ndarray, x0: int, y0: int) -> None:
    """`dst`: `src`'s header with the size and the plate solve's reference pixel moved for a crop
    starting at column `x0`, row `y0` (0-based), and `data` (planes, height, width) as pixels."""
    with open(src, "rb") as f:
        raw = f.read(BLOCK * MAX_HEADER_BLOCKS)
    parsed = parse_header(raw)
    if parsed is None:
        raise ValueError(f"{src}: no FITS header")
    header, offset = parsed
    out = bytearray(raw[:offset])
    _set_card(out, offset, "NAXIS1", data.shape[2])
    _set_card(out, offset, "NAXIS2", data.shape[1])
    for key, shift in (("CRPIX1", x0), ("CRPIX2", y0)):
        if number(header, key) is not None:
            _set_card(out, offset, key, round(number(header, key) - shift, 6))
    body = np.ascontiguousarray(data, dtype=">f4").tobytes()
    with open(dst, "wb") as f:
        f.write(out)
        f.write(body)
        f.write(b"\0" * (-len(body) % BLOCK))
