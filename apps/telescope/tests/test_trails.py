"""Trail detection (trails.py) on synthetic superpixel planes: a known line found with its ends
within a few pixels, a dashed one counted once, a faint one found, a dense star field and a wide
nebula-like band left alone. (python -m unittest discover -s tests)"""

import math
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import analysis  # noqa: E402
import trails  # noqa: E402

SIZE = 800
SKY, NOISE = 1000.0, 10.0
STAR_FWHM = 2.2  # plane pixels


def star_field(count: int, seed: int) -> np.ndarray:
    """Gaussian stars (pixel-integrated by 3×3 sub-samples) at random places, 5–300 σ."""
    rng = np.random.default_rng(seed)
    image = np.zeros((SIZE, SIZE))
    sigma = STAR_FWHM / 2.3548
    sub = (np.arange(3) - 1) / 3
    r = 6
    for x0, y0, amp in zip(rng.uniform(8, SIZE - 8, count), rng.uniform(8, SIZE - 8, count),
                           10 ** rng.uniform(np.log10(50), np.log10(3000), count)):
        ix, iy = int(x0), int(y0)
        ys, xs = np.mgrid[iy - r : iy + r + 1, ix - r : ix + r + 1]
        patch = sum(np.exp(-((xs + dx - x0) ** 2 + (ys + dy - y0) ** 2) / (2 * sigma**2)) for dx in sub for dy in sub) / 9
        image[iy - r : iy + r + 1, ix - r : ix + r + 1] += amp * patch
    return image


def line(x0: float, y0: float, x1: float, y1: float, amp: float, fwhm: float = STAR_FWHM,
         dashes: tuple[float, float] | None = None) -> np.ndarray:
    """A straight trail with a Gaussian profile across and sharp ends; `dashes` (on, off) lengths."""
    ys, xs = np.mgrid[0:SIZE, 0:SIZE].astype(np.float64)
    length = math.hypot(x1 - x0, y1 - y0)
    ux, uy = (x1 - x0) / length, (y1 - y0) / length
    t = (xs - x0) * ux + (ys - y0) * uy
    d = -(xs - x0) * uy + (ys - y0) * ux
    on = (t >= 0) & (t <= length)
    if dashes:
        on &= (t % (dashes[0] + dashes[1])) < dashes[0]
    return amp * np.exp(-(d**2) / (2 * (fwhm / 2.3548) ** 2)) * on


def planes(signal: np.ndarray, seed: int) -> list[np.ndarray]:
    rng = np.random.default_rng(seed + 100)
    return [(SKY + signal + rng.normal(0, NOISE, signal.shape)).astype(np.float32) for _ in range(3)]


def detect(signal: np.ndarray, seed: int = 0) -> list[dict]:
    p = planes(signal, seed)
    return trails.detect(p, [analysis.background(x) for x in p], STAR_FWHM)


def end_error(found: dict, x0: float, y0: float, x1: float, y1: float) -> float:
    a = max(math.hypot(found["x0"] - x0, found["y0"] - y0), math.hypot(found["x1"] - x1, found["y1"] - y1))
    b = max(math.hypot(found["x0"] - x1, found["y0"] - y1), math.hypot(found["x1"] - x0, found["y1"] - y0))
    return min(a, b)


class TrailsTest(unittest.TestCase):
    def test_line_found_with_its_ends(self):
        stars = star_field(1500, 1)
        found = detect(stars + line(150.0, 210.0, 640.0, 530.0, amp=40.0))
        self.assertEqual(len(found), 1, found)
        self.assertLess(end_error(found[0], 150.0, 210.0, 640.0, 530.0), 6.0, found)
        self.assertLess(found[0]["widthPx"], 2 * STAR_FWHM)

    def test_dashed_line_is_one_trail(self):
        found = detect(star_field(1000, 2) + line(80.0, 700.0, 720.0, 120.0, amp=60.0, dashes=(30.0, 25.0)))
        self.assertEqual(len(found), 1, found)
        self.assertLess(end_error(found[0], 80.0, 700.0, 720.0, 120.0), 30.0, found)

    def test_faint_line_found(self):
        # 1.2 σ per plane pixel on each of the three planes, below the bright pieces' threshold: found
        # once, on the line, along most of it (its faint ends may be cut short).
        found = detect(star_field(800, 3) + line(100.0, 100.0, 700.0, 650.0, amp=12.0))
        self.assertEqual(len(found), 1, found)
        f = found[0]
        for x, y in ((f["x0"], f["y0"]), (f["x1"], f["y1"])):
            self.assertLess(abs(-(x - 100.0) * 550.0 + (y - 100.0) * 600.0) / math.hypot(600.0, 550.0), 3.0, found)
        self.assertGreater(math.hypot(f["x1"] - f["x0"], f["y1"] - f["y0"]), 0.7 * math.hypot(600.0, 550.0), found)

    def test_star_field_has_no_trails(self):
        for seed in (4, 5, 6):
            self.assertEqual(detect(star_field(2500, seed), seed), [])

    def test_wide_band_is_not_a_trail(self):
        # A straight nebula filament: four times as wide as the stars.
        self.assertEqual(detect(star_field(1500, 7) + line(100.0, 400.0, 700.0, 380.0, amp=25.0, fwhm=4 * STAR_FWHM), 7), [])

    def test_crossing_lines_are_two(self):
        found = detect(star_field(1000, 8) + line(60.0, 100.0, 740.0, 700.0, amp=50.0) + line(60.0, 650.0, 740.0, 150.0, amp=50.0))
        self.assertEqual(len(found), 2, found)


if __name__ == "__main__":
    unittest.main()
