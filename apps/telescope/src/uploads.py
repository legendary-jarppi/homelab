"""The owner's own processed images (PixInsight, Siril exports) for the web app's gallery, on the
backed-up data volume: <data>/uploads/<id>/

    meta.json     target, title, note, dates, publish flag, the original's name/size/type, the
                  image's size, bit depth, plate solve (the FITS's, or ASTAP's after the upload,
                  with its `solve` record), histogram and statistics
    original      the uploaded file byte for byte (JPEG, PNG, TIFF 8/16/32-bit, FITS)
    pixels.npy    the decoded pixels in their own type ((height, width) or (height, width, 3)),
                  memory-mapped for star measurements; about the uncompressed image size
    display.jpg   full resolution, quality 92 (no downscaling)
    small.jpg     600 px

The upload is streamed to disk as it arrives (multipart/form-data parsed in 1 MiB chunks, never the
whole file in memory), then decoded and converted, one upload at a time. Data deeper than 8 bits
whose background sits low in its range (median under LINEAR_MEDIAN of full scale: an unstretched
linear stack) gets the frames' screen stretch for display; anything else (the usual stretched
export) is shown as it is, scaled to 8 bits. Ids are 16 random hex characters.
"""

from __future__ import annotations

import email.parser
import email.policy
import io
import json
import logging
import math
import os
import queue
import re
import secrets
import shutil
import threading
import time
import warnings
from datetime import datetime, timezone

import numpy as np
import tifffile
from PIL import Image, ImageOps

import fits
import images
import measure
import solve
from targets import KEY as TARGET_KEY

log = logging.getLogger("uploads")

MAX_BYTES = 300 * 2**20
CHUNK = 2**20
MAX_TITLE = 200
MAX_NOTE = 2000
SMALL_PX = 600
JPEG_QUALITY = 92
LINEAR_MEDIAN = 0.08
SATURATION = 0.98  # of the data's full scale
BAND_ROWS = 512
ID = re.compile(r"^[0-9a-f]{16}$")
FIELDS = {"target", "title", "note", "takenAt", "raHint", "decHint"}
# Hints for the plate solve (the target's catalog position from the web app), degrees.
HINTS = (("raHint", 0.0, 360.0), ("decHint", -90.0, 90.0))
# Pillow refuses images over ~179 MP as decompression bombs; 300 MB files can be larger than that.
Image.MAX_IMAGE_PIXELS = 400_000_000


class UploadError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


# --- multipart/form-data, streamed --------------------------------------------------------------


