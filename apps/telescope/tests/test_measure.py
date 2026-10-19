"""Star measurement (measure.py) on synthetic, pixel-integrated PSFs with noise: FWHM within 5 %,
centroid, elongation and its angle, saturation, nothing found on empty sky.
(python -m unittest discover -s tests)"""

import math
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import measure  # noqa: E402


def star(kind: str, fwhm: float, elongation: float = 0.0, angle: float = 0.0, x0: float = 60.3, y0: float = 59.6,
         amp: float = 3000.0, bg: float = 1000.0, noise: float = 10.0, n: int = 121, seed: int = 0) -> np.ndarray:
    """One star, integrated over each pixel (5×5 sub-samples), FWHM = √(major·minor); `angle` is the
    major axis, clockwise from +x on the screen (rows go down)."""
    ss = 5
    g = (np.arange(n * ss) + 0.5) / ss - 0.5
    x, y = np.meshgrid(g, g)
    t = math.radians(angle)
    u = (x - x0) * math.cos(t) + (y - y0) * math.sin(t)
    v = -(x - x0) * math.sin(t) + (y - y0) * math.cos(t)
    ratio = 1 - elongation
    major, minor = fwhm / math.sqrt(ratio), fwhm * math.sqrt(ratio)
    if kind == "gauss":
        image = np.exp(-0.5 * ((u / (major / 2.3548)) ** 2 + (v / (minor / 2.3548)) ** 2))
    else:  # Moffat, β = 2.5
        k = 2 ** (1 / 2.5) - 1
        image = (1 + k * ((2 * u / major) ** 2 + (2 * v / minor) ** 2)) ** -2.5
    image = image.reshape(n, ss, n, ss).mean(axis=(1, 3))
    rng = np.random.default_rng(seed)
    return (bg + amp * image / image.max() + rng.normal(0, noise, (n, n))).astype(np.float32)


class MeasureTest(unittest.TestCase):
    def test_fwhm_within_five_percent(self):
        for kind in ("gauss", "moffat"):
            for fwhm in (2.2, 3.0, 4.5, 7.0, 10.0):
                with self.subTest(kind=kind, fwhm=fwhm):
                    r = measure.measure(star(kind, fwhm), 57, 63, saturation=60000, scale_arcsec=2.0)
                    self.assertTrue(r["found"])
                    self.assertLess(abs(r["fwhmPx"] - fwhm) / fwhm, 0.05)
                    self.assertAlmostEqual(r["fwhmArcsec"], r["fwhmPx"] * 2.0, places=2)
                    self.assertLess(math.hypot(r["x"] - 60.3, r["y"] - 59.6), 0.1)
                    self.assertLess(r["elongation"], 0.05)
                    self.assertFalse(r["saturated"])

    def test_elongated_star_and_its_angle(self):
        r = measure.measure(star("moffat", 4.0, elongation=0.3, angle=35), 60, 60, saturation=60000)
        self.assertLess(abs(r["fwhmPx"] - 4.0) / 4.0, 0.05)
        self.assertAlmostEqual(r["elongation"], 0.3, delta=0.03)
        self.assertAlmostEqual(r["angleDeg"], 35, delta=3)
        self.assertIsNone(r["fwhmArcsec"])

    def test_hfr_snr_profile_and_background(self):
        r = measure.measure(star("gauss", 4.0), 60, 60, saturation=60000, linear=False)
        sigma = 4.0 / 2.3548
        self.assertAlmostEqual(r["hfrPx"], sigma * math.sqrt(math.pi / 2), delta=0.15)  # flux-weighted mean radius
        self.assertAlmostEqual(r["background"], 1000, delta=3)
        self.assertGreater(r["snr"], 100)
        self.assertFalse(r["linear"])
        radii = [p[0] for p in r["profile"]]
        self.assertEqual(radii, sorted(radii))
        self.assertGreaterEqual(radii[-1], 8)
        self.assertGreater(r["profile"][0][1], r["profile"][-1][1])

    def test_offset_region_and_the_brightest_star_near_the_click(self):
        image = star("gauss", 3.0, x0=60.3, y0=59.6, amp=800) + star("gauss", 3.0, x0=68.0, y0=62.0, amp=4000, seed=1) - 1000
        region = image[20:110, 30:120]
        r = measure.measure(region, 61, 60, origin=(30, 20), saturation=60000)
        self.assertLess(math.hypot(r["x"] - 68.0, r["y"] - 62.0), 0.1)

    def test_saturated_star_still_measured(self):
        image = np.minimum(star("moffat", 4.0, amp=80000), 65535)
        r = measure.measure(image, 60, 60, saturation=60000)
        self.assertTrue(r["saturated"])
        self.assertLess(abs(r["fwhmPx"] - 4.0) / 4.0, 0.1)

    def test_empty_sky_and_no_data(self):
        rng = np.random.default_rng(3)
        sky = (1000 + rng.normal(0, 10, (121, 121))).astype(np.float32)
        self.assertFalse(measure.measure(sky, 60, 60, saturation=60000)["found"])
        self.assertFalse(measure.measure(np.full((121, 121), np.nan, np.float32), 60, 60, saturation=60000)["found"])
        self.assertFalse(measure.measure(sky, 500, 60, saturation=60000)["found"])

    def test_nan_edge_is_tolerated(self):
        image = star("gauss", 3.5)
        image[:, :40] = np.nan  # no frame covers the left of the stack
        r = measure.measure(image, 60, 60, saturation=60000)
        self.assertTrue(r["found"])
        self.assertLess(abs(r["fwhmPx"] - 3.5) / 3.5, 0.05)


if __name__ == "__main__":
    unittest.main()
