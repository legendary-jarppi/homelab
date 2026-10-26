"""Sky brightness and exposure advice (skyq.py): the zero point and sky magnitude of a synthetic frame
with known stars and sky, the D05 tile format and layout, read noise and dark current from synthetic
bias and dark frames, and the sub-length rule. (python -m unittest discover -s tests)"""

import math
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import fits  # noqa: E402
import skyq  # noqa: E402

SIZE = 700  # plane pixels
CAMERA_SCALE = 1.156  # ″ per camera pixel; the plane has 2 camera pixels per pixel
E_PER_ADU = 1.0056 / 4
EXPOSURE = 300.0
BIAS = 2796.0
ZERO_POINT = 18.5  # mag for 1 e-/s
SKY_MAG = 21.3  # mag/arcsec²
FWHM = 1.6  # plane pixels


class FakeCatalog:
    def __init__(self, ra, dec, mag):
        self.stars = (np.asarray(ra), np.asarray(dec), np.asarray(mag))

    def available(self):
        return True

    def around(self, ra, dec, radius):
        return self.stars


def camera_wcs() -> fits.Wcs:
    s = CAMERA_SCALE / 3600
    return fits.Wcs((SIZE + 0.5, SIZE + 0.5), (344.2, 62.6), ((-s, 0.0), (0.0, s)))


def synthetic_frame(seed: int = 1):
    """A green plane (ADU, bias included) with a flat sky of SKY_MAG and 150 Gaussian stars of known
    magnitudes at catalogue positions, read noise and shot noise; the stars' catalogue entries."""
    rng = np.random.default_rng(seed)
    plane_wcs = camera_wcs().plane(2.0)
    sky_eps = 10 ** (-0.4 * (SKY_MAG - ZERO_POINT)) * CAMERA_SCALE**2  # e-/s per camera pixel
    image = np.full((SIZE, SIZE), sky_eps * EXPOSURE)  # electrons per camera pixel (green plane units)
    xs, ys = rng.uniform(20, SIZE - 20, 150), rng.uniform(20, SIZE - 20, 150)
    mags = rng.uniform(10.5, 14.5, 150)
    sigma = FWHM / 2.3548
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    for x, y, m in zip(xs, ys, mags):
        total = 10 ** (-0.4 * (m - ZERO_POINT)) * EXPOSURE  # electrons over the whole star
        r = 12
        ix, iy = int(x), int(y)
        sl = (slice(iy - r, iy + r + 1), slice(ix - r, ix + r + 1))
        g = np.exp(-((xx[sl] - x) ** 2 + (yy[sl] - y) ** 2) / (2 * sigma**2))
        # A superpixel's value is a quarter of the star's electrons that fall on it (4 camera pixels).
        image[sl] += total / 4 * g / g.sum()
    image = rng.normal(image, np.sqrt(image / 2 + 1.2**2))  # two green pixels averaged
    plane = (image / E_PER_ADU + BIAS).astype(np.float32)
    ra, dec = plane_wcs.to_sky(xs + 1, ys + 1)
    return plane, sky_eps, FakeCatalog(ra, dec, mags)


HEADER = {"EXPTIME": "300.", "EGAIN": "1.00560426712036", "GAIN": "100", "OFFSET": "70"}
SENSOR = {"biasAdu": BIAS, "readNoiseE": 1.2}


class PhotometryTest(unittest.TestCase):
    def test_zero_point_and_sky_magnitude(self):
        plane, sky_eps, catalog = synthetic_frame()
        record = skyq.measure(plane, HEADER, camera_wcs(), 2.0, 4, SENSOR, catalog, FWHM)
        self.assertNotIn("error", record)
        self.assertGreaterEqual(record["stars"], 60)
        # The aperture (2.5 FWHM) holds all but ~0.1 % of a Gaussian.
        self.assertAlmostEqual(record["zeroPoint"], ZERO_POINT, delta=0.02)
        self.assertAlmostEqual(record["skyEps"], sky_eps, delta=sky_eps * 0.02)
        self.assertAlmostEqual(record["skyMag"], SKY_MAG, delta=0.03)

    def test_offset_solve_still_finds_the_stars(self):
        """The solve is linear (SIP left out): stars a pixel or two off are re-centred."""
        plane, _, catalog = synthetic_frame(2)
        w = camera_wcs()
        shifted = fits.Wcs((w.crpix[0] + 3.0, w.crpix[1] - 2.0), w.crval, w.cd)
        record = skyq.measure(plane, HEADER, shifted, 2.0, 4, SENSOR, catalog, FWHM)
        self.assertAlmostEqual(record["zeroPoint"], ZERO_POINT, delta=0.03)

    def test_missing_inputs(self):
        plane, _, catalog = synthetic_frame(3)
        self.assertEqual(skyq.measure(plane, HEADER, camera_wcs(), 2.0, 4, None, catalog, FWHM)["needs"], "sensor")
        unsolved = skyq.measure(plane, HEADER, None, 2.0, 4, SENSOR, catalog, FWHM)
        self.assertEqual(unsolved["needs"], "solve")
        self.assertIsNotNone(unsolved["skyEps"])
        empty = FakeCatalog([], [], [])
        self.assertIsNone(skyq.measure(plane, HEADER, camera_wcs(), 2.0, 4, SENSOR, empty, FWHM)["zeroPoint"])

    def test_sky_magnitude(self):
        # 1 e-/s per arcsec² is the zero point itself; 100× fainter is 5 mag fainter.
        self.assertAlmostEqual(skyq.sky_magnitude(18.0, 1.0, 1.0), 18.0)
        self.assertAlmostEqual(skyq.sky_magnitude(18.0, 0.04, 2.0), 23.0)


