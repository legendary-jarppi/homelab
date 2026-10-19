"""Stack combine with per-pixel outlier rejection (python -m unittest discover -s tests)."""

import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import stacking  # noqa: E402


class CombineTest(unittest.TestCase):
    def frames(self, n: int, seed: int = 0):
        rng = np.random.default_rng(seed)
        signal = rng.uniform(0, 200, (40, 50, 3)).astype(np.float32)
        return signal, [(signal + rng.normal(0, 10, signal.shape)).astype(np.float16) for _ in range(n)]

    def test_outlier_pixel_rejected(self):
        signal, frames = self.frames(12)
        frames[5][10, 20, :] = 5000  # satellite / hot pixel in one frame
        frames[7][30, 5, 1] = -800  # a dead value
        mean, rejected = stacking.combine(frames, np.array([10, 10, 10]))
        self.assertLess(abs(mean[10, 20, 0] - signal[10, 20, 0]), 15)
        self.assertLess(abs(mean[30, 5, 1] - signal[30, 5, 1]), 15)
        self.assertGreater(rejected[10, 20, 0], 0)
        # Ordinary noise is kept: almost nothing else rejected, and the mean is close to the signal.
        self.assertLess(float(np.mean(rejected)), 0.01)
        self.assertLess(float(np.std(mean - signal)), 10 / np.sqrt(12) * 1.3)

    def test_missing_coverage(self):
        signal, frames = self.frames(6, seed=1)
        for f in frames[:3]:
            f[:, :10] = np.nan  # outside these frames after warping
        for f in frames:
            f[0, 0] = np.nan
        mean, _ = stacking.combine(frames, np.array([10, 10, 10]))
        self.assertTrue(np.isnan(mean[0, 0]).all())
        self.assertFalse(np.isnan(mean[1:, :]).any())
        self.assertLess(float(np.abs(mean[5, 3] - signal[5, 3]).max()), 25)

    def test_few_frames_plain_mean(self):
        _, frames = self.frames(2)
        frames[0][3, 3] = 4000
        mean, _ = stacking.combine(frames, np.array([10, 10, 10]))
        expected = (frames[0][3, 3].astype(np.float32) + frames[1][3, 3].astype(np.float32)) / 2
        np.testing.assert_allclose(mean[3, 3], expected, rtol=1e-3)

    def test_small_bands_same_result(self):
        _, frames = self.frames(8, seed=2)
        full, _ = stacking.combine(frames, np.array([10, 10, 10]))
        old = stacking.BAND_BYTES
        stacking.BAND_BYTES = 1
        try:
            banded, _ = stacking.combine(frames, np.array([10, 10, 10]))
        finally:
            stacking.BAND_BYTES = old
        np.testing.assert_allclose(full, banded)


if __name__ == "__main__":
    unittest.main()