def read_multipart(rfile, length: int, boundary: bytes, open_file, max_file: int = MAX_BYTES):
    """Parse a multipart body of `length` bytes from `rfile` without holding it in memory: text
    fields (≤ 64 KB each) into a dict, the one file part (name "file") into `open_file(filename,
    content_type)`'s writable file. → (fields, {filename, contentType, bytes} or None)."""
    delimiter = b"--" + boundary
    separator = b"\r\n" + delimiter
    buf = bytearray()
    remaining = length

    def fill() -> None:
        nonlocal remaining
        if remaining <= 0:
            raise UploadError(400, "multipart body ended early")
        data = rfile.read(min(CHUNK, remaining))
        if not data:
            raise UploadError(400, "multipart body ended early")
        remaining -= len(data)
        buf.extend(data)

    # Preamble up to the first delimiter.
    while (i := buf.find(delimiter)) < 0:
        del buf[: max(0, len(buf) - len(delimiter))]
        fill()
    del buf[: i + len(delimiter)]
    fields: dict[str, str] = {}
    upload = None
    parser = email.parser.BytesHeaderParser(policy=email.policy.compat32)
    while True:
        while len(buf) < 2:
            fill()
        if buf[:2] == b"--":
            break
        if buf[:2] != b"\r\n":
            raise UploadError(400, "malformed multipart body")
        del buf[:2]
        while (end := buf.find(b"\r\n\r\n")) < 0:
            if len(buf) > 16384:
                raise UploadError(400, "multipart part headers too long")
            fill()
        headers = parser.parsebytes(bytes(buf[:end]))
        del buf[: end + 4]
        name = headers.get_param("name", header="content-disposition")
        filename = headers.get_filename()
        if name == "file" and filename is not None:
            if upload is not None:
                raise UploadError(400, "only one file per upload")
            sink = open_file(os.path.basename(filename.replace("\\", "/"))[:200], headers.get_content_type())
            limit, written = max_file, 0
        elif name in FIELDS:
            sink, limit, written = io.BytesIO(), 65536, 0
        else:
            raise UploadError(400, f"unexpected form field {name!r}")
        while True:
            i = buf.find(separator)
            take = i if i >= 0 else max(0, len(buf) - len(separator) + 1)
            written += take
            if written > limit:
                raise UploadError(413, f"file over {max_file // 2**20} MB" if limit == max_file else f"field {name} too long")
            sink.write(bytes(buf[:take]) if take else b"")
            if i >= 0:
                del buf[: i + len(separator)]
                break
            del buf[:take]
            fill()
        if limit == max_file:
            upload = {"filename": os.path.basename(filename.replace("\\", "/"))[:200] or "upload",
                      "contentType": headers.get_content_type(), "bytes": written}
        else:
            try:
                fields[name] = sink.getvalue().decode("utf-8")
            except UnicodeDecodeError:
                raise UploadError(400, f"field {name} is not UTF-8") from None
    # Discard the epilogue.
    while remaining > 0:
        data = rfile.read(min(CHUNK, remaining))
        if not data:
            break
        remaining -= len(data)
    return fields, upload


# --- decoding -------------------------------------------------------------------------------------


def sniff(path: str) -> str | None:
    with open(path, "rb") as f:
        head = f.read(16)
    if head.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head[:4] in (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+"):
        return "tiff"
    if head.startswith(b"SIMPLE  ="):
        return "fits"
    return None


CONTENT_TYPES = {"jpeg": "image/jpeg", "png": "image/png", "tiff": "image/tiff", "fits": "application/fits"}


def _rgb_layout(array: np.ndarray) -> np.ndarray:
    """(height, width) or (height, width, 3): planar (3|4, h, w) turned, alpha and extra samples dropped."""
    if array.ndim == 3 and array.shape[0] in (3, 4) and array.shape[2] not in (3, 4):
        array = np.moveaxis(array, 0, -1)
    if array.ndim == 3 and array.shape[2] == 1:
        array = array[..., 0]
    if array.ndim == 3 and array.shape[2] == 2:
        array = array[..., 0]  # grey + alpha
    if array.ndim == 3 and array.shape[2] >= 3:
        array = array[..., :3]
    if array.ndim != 2 and not (array.ndim == 3 and array.shape[2] == 3):
        raise UploadError(415, f"unsupported image layout {array.shape}")
    return array


def _native(array: np.ndarray) -> np.ndarray:
    """Keep 8- and 16-bit unsigned pixels as they are; anything else as float32."""
    if array.dtype in (np.uint8, np.uint16):
        return array
    if array.dtype == np.bool_:
        return array.astype(np.uint8) * 255
    return array.astype(np.float32)


def decode_pillow(path: str) -> np.ndarray:
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image)
        if image.mode in ("I;16", "I;16B", "I;16L"):
            return np.asarray(image, dtype=np.uint16)
        if image.mode == "I":
            array = np.asarray(image)
            return array.astype(np.uint16) if array.min() >= 0 and array.max() <= 65535 else array.astype(np.float32)
        if image.mode == "F":
            return np.asarray(image, dtype=np.float32)
        if image.mode in ("L", "1"):
            return np.asarray(image.convert("L"))
        if image.mode == "LA":
            return np.asarray(image.getchannel(0))
        return np.asarray(image.convert("RGB"))