class CatalogTest(unittest.TestCase):
    def test_decode(self):
        header = b"GAIA DR3 test. Magnitude is BP".ljust(109) + bytes([5])
        # Group: Dec high byte 62 (stored + 128), magnitude 11.3 (stored × 10 + 16).
        group = bytes([255, 255, 255, 62 + 128, 113 + 16])
        ra_raw, dec_low = 0x7A_5C_3B, 0x1234
        star = bytes([ra_raw & 255, (ra_raw >> 8) & 255, ra_raw >> 16, dec_low & 255, dec_low >> 8])
        ra, dec, mag = skyq.Catalog.decode(header + group + star)
        self.assertAlmostEqual(ra[0], ra_raw * 360 / (2**24 - 1), places=9)
        self.assertAlmostEqual(dec[0], ((62 << 16) + dec_low) * 90 / (2**23 - 1), places=9)
        self.assertAlmostEqual(mag[0], 11.3)

    def test_tiles(self):
        self.assertEqual(len(skyq.RING_TILES), 36)
        self.assertEqual(sum(skyq.RING_TILES), 1476)
        # C 9's field (0.96° square) lies in ring 31 (61.7°–66.9°), tile 26 (333.3°–346.7°).
        self.assertEqual(skyq.Catalog.tiles_around(344.2, 62.6, 0.7), [(31, 26)])
        # Across RA 0h: both edge tiles of the ring.
        self.assertEqual(skyq.Catalog.tiles_around(0.1, 2.5, 0.5), [(19, 1), (19, 69)])
        # Near the pole: the cap and the next ring's tiles on both sides of 0h.
        self.assertEqual(skyq.Catalog.tiles_around(10.0, 88.0, 1.0), [(35, 1), (35, 3), (36, 1)])


class SensorTest(unittest.TestCase):
    def test_read_noise_and_dark_current(self):
        rng = np.random.default_rng(4)
        pattern = rng.normal(0, 3, (600, 600))  # fixed pattern: cancels in the difference
        read_adu = 4.7
        a = np.round((BIAS + pattern + rng.normal(0, read_adu, pattern.shape)) / 4) * 4
        b = np.round((BIAS + pattern + rng.normal(0, read_adu, pattern.shape)) / 4) * 4
        a[::50, ::50] += 3000  # hot pixels
        dark_eps = 0.01  # e-/s
        dark = BIAS + pattern + rng.normal(dark_eps * 180 / E_PER_ADU, read_adu, pattern.shape)
        record = skyq.sensor_noise(a, b, HEADER, dark, 180.0)
        self.assertEqual(record["aduStep"], 4)
        self.assertAlmostEqual(record["ePerAdu"], E_PER_ADU, places=4)
        # Rounding to steps of 4 adds 4/√12 ADU in quadrature.
        self.assertAlmostEqual(record["readNoiseAdu"], math.hypot(read_adu, 4 / math.sqrt(12)), delta=0.1)
        self.assertAlmostEqual(record["readNoiseE"], record["readNoiseAdu"] * E_PER_ADU, places=2)
        self.assertAlmostEqual(record["biasAdu"], BIAS, delta=0.5)
        self.assertAlmostEqual(record["darkCurrentEps"], dark_eps, delta=0.002)

    def test_adu_step(self):
        self.assertEqual(skyq.adu_step(np.arange(0, 4000, 4, dtype=np.float32).reshape(40, 25) + 2796), 4)
        self.assertEqual(skyq.adu_step(np.arange(1001, 5001, dtype=np.float32).reshape(40, 100)), 1)


class SubLengthTest(unittest.TestCase):
    def test_rule(self):
        # t = RN² / (((1 + 0.05)² − 1) · S) = 1.44 / (0.1025 · 0.08) = 175.6 s, where read noise adds 5 %.
        t = skyq.recommended_sub(1.2, 0.08)
        self.assertAlmostEqual(t, 175.61, places=1)
        self.assertAlmostEqual(skyq.noise_added(1.2, 0.08, 0.0, t), 0.05, places=6)
        self.assertAlmostEqual(skyq.read_noise_share(1.2, 0.08, 0.0, t), 1 - 1 / 1.05**2, places=6)
        # Dark current counts like sky.
        self.assertAlmostEqual(skyq.recommended_sub(1.2, 0.06, 0.02), t, places=6)

    def test_advice(self):
        a = skyq.advice(1.2, 0.0004, 0.08, 120.0)
        self.assertEqual(a["recommendedSubS"], 180)
        self.assertGreater(a["noiseAddedPct"], 5)
        self.assertIn("180 s would be better", a["text"])
        self.assertIn("long enough", skyq.advice(1.2, 0.0, 0.08, 300.0)["text"])
        # A dark sky would need far longer subs than are worth risking: capped.
        capped = skyq.advice(1.2, 0.0, 0.001, 300.0)
        self.assertEqual(capped["recommendedSubS"], skyq.MAX_SUB_S)
        self.assertGreater(capped["neededSubS"], skyq.MAX_SUB_S)
        # A bright (moonlit) sky: the shortest step.
        self.assertEqual(skyq.advice(1.2, 0.0, 5.0, 30.0)["recommendedSubS"], skyq.MIN_SUB_S)
        self.assertIsNone(skyq.advice(None, None, 0.08, 300.0))


if __name__ == "__main__":
    unittest.main()
