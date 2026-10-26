"""Tilt and backfocus inspection (tilt.py) on synthetic full-resolution star fields: FWHM per cell
within 7 % at the cells' centres, a left-right FWHM gradient found as tilt in the right direction, a
centre-to-corner rise as backfocus/curvature, a uniform field as fine, and elongation the same way
everywhere with its angle. (python -m unittest discover -s tests)"""

import math
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import tilt  # noqa: E402

SIZE = 1500
SKY, NOISE = 1000.0, 10.0


def field(fwhm_at, elongation: float = 0.0, angle: float = 0.0, seed: int = 0) -> np.ndarray:
    """Gaussian stars on a jittered 50 px grid, pixel-integrated (3×3 sub-samples), 50–500 σ;
    `fwhm_at(x, y)` gives the FWHM (camera px) at a place, `angle` the major axis (clockwise from +x
    on the screen)."""
    rng = np.random.default_rng(seed)
    image = np.full((SIZE, SIZE), SKY)
    sub = (np.arange(3) - 1) / 3
    r = 12
    t = math.radians(angle)
    ratio = 1 - elongation
    for gy in range(40, SIZE - 40, 50):
        for gx in range(40, SIZE - 40, 50):
            x0, y0 = gx + rng.uniform(-8, 8), gy + rng.uniform(-8, 8)
            fwhm = fwhm_at(x0, y0)
            major, minor = fwhm / math.sqrt(ratio) / 2.3548, fwhm * math.sqrt(ratio) / 2.3548
            ix, iy = int(x0), int(y0)
            ys, xs = np.mgrid[iy - r : iy + r + 1, ix - r : ix + r + 1].astype(np.float64)
            patch = 0.0
            for dx in sub:
                for dy in sub:
                    u = (xs + dx - x0) * math.cos(t) + (ys + dy - y0) * math.sin(t)
                    v = -(xs + dx - x0) * math.sin(t) + (ys + dy - y0) * math.cos(t)
                    patch = patch + np.exp(-0.5 * ((u / major) ** 2 + (v / minor) ** 2)) / 9
            image[iy - r : iy + r + 1, ix - r : ix + r + 1] += 10 ** rng.uniform(np.log10(500), np.log10(5000)) * patch
    image += rng.normal(0, NOISE, image.shape)
    return image.astype(np.float32)


def grid(image: np.ndarray) -> tuple[list[dict], dict]:
    cells = tilt.measure_grid(image, 1.0, 1.16)
    return cells, tilt.summarize(cells)


class TiltTest(unittest.TestCase):
    def test_left_right_gradient_is_tilt(self):
        fwhm_at = lambda x, y: 3.5 + 2.0 * x / SIZE  # noqa: E731 - right side softer
        cells, summary = grid(field(fwhm_at, seed=1))
        for c in cells:
            expected = fwhm_at((c["x0"] + c["x1"]) / 2, 0)
            self.assertLess(abs(c["fwhmPx"] - expected) / expected, 0.07, c)
            self.assertAlmostEqual(c["fwhmArcsec"], c["fwhmPx"] * 1.16, delta=0.02)
        self.assertGreater(summary["tiltPct"], tilt.TILT_BAD_PCT, summary)
        self.assertLess(summary["leftRightPct"], -20, summary)  # negative: the right side is larger
        self.assertLess(abs(summary["topBottomPct"]), 5, summary)
        self.assertIn(summary["worstCorner"], ("top right", "bottom right"))
        self.assertIn(summary["bestCorner"], ("top left", "bottom left"))
        self.assertEqual(summary["level"], "check")
        self.assertIn("Tilt", summary["verdict"])
        self.assertIn("right side", summary["verdict"])

    def test_uniform_field_is_fine(self):
        cells, summary = grid(field(lambda x, y: 4.0, seed=2))
        self.assertTrue(all(c["stars"] >= tilt.MIN_CELL_STARS for c in cells))
        self.assertLess(summary["tiltPct"], tilt.TILT_OK_PCT, summary)
        self.assertLess(abs(summary["curvaturePct"]), tilt.CURVATURE_OK_PCT, summary)
        self.assertFalse(summary["sameDirection"])
        self.assertEqual(summary["level"], "ok", summary)

    def test_soft_corners_are_backfocus_or_curvature(self):
        half = SIZE / 2
        cells, summary = grid(field(lambda x, y: 3.5 * (1 + 1.0 * ((x - half) ** 2 + (y - half) ** 2) / (2 * half**2)), seed=3))
        self.assertGreater(summary["curvaturePct"], tilt.CURVATURE_BAD_PCT, summary)
        self.assertLess(summary["tiltPct"], tilt.TILT_OK_PCT, summary)
        self.assertIn("backfocus", summary["verdict"])

    def test_elongated_the_same_way(self):
        cells, summary = grid(field(lambda x, y: 4.0, elongation=0.3, angle=40.0, seed=4))
        for c in cells:
            self.assertAlmostEqual(c["elongation"], 0.3, delta=0.05)
            self.assertLess(abs((c["angleDeg"] - 40.0 + 90) % 180 - 90), 5.0, c)
        self.assertTrue(summary["sameDirection"], summary)
        self.assertIn("tracking", summary["verdict"])

    def test_session_median_of_frames(self):
        a = [dict(c, fwhmPx=4.0, angleDeg=10.0, elongation=0.1) for c in tilt.measure_grid(field(lambda x, y: 4.0, seed=5), 1.0, None)]
        b = [dict(c, fwhmPx=6.0, angleDeg=30.0, elongation=0.3) for c in a]
        c = [dict(c, fwhmPx=5.0, angleDeg=20.0, elongation=0.2) for c in a]
        combined = tilt.combine([a, b, c])
        self.assertTrue(all(x["fwhmPx"] == 5.0 and x["elongation"] == 0.2 for x in combined))
        self.assertTrue(all(abs(x["angleDeg"] - 23.3) < 1.5 for x in combined))  # weighted by elongation
        self.assertEqual(combined[0]["stars"], 3 * a[0]["stars"])


if __name__ == "__main__":
    unittest.main()
