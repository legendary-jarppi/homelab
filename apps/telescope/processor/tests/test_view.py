"""The viewer's data for finals: the plate solve moved to the crop, stars measured on synthetic PSFs
(through the crop, on a mapped FITS), the histogram, and the gallery fields of the records
(published/title/note persisted, every version kept)."""

import json
import math
import os
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import fitsio  # noqa: E402
import imaging  # noqa: E402
import measure  # noqa: E402
import view  # noqa: E402
from finals import Finals  # noqa: E402

RA0, DEC0 = 344.15, 62.45
SCALE = 3.75e-4  # degrees per pixel (1.35″)


def write_float_fits(path: str, data: np.ndarray, cards: list[tuple[str, object]]) -> None:
    """A Siril-like 32-bit float FITS: (planes, height, width), the cards after the axes."""
    lines = [("SIMPLE", True), ("BITPIX", -32), ("NAXIS", 3), ("NAXIS1", data.shape[2]), ("NAXIS2", data.shape[1]),
             ("NAXIS3", data.shape[0])] + cards
    text = ""
    for key, value in lines:
        if isinstance(value, bool):
            v = f"{'T' if value else 'F':>20}"
        elif isinstance(value, (int, float)):
            v = f"{value!r:>20}"
        else:
            v = f"{chr(39) + value + chr(39):<20}"
        text += f"{key:<8}= {v}".ljust(80)
    text += "END".ljust(80)
    text += " " * (-len(text) % 2880)
    body = np.ascontiguousarray(data, ">f4").tobytes()
    with open(path, "wb") as f:
        f.write(text.encode())
        f.write(body)
        f.write(b"\0" * (-len(body) % 2880))


def wcs_cards(crpix: tuple[float, float], angle: float, sip: bool = True) -> list[tuple[str, object]]:
    t = math.radians(angle)
    cd = SCALE * np.array([[-math.cos(t), math.sin(t)], [math.sin(t), math.cos(t)]])
    cards = [("CTYPE1", "RA---TAN-SIP" if sip else "RA---TAN"), ("CTYPE2", "DEC--TAN-SIP" if sip else "DEC--TAN"),
             ("CRVAL1", RA0), ("CRVAL2", DEC0), ("CRPIX1", crpix[0]), ("CRPIX2", crpix[1]),
             ("CD1_1", float(cd[0, 0])), ("CD1_2", float(cd[0, 1])), ("CD2_1", float(cd[1, 0])), ("CD2_2", float(cd[1, 1]))]
    if sip:
        cards += [("A_ORDER", 2), ("A_2_0", 2e-6), ("A_1_1", -1e-6), ("A_0_2", 5e-7),
                  ("B_ORDER", 2), ("B_2_0", -8e-7), ("B_1_1", 1.5e-6), ("B_0_2", 3e-6)]
    return cards


def to_sky(wcs: dict, x: float, y: float) -> tuple[float, float]:
    """TAN-SIP, as the web app evaluates it: 1-based FITS pixel → RA/Dec (degrees)."""
    u, v = x - wcs["CRPIX1"], y - wcs["CRPIX2"]
    du = sum(val * u ** int(k.split("_")[1]) * v ** int(k.split("_")[2]) for k, val in wcs.items()
             if k.startswith("A_") and k != "A_ORDER")
    dv = sum(val * u ** int(k.split("_")[1]) * v ** int(k.split("_")[2]) for k, val in wcs.items()
             if k.startswith("B_") and k != "B_ORDER")
    xi = math.radians(wcs["CD1_1"] * (u + du) + wcs["CD1_2"] * (v + dv))
    eta = math.radians(wcs["CD2_1"] * (u + du) + wcs["CD2_2"] * (v + dv))
    a0, d0 = math.radians(wcs["CRVAL1"]), math.radians(wcs["CRVAL2"])
    ra = a0 + math.atan2(xi, math.cos(d0) - eta * math.sin(d0))
    dec = math.atan2(math.sin(d0) + eta * math.cos(d0), math.hypot(xi, math.cos(d0) - eta * math.sin(d0)))
    return math.degrees(ra) % 360, math.degrees(dec)


