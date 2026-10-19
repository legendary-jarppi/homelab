"""Own uploads (uploads.py): the streamed multipart parser, 16-bit TIFF and FITS-with-WCS uploads
round-tripping into display JPEGs, metadata, star measurement, edits, delete, reload.
(python -m unittest discover -s tests)"""

import io
import json
import os
import sys
import tempfile
import unittest

import numpy as np
import tifffile
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import fits  # noqa: E402
import uploads  # noqa: E402

BOUNDARY = b"----r4boundary"


def form(fields: dict, filename: str, content: bytes) -> bytes:
    parts = []
    for name, value in fields.items():
        parts.append(b"--" + BOUNDARY + b'\r\nContent-Disposition: form-data; name="' + name.encode() + b'"\r\n\r\n'
                     + value.encode() + b"\r\n")
    parts.append(b"--" + BOUNDARY + b'\r\nContent-Disposition: form-data; name="file"; filename="' + filename.encode()
                 + b'"\r\nContent-Type: application/octet-stream\r\n\r\n' + content + b"\r\n")
    return b"".join(parts) + b"--" + BOUNDARY + b"--\r\n"


class Trickle(io.BytesIO):
    """Returns at most 7 bytes per read, so delimiters straddle chunk edges."""

    def read(self, n=-1):
        return super().read(min(n, 7) if n and n > 0 else 7)