def decode_tiff(path: str) -> np.ndarray:
    try:
        with tifffile.TiffFile(path) as tif:
            page = tif.pages[0]
            return _native(_rgb_layout(page.asarray()))
    except UploadError:
        raise
    except Exception as e:  # noqa: BLE001 - tifffile raises many kinds for broken or exotic files
        raise UploadError(415, f"unreadable TIFF: {e}"[:200]) from None


def write_fits_pixels(path: str, out: str) -> dict[str, str]:
    """A FITS image into pixels.npy in row bands (memory stays flat for large files); its header."""
    try:
        header, raw, bscale, bzero = fits.open_image(path)
    except ValueError as e:
        raise UploadError(415, str(e)) from None
    planes, height, width = raw.shape
    bitpix = header.get("BITPIX")
    if bitpix == "8" and bscale == 1 and bzero == 0:
        dtype = np.uint8
    elif bitpix == "16" and bscale == 1 and bzero == 32768:
        dtype = np.uint16
    else:
        dtype = np.float32
    shape = (height, width) if planes == 1 else (height, width, 3)
    target = np.lib.format.open_memmap(out, mode="w+", dtype=dtype, shape=shape)
    for y0 in range(0, height, BAND_ROWS):
        band = np.asarray(raw[:, y0 : y0 + BAND_ROWS])
        if dtype == np.uint16:
            values = (band.astype(np.int32) + 32768).astype(np.uint16)
        elif dtype == np.uint8:
            values = band.astype(np.uint8)
        else:
            values = band.astype(np.float32) * np.float32(bscale) + np.float32(bzero)
        target[y0 : y0 + BAND_ROWS] = values[0] if planes == 1 else np.moveaxis(values, 0, -1)
    target.flush()
    del target, raw
    return header


def full_scale(pixels: np.ndarray, data_max: float) -> float:
    if pixels.dtype == np.uint8:
        return 255.0
    if pixels.dtype == np.uint16:
        return 65535.0
    return 1.0 if data_max <= 1.0001 else data_max


def planes_of(array: np.ndarray) -> list[np.ndarray]:
    return [array] if array.ndim == 2 else [array[..., i] for i in range(3)]


def render(pixels: np.ndarray, folder: str) -> dict:
    """display.jpg and small.jpg from the pixels (row bands), and the numbers for meta.json."""
    height, width = pixels.shape[:2]
    step = images.row_step(height, width)
    sample = np.asarray(pixels[::step], dtype=np.float32)
    finite = sample[np.isfinite(sample)]
    if finite.size == 0:
        raise UploadError(415, "the image has no finite pixel values")
    data_min, data_max = float(finite.min()), float(finite.max())
    scale = full_scale(pixels, data_max)
    low = 0.0 if pixels.dtype in (np.uint8, np.uint16) or data_min >= 0 else data_min
    span = scale - low if scale > low else 1.0
    depth = {np.dtype(np.uint8): 8, np.dtype(np.uint16): 16}.get(pixels.dtype, 32)
    sample_planes = planes_of(sample)
    medians = [float(np.nanmedian(p)) for p in sample_planes]
    linear = depth > 8 and max((m - low) / span for m in medians) < LINEAR_MEDIAN
    # Stretch on a 0–65535 scale (fits.stretch_params' guards assume ADU-like numbers).
    stretch = [fits.stretch_params(((p[::4] - low) / span * 65535).ravel()) for p in sample_planes] if linear else None
    out = np.empty((height, width) if pixels.ndim == 2 else (height, width, 3), np.uint8)
    for y0 in range(0, height, BAND_ROWS):
        band = (np.asarray(pixels[y0 : y0 + BAND_ROWS], dtype=np.float32) - np.float32(low)) / np.float32(span)
        band = np.nan_to_num(band, nan=0.0)
        if stretch:
            bands = planes_of(band * 65535)
            band = np.stack([fits.apply_stretch(b, s) for b, s in zip(bands, stretch)], axis=-1) if len(bands) == 3 \
                else fits.apply_stretch(bands[0], stretch[0])
        out[y0 : y0 + BAND_ROWS] = (np.clip(band, 0, 1) * 255 + 0.5).astype(np.uint8)
    image = Image.fromarray(out)
    del out
    image.save(os.path.join(folder, "display.jpg"), format="JPEG", quality=JPEG_QUALITY, optimize=True)
    image.thumbnail((SMALL_PX, SMALL_PX), Image.Resampling.LANCZOS)
    image.save(os.path.join(folder, "small.jpg"), format="JPEG", quality=85, optimize=True)
    histogram, stats = images.describe(sample_planes, (low, scale))
    return {"width": width, "height": height, "bitDepth": depth, "linear": bool(linear), "fullScale": scale,
            "histogram": histogram, "stats": stats}