def gaussian(shape, x0, y0, fwhm_major, fwhm_minor, angle_deg, amp, sub=5):
    """An elliptical Gaussian integrated over each pixel (sub × sub samples); `angle_deg` the major
    axis clockwise from +x on the screen (rows down)."""
    yy, xx = np.mgrid[0 : shape[0], 0 : shape[1]].astype(np.float64)
    s1, s2 = fwhm_major / 2.3548, fwhm_minor / 2.3548
    t = math.radians(angle_deg)
    out = np.zeros(shape)
    offsets = (np.arange(sub) + 0.5) / sub - 0.5
    for oy in offsets:
        for ox in offsets:
            dx, dy = xx + ox - x0, yy + oy - y0
            u, v = dx * math.cos(t) + dy * math.sin(t), -dx * math.sin(t) + dy * math.cos(t)
            out += np.exp(-0.5 * ((u / s1) ** 2 + (v / s2) ** 2))
    return amp * out / sub**2


class CropWcsTest(unittest.TestCase):
    def test_crop_keeps_the_sky(self):
        """A -maximize-like canvas with empty corners: cut to the covered area, the cropped WCS
        gives every pixel the sky it had in the full stack, and a star put at a sky position is
        measured where the cropped WCS says (display px = FITS px − 1, rows top-down)."""
        h, w = 260, 300
        rng = np.random.default_rng(1)
        data = (0.02 + rng.normal(0, 0.0005, (3, h, w))).astype(np.float32)
        data[:, :37, :] = 0
        data[:, :, :21] = 0
        data[:, h - 15 :, :] = 0
        cards = wcs_cards((151.3, 128.7), 27.0)
        full_wcs = view.crop_wcs(dict((k, str(v)) for k, v in cards), 0, 0)
        # A star at a sky position: where the full WCS puts it (0-based array column/row).
        ra, dec = to_sky(full_wcs, 180.4, 140.6)
        px, py = 180.4 - 1, 140.6 - 1
        data += gaussian((h, w), px, py, 3.2, 3.2, 0, 0.3).astype(np.float32)[None]
        with tempfile.TemporaryDirectory() as d:
            src, dst = os.path.join(d, "linear.fits"), os.path.join(d, "cropped.fits")
            write_float_fits(src, data, cards)
            x0, y0, cw, ch, fw, fh = imaging.crop_to_coverage(src, dst)
            self.assertEqual((fw, fh), (w, h))
            self.assertTrue(x0 >= 21 and y0 >= 37 and y0 + ch <= h - 15)
            header, _ = fitsio.read_header(src)
            wcs = view.crop_wcs(header, x0, y0)
            cropped_header, _ = fitsio.read_header(dst)
            self.assertAlmostEqual(wcs["CRPIX1"], float(cropped_header["CRPIX1"]), places=5)
            self.assertAlmostEqual(wcs["CRPIX2"], float(cropped_header["CRPIX2"]), places=5)
            self.assertEqual(wcs["A_ORDER"], 2)
            self.assertEqual(wcs["B_1_1"], 1.5e-6)
            self.assertTrue(wcs["CTYPE1"].endswith("-SIP"))
            for xd, yd in ((0, 0), (cw - 1, 0), (17.25, ch - 1.5), (cw / 2, ch / 3)):
                a = to_sky(wcs, xd + 1, yd + 1)
                b = to_sky(full_wcs, x0 + xd + 1, y0 + yd + 1)
                self.assertAlmostEqual(a[0], b[0], places=9)
                self.assertAlmostEqual(a[1], b[1], places=9)
            # The star in display pixels of the processed image, measured through the crop.
            crop = {"x": x0, "y": y0, "width": cw, "height": ch}
            got = view.star(fitsio.open_float(src), crop, px - x0 + 2.0, py - y0 - 1.5, view.pixel_scale(wcs))
            self.assertTrue(got["found"])
            self.assertAlmostEqual(got["x"], px - x0, delta=0.05)
            self.assertAlmostEqual(got["y"], py - y0, delta=0.05)
            sky = to_sky(wcs, got["x"] + 1, got["y"] + 1)
            self.assertLess(math.hypot((sky[0] - ra) * math.cos(math.radians(dec)), sky[1] - dec) * 3600, 0.1)
            self.assertAlmostEqual(got["fwhmPx"], 3.2, delta=0.1)
            self.assertAlmostEqual(got["fwhmArcsec"], 3.2 * SCALE * 3600, delta=0.15)
            self.assertFalse(view.star(fitsio.open_float(src), crop, cw + 3, 10, None)["found"])

    def test_cdelt_pc_and_crota(self):
        cards = dict((k, str(v)) for k, v in wcs_cards((100.5, 80.25), 33.0, sip=False))
        reference = view.crop_wcs(cards, 10, 20)
        t = math.radians(33.0)
        pc = {"CDELT1": -SCALE, "CDELT2": SCALE, "PC1_1": math.cos(t), "PC1_2": -math.sin(t),
              "PC2_1": math.sin(t), "PC2_2": math.cos(t)}
        crota = {"CDELT1": -SCALE, "CDELT2": SCALE, "CROTA2": -33.0}
        for extra in (pc, crota):
            header = {k: v for k, v in cards.items() if not k.startswith("CD")} | {k: str(v) for k, v in extra.items()}
            got = view.crop_wcs(header, 10, 20)
            for key in ("CD1_1", "CD1_2", "CD2_1", "CD2_2"):
                self.assertAlmostEqual(got[key] / SCALE, reference[key] / SCALE, places=9, msg=f"{extra} {key}")
            self.assertEqual((got["CRPIX1"], got["CRPIX2"]), (90.5, 60.25))
        self.assertAlmostEqual(view.pixel_scale(reference), SCALE * 3600, places=3)
        self.assertIsNone(view.crop_wcs({"NAXIS": "3"}, 0, 0))
        named = dict(cards, CTYPE1="RA---TAN-SIP", CTYPE2="DEC--TAN-SIP")
        self.assertEqual(view.crop_wcs(named, 0, 0)["CTYPE1"], "RA---TAN")  # SIP named, no terms


