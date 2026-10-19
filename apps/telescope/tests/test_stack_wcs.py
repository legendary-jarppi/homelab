"""The live stack's plate solution (sessions.stack_wcs): the reference frame's ASIAIR solve moved to
the superpixel grid, or a solved frame's carried through its transform. Synthetic RGGB frames are
rendered from a star field through a camera TAN solution; the stars found on the debayered plane must
sit where the stack's solution puts them (display px = FITS − 1) within 0.5 px.
(python -m unittest discover -s tests)"""

import math
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import analysis  # noqa: E402
import fits  # noqa: E402
import register  # noqa: E402
import sessions  # noqa: E402

SIZE = 1200  # camera pixels
SCALE = 1.157 / 3600  # degrees per camera pixel (ASI533MC at 670 mm)
CENTRE = (344.20, 62.62)


def camera_wcs(angle_deg: float, crval=CENTRE, crpix=(600.5, 600.5)) -> fits.Wcs:
    t = math.radians(angle_deg)
    cd = ((-SCALE * math.cos(t), SCALE * math.sin(t)), (SCALE * math.sin(t), SCALE * math.cos(t)))
    return fits.Wcs(crpix, crval, cd)


def sky_field(seed: int, n: int = 300):
    rng = np.random.default_rng(seed)
    x, y = rng.uniform(30, SIZE - 30, n), rng.uniform(30, SIZE - 30, n)
    ra, dec = camera_wcs(0).to_sky(x, y)
    flux = 10 ** rng.uniform(4.0, 5.5, n)
    return ra, dec, flux, rng


def render(solution: fits.Wcs, ra, dec, flux, rng, sigma: float = 1.8) -> np.ndarray:
    """A 16-bit-like RGGB mosaic (every channel the same response) with stars at the solution's
    pixels: FITS (1-based) x → array column x − 1."""
    image = np.full((SIZE, SIZE), 1000.0)
    fx, fy = solution.to_pixel(ra, dec)
    r = 8
    for x, y, f in zip(fx - 1, fy - 1, flux):
        if not (r <= x < SIZE - r and r <= y < SIZE - r):
            continue
        x0, y0 = int(x) - r, int(y) - r
        gy, gx = np.mgrid[y0 : y0 + 2 * r + 1, x0 : x0 + 2 * r + 1]
        image[y0 : y0 + 2 * r + 1, x0 : x0 + 2 * r + 1] += f / (2 * math.pi * sigma**2) * np.exp(
            -((gx - x) ** 2 + (gy - y) ** 2) / (2 * sigma**2))
    image += rng.normal(0, 4, image.shape)
    return image.astype(np.float32)


def plane_stars(mosaic: np.ndarray) -> np.ndarray:
    planes = fits.channels(mosaic, {"BAYERPAT": "RGGB"})
    return analysis.detect(planes[1]).xy


def offsets(found: np.ndarray, predicted: np.ndarray) -> np.ndarray:
    """For each isolated predicted star (no other within 12 px: a neighbour's wings pull a detected
    peak), the distance to the nearest star found, where one is found within 3 px."""
    pp = np.hypot(predicted[:, None, 0] - predicted[None, :, 0], predicted[:, None, 1] - predicted[None, :, 1])
    np.fill_diagonal(pp, np.inf)
    predicted = predicted[pp.min(axis=1) > 12]
    d = np.hypot(predicted[:, None, 0] - found[None, :, 0], predicted[:, None, 1] - found[None, :, 1])
    nearest = d.min(axis=1)
    return nearest[nearest < 3]


class StackWcsTest(unittest.TestCase):
    def test_plane_solution_round_trips_through_the_reference(self):
        reference = camera_wcs(37.0)
        stack = sessions.stack_wcs({"refWcs": reference.json(), "refScale": 2.0, "frames": []})
        p = np.array([[0.0, 0.0], [599.0, 0.0], [0.0, 599.0], [300.25, 411.75], [599.0, 599.0]])
        ra, dec = stack.to_sky(p[:, 0] + 1, p[:, 1] + 1)  # display → FITS
        x, y = reference.to_pixel(ra, dec)
        # Plane pixel p spans camera pixels 2p, 2p + 1 (0-based): its centre is camera FITS 2p + 1.5.
        np.testing.assert_allclose(x, 2 * p[:, 0] + 1.5, atol=1e-6)
        np.testing.assert_allclose(y, 2 * p[:, 1] + 1.5, atol=1e-6)
        self.assertAlmostEqual(stack.pixel_scale_arcsec(), 2 * 1.157, places=6)
        cards = stack.cards()
        self.assertEqual((cards["CTYPE1"], cards["CTYPE2"]), ("RA---TAN", "DEC--TAN"))
        self.assertAlmostEqual(cards["CRPIX1"], (600.5 + 0.5) / 2)

    def test_stars_on_the_debayered_plane_match_the_reference_solution(self):
        ra, dec, flux, rng = sky_field(1)
        reference = camera_wcs(37.0)
        found = plane_stars(render(reference, ra, dec, flux, rng))
        stack = sessions.stack_wcs({"refWcs": reference.json(), "refScale": 2.0, "frames": []})
        px, py = stack.to_pixel(ra, dec)
        error = offsets(found, np.column_stack([px - 1, py - 1]))
        self.assertGreater(len(error), 150)
        self.assertLess(float(error.max()), 0.5)
        self.assertLess(float(np.median(error)), 0.1)

    def test_unsolved_reference_takes_a_solved_frame_through_its_transform(self):
        ra, dec, flux, rng = sky_field(2)
        truth = camera_wcs(37.0)  # the reference frame's real pointing, but its solve failed
        moved = camera_wcs(38.3, crval=(CENTRE[0] + 0.004, CENTRE[1] - 0.003), crpix=(612.0, 590.0))
        ref_stars = plane_stars(render(truth, ra, dec, flux, rng))
        frame_stars = plane_stars(render(moved, ra, dec, flux, rng))
        reg = register.register(frame_stars, ref_stars)
        self.assertIsNotNone(reg)
        frame = {"state": "done", "manual": None, "auto": [True, None], "transform": reg.matrix[:2].tolist(),
                 "wcs": moved.json()}
        stack = sessions.stack_wcs({"refWcs": None, "refScale": 2.0, "frames": [frame]})
        px, py = stack.to_pixel(ra, dec)
        error = offsets(ref_stars, np.column_stack([px - 1, py - 1]))
        self.assertGreater(len(error), 150)
        self.assertLess(float(error.max()), 0.5)

    def test_no_solve_anywhere_gives_none(self):
        frame = {"state": "done", "manual": None, "auto": [True, None], "transform": np.eye(3)[:2].tolist(), "wcs": None}
        self.assertIsNone(sessions.stack_wcs({"refWcs": None, "refScale": 2.0, "frames": [frame]}))


if __name__ == "__main__":
    unittest.main()
