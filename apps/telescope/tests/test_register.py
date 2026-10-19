"""Registration: transform estimates from star lists (python -m unittest discover -s tests)."""

import math
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import fits  # noqa: E402
import register  # noqa: E402


def similarity(angle_deg: float, scale: float, tx: float, ty: float) -> np.ndarray:
    a = math.radians(angle_deg)
    return np.array([[scale * math.cos(a), -scale * math.sin(a), tx], [scale * math.sin(a), scale * math.cos(a), ty], [0, 0, 1]])


def field(seed: int, n: int = 250, size: float = 1500.0):
    rng = np.random.default_rng(seed)
    return rng.uniform(20, size - 20, (n, 2)), rng


def observe(ref: np.ndarray, truth: np.ndarray, rng, lost: float = 0.15, spurious: float = 0.1, noise: float = 0.1):
    """The reference stars (brightest first) as another frame sees them: frame = truth⁻¹(ref) with
    position noise, some lost, some extra, the brightness order slightly shuffled."""
    frame = register.apply(np.linalg.inv(truth), ref) + rng.normal(0, noise, ref.shape)
    rank = np.arange(len(frame)) + rng.normal(0, 4, len(frame))
    keep = rng.random(len(frame)) > lost
    extra = rng.uniform(20, 1480, (int(spurious * len(frame)), 2))
    frame = np.vstack([frame[keep], extra])
    rank = np.concatenate([rank[keep], rng.uniform(0, len(ref), len(extra))])
    return frame[np.argsort(rank)]


def max_error(found: np.ndarray, truth: np.ndarray) -> float:
    grid = np.array([[x, y] for x in (0, 750, 1500) for y in (0, 750, 1500)], float)
    return float(np.max(np.hypot(*(register.apply(found, grid) - register.apply(truth, grid)).T)))


class RegisterTest(unittest.TestCase):
    def test_triangles_find_shift_and_rotation(self):
        ref, rng = field(1)
        truth = similarity(1.7, 1.0, 14.3, -7.8)
        result = register.register(observe(ref, truth, rng), ref)
        self.assertIsNotNone(result)
        self.assertLess(max_error(result.matrix, truth), 0.15)
        self.assertGreater(result.matches, 100)

    def test_triangles_find_meridian_flip(self):
        ref, rng = field(2)
        truth = similarity(180.4, 1.0, 1520.0, 1490.0)
        result = register.register(observe(ref, truth, rng), ref)
        self.assertIsNotNone(result)
        self.assertLess(max_error(result.matrix, truth), 0.15)

    def test_guess_is_refined_despite_outliers(self):
        ref, rng = field(3)
        truth = similarity(-0.4, 1.001, -22.0, 9.5)
        guess = similarity(-0.3, 1.0, -20.0, 11.0)  # a few pixels off, like a rough plate solve
        result = register.register(observe(ref, truth, rng, spurious=0.3), ref, guess)
        self.assertEqual(result.method, "wcs")
        self.assertLess(max_error(result.matrix, truth), 0.15)

    def test_unrelated_fields_do_not_match(self):
        ref, _ = field(4)
        other, _ = field(5)
        self.assertIsNone(register.register(other, ref))

    def test_wcs_guess_maps_through_the_sky(self):
        scale = 1.1575 / 3600
        ref = fits.Wcs((1504.5, 1504.5), (10.68, 41.27), ((-scale, 0.0), (0.0, scale)))
        t = math.radians(180.3)
        frame = fits.Wcs((1504.5, 1504.5), (10.684, 41.268),
                         ((-scale * math.cos(t), scale * math.sin(t)), (scale * math.sin(t), scale * math.cos(t))))
        matrix = register.wcs_guess(frame, ref, (1504, 1504), 2.0)
        # A plane pixel's sky position must land on the same sky position in the reference.
        p = np.array([[300.0, 1100.0]])
        ra, dec = frame.to_sky(p[:, 0] * 2 + 1.5, p[:, 1] * 2 + 1.5)
        x, y = ref.to_pixel(ra, dec)
        expected = np.column_stack([(x - 1.5) / 2, (y - 1.5) / 2])
        self.assertLess(float(np.hypot(*(register.apply(matrix, p) - expected).T)[0]), 0.05)


if __name__ == "__main__":
    unittest.main()