class StarTest(unittest.TestCase):
    """measure.py (shared with the telescope service) on synthetic PSFs, as the processor calls it."""

    def sky(self, shape=(121, 121), seed=3):
        return 0.01 + np.random.default_rng(seed).normal(0, 0.0004, shape)

    def test_round_gaussian(self):
        img = self.sky() + gaussian((121, 121), 60.3, 58.7, 3.0, 3.0, 0, 0.2)
        got = measure.measure(img, 63, 55, saturation=0.98, scale_arcsec=1.35)
        self.assertTrue(got["found"])
        self.assertAlmostEqual(got["x"], 60.3, delta=0.03)
        self.assertAlmostEqual(got["y"], 58.7, delta=0.03)
        self.assertAlmostEqual(got["fwhmPx"], 3.0, delta=0.09)
        self.assertAlmostEqual(got["fwhmArcsec"], got["fwhmPx"] * 1.35, delta=0.01)
        self.assertLess(got["elongation"], 0.03)
        # HFR (flux-weighted mean radius) of a Gaussian: σ·√(π/2).
        self.assertAlmostEqual(got["hfrPx"], 3.0 / 2.3548 * math.sqrt(math.pi / 2), delta=0.15)
        self.assertAlmostEqual(got["background"], 0.01, delta=0.0002)
        self.assertAlmostEqual(got["peak"], 0.21, delta=0.02)
        self.assertGreater(got["snr"], 200)
        self.assertFalse(got["saturated"])
        self.assertTrue(got["linear"])
        radii = [r for r, _ in got["profile"]]
        self.assertEqual(radii, sorted(radii))
        self.assertGreater(got["profile"][0][1], 10 * got["profile"][-1][1])

    def test_elongated_rotated(self):
        for angle in (20.0, 75.0, 140.0):
            img = self.sky() + gaussian((121, 121), 60.0, 61.0, 4.4, 3.3, angle, 0.3)
            got = measure.measure(img, 60, 61, saturation=0.98)
            self.assertAlmostEqual(got["fwhmPx"], math.sqrt(4.4 * 3.3), delta=0.12, msg=angle)
            self.assertAlmostEqual(got["elongation"], 1 - 3.3 / 4.4, delta=0.03, msg=angle)
            diff = (got["angleDeg"] - angle + 90) % 180 - 90
            self.assertLess(abs(diff), 3, msg=f"{angle}: {got['angleDeg']}")

    def test_saturated_and_brightest(self):
        img = self.sky() + gaussian((121, 121), 50.0, 50.0, 3.5, 3.5, 0, 3.0) + gaussian((121, 121), 58.0, 55.0, 3.0, 3.0, 0, 0.1)
        img = np.minimum(img, 1.0)
        got = measure.measure(img, 57, 55, saturation=0.98)  # nearer the faint one: the brightest wins
        self.assertAlmostEqual(got["x"], 50.0, delta=0.2)
        self.assertAlmostEqual(got["y"], 50.0, delta=0.2)
        self.assertTrue(got["saturated"])
        self.assertAlmostEqual(got["fwhmPx"], 3.5, delta=0.5)  # fitted from the wings

    def test_nothing_there(self):
        got = measure.measure(self.sky(), 60, 60, saturation=0.98)
        self.assertFalse(got["found"])