# --- metadata -------------------------------------------------------------------------------------


def parse_time(value) -> float | None:
    """Unix seconds, or an ISO 8601 date/time (UTC unless it says otherwise); '' / None → None."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError("takenAt: unix seconds or an ISO 8601 date")
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        text = str(value).strip()
        try:
            number = float(text)
        except ValueError:
            try:
                parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            except ValueError:
                raise ValueError("takenAt: unix seconds or an ISO 8601 date") from None
            number = (parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)).timestamp()
    if not math.isfinite(number) or not 0 < number < 4102444800:
        raise ValueError("takenAt: out of range")
    return number


def parse_fields(body, partial: bool) -> dict | str:
    """Validated fields of a PUT (partial) or an upload form; or what is wrong."""
    allowed = {"target", "title", "note", "published", "takenAt"} if partial else FIELDS
    if not isinstance(body, dict) or (partial and not body) or set(body) - allowed:
        return "expected {" + ", ".join(f'"{k}"?' for k in sorted(allowed)) + "}"
    out = {}
    if "target" in body or not partial:
        target = body.get("target")
        if not isinstance(target, str) or not TARGET_KEY.match(target.strip()):
            return "target: up to 64 of A-Z a-z 0-9 space + . _ ( ) -"
        out["target"] = target.strip()
    for key, limit in (("title", MAX_TITLE), ("note", MAX_NOTE)):
        if key in body:
            value = body[key]
            if value is not None and (not isinstance(value, str) or len(value) > limit):
                return f"{key}: text up to {limit} characters or null"
            out[key] = (value or "").strip() or None
    if "published" in body:
        if not isinstance(body["published"], bool):
            return "published: true or false"
        out["published"] = body["published"]
    if "takenAt" in body:
        try:
            out["takenAt"] = parse_time(body["takenAt"])
        except ValueError as e:
            return str(e)
    for key, low, high in HINTS:
        if body.get(key) not in (None, ""):
            try:
                value = float(body[key])
            except (TypeError, ValueError):
                value = math.nan
            if not (math.isfinite(value) and low <= value <= high):
                return f"{key}: degrees, {low:g} … {high:g}"
            out[key] = value
    return out


def solve_state(meta: dict) -> dict | None:
    """An upload's plate solve for the API: `source` file (the uploaded FITS had one) or astap (our
    own, after the upload), when, or why not (source null with the error); null while waiting."""
    record = meta.get("solve")
    if record:
        return {"source": record["source"], "at": record["at"], "error": record["error"]}
    return {"source": "file", "at": meta["createdAt"], "error": None} if meta.get("wcs") else None


def fits_numbers(header: dict[str, str]) -> dict:
    """Integration and frame count of a stacked FITS (Siril: LIVETIME/STACKCNT; others EXPTIME/NCOMBINE)."""
    integration = fits.number(header, "LIVETIME") or fits.number(header, "EXPTIME")
    frames = fits.number(header, "STACKCNT") or fits.number(header, "NCOMBINE")
    taken = header.get("DATE-OBS")
    try:
        taken_at = datetime.fromisoformat(taken).replace(tzinfo=timezone.utc).timestamp() if taken else None
    except ValueError:
        taken_at = None
    return {"integrationS": round(integration) if integration else None, "frames": int(frames) if frames else None,
            "takenAt": taken_at}


class Uploads:
    def __init__(self, data: str, scratch: str | None = None):
        self.root = os.path.join(data, "uploads")
        os.makedirs(self.root, exist_ok=True)
        self.scratch = scratch  # ASTAP's working files; None: no plate solving
        self.lock = threading.Lock()
        self.convert_lock = threading.Lock()  # one decode at a time (memory)
        self.solve_queue: queue.Queue[str] = queue.Queue()
        self.entries: dict[str, dict] = {}
        for name in os.listdir(self.root):
            folder = os.path.join(self.root, name)
            if name.startswith(".tmp-"):
                shutil.rmtree(folder, ignore_errors=True)  # an interrupted upload
                continue
            try:
                with open(os.path.join(folder, "meta.json")) as f:
                    self.entries[name] = json.load(f)
            except (OSError, ValueError) as e:
                log.error("upload %s: %s", name, e)
        log.info("%d uploads", len(self.entries))

    def start(self) -> None:
        """The plate solving thread for uploads without a solution: new ones, and once the existing ones."""
        if not self.scratch or not solve.available():
            return
        with self.lock:
            for uid, meta in sorted(self.entries.items(), key=lambda kv: -kv[1]["createdAt"]):
                if not meta.get("wcs") and not meta.get("solve"):
                    self.solve_queue.put(uid)
        threading.Thread(target=self._solver, name="upload-solver", daemon=True).start()

    def _solver(self) -> None:
        while True:
            uid = self.solve_queue.get()
            try:
                self.solve(uid)
            except Exception as e:  # noqa: BLE001 - one bad upload must not stop the thread
                log.exception("plate solve upload %s", uid)
                self._set_solution(uid, None, {"source": None, "at": time.time(),
                                               "error": f"{type(e).__name__}: {e}"[:200]})

    def solve(self, uid: str) -> None:
        """ASTAP on a mono, binned copy of the pixels (solve.write_luminance), around the hint if there
        is one, else the whole sky; the scale is unknown (crops, resizes), so ASTAP tries field heights
        of 10° … 0.3°. The solution is moved back to the full-size pixels (rows top-down as displayed)."""
        with self.lock:
            meta = self.entries.get(uid)
            if meta is None or meta.get("wcs"):
                return
            hint, full = meta.get("hint") or (None, None), meta["fullScale"]
        os.makedirs(self.scratch, exist_ok=True)
        path = os.path.join(self.scratch, f"upload-{uid}.fits")
        now = time.time()
        try:
            k = solve.write_luminance(np.load(os.path.join(self.folder(uid), "pixels.npy"), mmap_mode="r"), path, full)
            result = solve.solve(path, self.scratch, hint[0], hint[1], 0.0, solve.UPLOAD_TIMEOUT_S)
            cards = solve.rescale(result.cards, k)
            record = {"source": "astap", "at": now, "error": None, "seconds": round(result.seconds, 1)}
            solution = fits.wcs(cards)
            log.info("upload %s: plate solved (binned %d×, %s): RA %.4f Dec %.4f, %.3f\"/px (%.1f s)", uid, k,
                     "whole sky" if result.blind else "around the hint", solution.crval[0], solution.crval[1],
                     solution.pixel_scale_arcsec(), result.seconds)
        except solve.SolveError as e:
            cards, record = None, {"source": None, "at": now, "error": str(e)[:200], "seconds": round(e.seconds, 1)}
            log.info("upload %s: not plate solved: %s (%.1f s)", uid, e, e.seconds)
        finally:
            if os.path.exists(path):
                os.remove(path)
        self._set_solution(uid, cards, record)

    def _set_solution(self, uid: str, cards: dict | None, record: dict) -> None:
        with self.lock:
            meta = self.entries.get(uid)
            if meta is None:
                return  # deleted meanwhile
            meta = {**meta, "wcs": cards, "solve": record}
            self._save(meta)
            self.entries[uid] = meta

    def folder(self, uid: str) -> str:
        return os.path.join(self.root, uid)

    def _save(self, meta: dict, folder: str | None = None) -> None:
        folder = folder or self.folder(meta["id"])
        tmp = os.path.join(folder, ".meta.json")
        with open(tmp, "w") as f:
            json.dump(meta, f, separators=(",", ":"))
        os.replace(tmp, os.path.join(folder, "meta.json"))

    @staticmethod
    def public(meta: dict) -> dict:
        uid = meta["id"]
        return {"id": uid, "target": meta["target"], "title": meta["title"], "note": meta["note"],
                "createdAt": meta["createdAt"], "takenAt": meta["takenAt"], "published": meta["published"],
                "width": meta["width"], "height": meta["height"], "url": f"/uploads/{uid}.jpg",
                "smallUrl": f"/uploads/{uid}-small.jpg", "original": dict(meta["original"]), "imageKind": "upload",
                "solve": solve_state(meta)}

    def list(self) -> list[dict]:
        with self.lock:
            entries = [self.public(m) for m in self.entries.values()]
        return sorted(entries, key=lambda e: e["createdAt"], reverse=True)

    def get(self, uid: str) -> dict | None:
        with self.lock:
            meta = self.entries.get(uid)
            return self.public(meta) if meta else None

    def create(self, rfile, length: int, boundary: bytes) -> dict:
        """Stream a multipart upload to disk, convert it and keep it; UploadError on any problem."""
        if shutil.disk_usage(self.root).free < length + 2**30:
            raise UploadError(507, "not enough free space on the data volume")
        uid = secrets.token_hex(8)
        tmp = os.path.join(self.root, f".tmp-{uid}")
        os.makedirs(tmp)
        original = os.path.join(tmp, "original")
        handles = []

        def open_file(filename: str, content_type: str):
            handles.append(open(original, "wb"))
            return handles[-1]

        try:
            try:
                fields, upload = read_multipart(rfile, length, boundary, open_file)
            finally:
                for h in handles:
                    h.close()
            if upload is None or upload["bytes"] == 0:
                raise UploadError(400, "no file in the form (field \"file\")")
            parsed = parse_fields(fields, partial=False)
            if isinstance(parsed, str):
                raise UploadError(400, parsed)
            kind = sniff(original)
            if kind is None:
                raise UploadError(415, "not a JPEG, PNG, TIFF or FITS file")
            started = time.time()
            with self.convert_lock:
                meta = self._convert(uid, tmp, kind, original)
            meta.update(id=uid, target=parsed["target"], title=parsed.get("title"), note=parsed.get("note"),
                        createdAt=time.time(), published=False,
                        takenAt=parsed.get("takenAt") if parsed.get("takenAt") is not None else meta.get("takenAt"),
                        original={"filename": upload["filename"], "bytes": upload["bytes"],
                                  "contentType": CONTENT_TYPES[kind]})
            if "raHint" in parsed and "decHint" in parsed:
                meta["hint"] = [parsed["raHint"], parsed["decHint"]]
            self._save(meta, tmp)
            os.replace(tmp, self.folder(uid))
        except BaseException:
            shutil.rmtree(tmp, ignore_errors=True)
            raise
        with self.lock:
            self.entries[uid] = meta
        if not meta["wcs"] and self.scratch and solve.available():
            self.solve_queue.put(uid)
        log.info("upload %s: %s (%s, %.1f MB, %d×%d, %d-bit%s%s) for %s in %.1f s", uid, upload["filename"], kind,
                 upload["bytes"] / 1e6, meta["width"], meta["height"], meta["bitDepth"],
                 ", linear" if meta["linear"] else "", ", plate solved" if meta["wcs"] else "",
                 meta["target"], time.time() - started)
        return self.public(meta)

    @staticmethod
    def _convert(uid: str, folder: str, kind: str, original: str) -> dict:
        npy = os.path.join(folder, "pixels.npy")
        header: dict[str, str] = {}
        if kind == "fits":
            header = write_fits_pixels(original, npy)
        else:
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("error", Image.DecompressionBombWarning)
                    array = decode_tiff(original) if kind == "tiff" else _native(_rgb_layout(decode_pillow(original)))
            except UploadError:
                raise
            except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as e:
                raise UploadError(415, f"unreadable {kind.upper()}: {e}"[:200]) from None
            np.save(npy, array)
            del array
        pixels = np.load(npy, mmap_mode="r")
        meta = render(pixels, folder)
        del pixels
        numbers = fits_numbers(header) if header else {"integrationS": None, "frames": None, "takenAt": None}
        # The plate solve's hint: the FITS header's position (RA/DEC, OBJCTRA/OBJCTDEC), if any.
        ra, dec, _ = solve.frame_hints(header)
        return {**meta, **numbers, "wcs": fits.wcs_cards(header) if header else None,
                "hint": [ra, dec] if ra is not None and dec is not None else None}

    def update(self, uid: str, fields: dict) -> dict | None:
        with self.lock:
            meta = self.entries.get(uid)
            if meta is None:
                return None
            meta = {**meta, **fields}
            self._save(meta)
            self.entries[uid] = meta
            return self.public(meta)

    def delete(self, uid: str) -> bool:
        with self.lock:
            if self.entries.pop(uid, None) is None:
                return False
        # Renamed first, so a crash halfway never leaves a half-deleted upload that loads again.
        trash = os.path.join(self.root, f".tmp-{uid}")
        os.replace(self.folder(uid), trash)
        shutil.rmtree(trash, ignore_errors=True)
        return True

    def path(self, uid: str, name: str) -> str | None:
        with self.lock:
            if uid not in self.entries:
                return None
        return os.path.join(self.folder(uid), name)

    def original_info(self, uid: str) -> dict | None:
        with self.lock:
            meta = self.entries.get(uid)
            return dict(meta["original"]) if meta else None

    # --- Contract 1 ---------------------------------------------------------------------------

    def image(self, uid: str) -> dict | None:
        with self.lock:
            meta = self.entries.get(uid)
            if meta is None:
                return None
            meta = dict(meta)
        solution = fits.wcs(meta["wcs"]) if meta.get("wcs") else None
        return {
            "kind": "upload", "id": uid, "target": meta["target"], "title": meta["title"],
            "width": meta["width"], "height": meta["height"],
            "url": f"/uploads/{uid}.jpg", "smallUrl": f"/uploads/{uid}-small.jpg",
            "wcs": meta["wcs"], "rowsTopDown": True,
            "pixelScaleArcsec": round(solution.pixel_scale_arcsec(), 4) if solution else None,
            "solveSource": solve_state(meta)["source"] if solution else None,
            "histogram": meta["histogram"], "stats": meta["stats"],
            "takenAt": meta["takenAt"], "integrationS": meta.get("integrationS"), "frames": meta.get("frames"),
            "measurable": meta["bitDepth"] > 8,
        }

    def star(self, uid: str, x: float, y: float) -> dict | None:
        """Star measurement on the uploaded pixels (the mean of the colour planes)."""
        with self.lock:
            meta = self.entries.get(uid)
            if meta is None:
                return None
            meta = dict(meta)
        pixels = np.load(os.path.join(self.folder(uid), "pixels.npy"), mmap_mode="r")
        y0, y1, x0, x1 = measure.region_around(pixels.shape[:2], x, y)
        region = np.asarray(pixels[y0:y1, x0:x1], dtype=np.float32)
        if region.ndim == 3:
            region = region.mean(axis=2)
        solution = fits.wcs(meta["wcs"]) if meta.get("wcs") else None
        return measure.measure(region, x, y, origin=(x0, y0), saturation=SATURATION * meta["fullScale"],
                               scale_arcsec=solution.pixel_scale_arcsec() if solution else None,
                               linear=meta["linear"])