def starfield(height: int, width: int, peak: float, bg: float, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    image = np.full((height, width), bg, np.float64)
    gy, gx = np.mgrid[0:height, 0:width]
    for x, y in rng.uniform(20, [width - 20, height - 20], (25, 2)):
        image += peak * np.exp(-((gx - x) ** 2 + (gy - y) ** 2) / (2 * 1.5**2))
    image[60, 80] = bg  # a star placed exactly below
    image += peak * np.exp(-((gx - 80.4) ** 2 + (gy - 60.2) ** 2) / (2 * 1.5**2))
    return image + rng.normal(0, bg * 0.02 + 1, image.shape)


class MultipartTest(unittest.TestCase):
    def test_fields_and_file_across_chunk_edges(self):
        content = b"\r\n--" + b"x" * 5000 + b"\r\n----r4boundar" + bytes(range(256)) * 10
        body = form({"target": "NGC 7000", "title": "Pelican", "note": "ä ö"}, "pelican.tif", content)
        out = io.BytesIO()
        fields, info = uploads.read_multipart(Trickle(body), len(body), BOUNDARY, lambda name, kind: out)
        self.assertEqual(fields, {"target": "NGC 7000", "title": "Pelican", "note": "ä ö"})
        self.assertEqual(out.getvalue(), content)
        self.assertEqual(info, {"filename": "pelican.tif", "contentType": "application/octet-stream",
                                "bytes": len(content)})

    def test_file_over_the_limit(self):
        body = form({"target": "M 31"}, "big.fits", b"y" * 2000)
        with self.assertRaises(uploads.UploadError) as e:
            uploads.read_multipart(io.BytesIO(body), len(body), BOUNDARY, lambda *_: io.BytesIO(), max_file=1000)
        self.assertEqual(e.exception.status, 413)

    def test_truncated_body(self):
        body = form({"target": "M 31"}, "a.png", b"z" * 100)
        with self.assertRaises(uploads.UploadError):
            uploads.read_multipart(io.BytesIO(body[:-60]), len(body), BOUNDARY, lambda *_: io.BytesIO())


class UploadsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = uploads.Uploads(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def create(self, fields: dict, filename: str, content: bytes) -> dict:
        body = form(fields, filename, content)
        return self.store.create(io.BytesIO(body), len(body), BOUNDARY)

    def test_16_bit_tiff(self):
        mono = np.clip(starfield(160, 200, 20000, 9000), 0, 65535)
        rgb = np.stack([mono, mono * 0.9, mono * 0.8], axis=-1).astype(np.uint16)
        buf = io.BytesIO()
        tifffile.imwrite(buf, rgb, photometric="rgb", compression="zlib")
        entry = self.create({"target": "NGC 7000", "title": "Pelican", "takenAt": "2026-10-17"}, "pelican.tif",
                            buf.getvalue())
        self.assertEqual((entry["width"], entry["height"], entry["imageKind"]), (200, 160, "upload"))
        self.assertEqual(entry["original"]["contentType"], "image/tiff")
        self.assertEqual(entry["takenAt"], 1792195200.0)
        self.assertFalse(entry["published"])
        folder = self.store.folder(entry["id"])
        with open(os.path.join(folder, "original"), "rb") as f:
            self.assertEqual(f.read(), buf.getvalue())
        with Image.open(os.path.join(folder, "display.jpg")) as image:
            self.assertEqual((image.size, image.mode), ((200, 160), "RGB"))
        np.testing.assert_array_equal(np.load(os.path.join(folder, "pixels.npy")), rgb)
        meta = self.store.image(entry["id"])
        self.assertTrue(meta["measurable"])
        self.assertIsNone(meta["wcs"])
        self.assertEqual(sum(meta["histogram"]["r"]), 160 * 200)
        self.assertAlmostEqual(meta["stats"]["r"]["median"], 9000 / 65535, delta=0.01)
        star = self.store.star(entry["id"], 81, 59)
        self.assertTrue(star["found"])
        self.assertLess(abs(star["x"] - 80.4) + abs(star["y"] - 60.2), 0.2)
        self.assertAlmostEqual(star["fwhmPx"], 1.5 * 2.3548, delta=0.2)
        self.assertFalse(star["linear"])  # background at 14 % of full scale: a stretched export

    def test_fits_with_wcs_and_sip(self):
        data = starfield(120, 150, 3000, 100).astype(np.float32)
        cards = {"CTYPE1": "RA---TAN-SIP", "CTYPE2": "DEC--TAN-SIP", "CRVAL1": 344.2, "CRVAL2": 62.62,
                 "CRPIX1": 75.5, "CRPIX2": 60.5, "CD1_1": -0.000643, "CD1_2": 0.0, "CD2_1": 0.0, "CD2_2": 0.000643,
                 "A_ORDER": 2, "B_ORDER": 2, "A_2_0": 1.5e-6, "B_0_2": -2e-6, "EXPTIME": 14400.0, "NCOMBINE": 48,
                 "DATE-OBS": "2026-10-17T20:30:00"}
        with tempfile.NamedTemporaryFile(suffix=".fits") as f:
            fits.write_float(f.name, data, cards)
            with open(f.name, "rb") as written:
                content = written.read()
        entry = self.create({"target": "C 9", "note": "Siril"}, "c9.fits", content)
        meta = self.store.image(entry["id"])
        self.assertEqual(meta["wcs"]["CTYPE1"], "RA---TAN-SIP")
        self.assertEqual(meta["wcs"]["A_ORDER"], 2)
        self.assertAlmostEqual(meta["wcs"]["A_2_0"], 1.5e-6)
        self.assertAlmostEqual(meta["wcs"]["CRPIX1"], 75.5)
        self.assertAlmostEqual(meta["pixelScaleArcsec"], 0.000643 * 3600, places=3)
        self.assertEqual((meta["integrationS"], meta["frames"]), (14400, 48))
        self.assertEqual(entry["takenAt"], 1792269000.0)  # DATE-OBS without a takenAt field
        star = self.store.star(entry["id"], 80, 60)
        self.assertTrue(star["linear"])  # background at ~3 % of the data range: a linear stack
        self.assertIsNotNone(star["fwhmArcsec"])

    def test_edit_delete_and_reload(self):
        png = io.BytesIO()
        Image.fromarray(np.clip(starfield(80, 90, 150, 30), 0, 255).astype(np.uint8)).save(png, format="PNG")
        entry = self.create({"target": "M 31"}, "m31.png", png.getvalue())
        self.assertFalse(self.store.image(entry["id"])["measurable"])  # 8 bits: stretched only
        fields = uploads.parse_fields({"published": True, "title": " Andromeda ", "takenAt": None}, partial=True)
        updated = self.store.update(entry["id"], fields)
        self.assertEqual((updated["published"], updated["title"], updated["takenAt"]), (True, "Andromeda", None))
        self.assertIsInstance(uploads.parse_fields({"published": "yes"}, partial=True), str)
        self.assertIsInstance(uploads.parse_fields({"target": "bad/target"}, partial=True), str)
        reloaded = uploads.Uploads(self.tmp.name)
        self.assertEqual(reloaded.list(), self.store.list())
        with open(os.path.join(self.store.folder(entry["id"]), "meta.json")) as f:
            self.assertTrue(json.load(f)["published"])
        self.assertTrue(reloaded.delete(entry["id"]))
        self.assertEqual(uploads.Uploads(self.tmp.name).list(), [])

    def test_not_an_image(self):
        with self.assertRaises(uploads.UploadError) as e:
            self.create({"target": "M 31"}, "notes.txt", b"hello world, not an image")
        self.assertEqual(e.exception.status, 415)
        self.assertEqual(os.listdir(self.store.root), [])


if __name__ == "__main__":
    unittest.main()