class HistogramTest(unittest.TestCase):
    def test_normalised(self):
        rng = np.random.default_rng(5)
        planes = np.stack([0.1 + rng.normal(0, 0.002, (200, 200)) * k for k in (1, 2, 3)]).astype(np.float32)
        planes[:, 100, 100] = [0.0, 0.5, 1.0]  # the data range: 0…1
        histogram, stats = view.histogram_stats(planes, step=1)
        self.assertEqual(histogram["bins"], 256)
        self.assertEqual((histogram["min"], histogram["max"]), (0.0, 1.0))
        for k, name in enumerate("rgb", 1):
            self.assertEqual(sum(histogram[name]), 200 * 200)
            self.assertEqual(int(np.argmax(histogram[name])), int(0.1 * 256))
            self.assertAlmostEqual(stats[name]["median"], 0.1, delta=0.001)
            self.assertAlmostEqual(stats[name]["noise"], 0.002 * k, delta=0.0002 * k)


class GalleryRecordsTest(unittest.TestCase):
    def make(self, data, keep=1):
        return Finals(data, None, None, None, keep, 0, 600)

    def test_publish_persists_and_versions_stay(self):
        with tempfile.TemporaryDirectory() as data:
            ids = ["20261018-120000-c-9", "20261019-120000-c-9", "20261020-120000-c-9"]
            for n, fid in enumerate(ids):
                folder = os.path.join(data, "finals", fid)
                os.makedirs(folder)
                files = ["linear.fits", "processed.tif", "full.jpg", "preview.jpg", "preview-small.jpg"]
                for name in files:
                    open(os.path.join(folder, name), "wb").close()
                with open(os.path.join(folder, "final.json"), "w") as f:
                    json.dump({"id": fid, "target": "C 9", "status": "done", "createdAt": 1000 + n, "finishedAt": 2000 + n,
                               "files": files, "frames": 10, "integrationS": 3000,
                               "view": {"crop": {"x": 3, "y": 4, "width": 10, "height": 8}, "wcs": None,
                                        "pixelScaleArcsec": 1.35, "histogram": None, "stats": None, "takenAt": 5}}, f)
            finals = self.make(data)
            self.assertFalse(finals.list()[0]["published"])  # records from before R4
            out = finals.update(ids[0], {"published": True, "title": "  Cave Nebula ", "note": ""})
            self.assertEqual((out["published"], out["title"], out["note"]), (True, "Cave Nebula", None))
            with self.assertRaises(ValueError):
                finals.update(ids[1], {"published": "yes"})
            with self.assertRaises(KeyError):
                finals.update("nope", {"title": "x"})
            finals.prune("C 9")
            again = {f["id"]: f for f in self.make(data).list()}  # as after a restart
            self.assertEqual(sorted(again), ids)  # every version kept
            self.assertEqual((again[ids[0]]["published"], again[ids[0]]["title"]), (True, "Cave Nebula"))
            self.assertIsNotNone(again[ids[0]]["outputs"]["linearFits"])  # published: everything stays
            self.assertIsNone(again[ids[1]]["outputs"]["linearFits"])  # older, unpublished: slimmed
            self.assertIsNotNone(again[ids[1]]["outputs"]["fullJpg"])
            self.assertFalse(os.path.exists(os.path.join(data, "finals", ids[1], "processed.tif")))
            self.assertIsNotNone(again[ids[2]]["outputs"]["linearFits"])  # the newest
            restarted = self.make(data)
            self.assertFalse(restarted.image(ids[1])["measurable"])
            self.assertIsNone(restarted.star(ids[1], 5, 5))
            image = restarted.image(ids[0])
            self.assertEqual((image["width"], image["height"], image["url"]), (10, 8, f"/finals/{ids[0]}/full.jpg"))
            self.assertTrue(image["measurable"] and image["rowsTopDown"])


if __name__ == "__main__":
    unittest.main()
