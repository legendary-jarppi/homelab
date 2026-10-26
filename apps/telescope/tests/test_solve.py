"""ASTAP's output (solve.py): its .ini and .wcs as written by astap_cli 2026.09.01 for an ASIAIR
frame, the solution of a binned image moved back to the full-size pixels (incl. SIP), the mono FITS
written for it (rows in order) and the hints from an ASIAIR header. No ASTAP run here.
(python -m unittest discover -s tests)"""

import math
import os
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import fits  # noqa: E402
import solve  # noqa: E402

# astap_cli -f "Light_M 81_…_0001.fit" -wcs -sip (2025-12-31, M 81): excerpts of its output.
INI_SOLVED = """PLTSOLVD=T
CRPIX1= 1.5045000000000000E+003
CRPIX2= 1.5045000000000000E+003
CRVAL1= 1.4890623043309651E+002
CRVAL2= 6.9066291216674628E+001
CDELT1= 3.2167558791256108E-004
CDELT2= 3.2164469468195400E-004
CROTA1= 2.9989559985938921E+001
CROTA2= 2.9995390596373614E+001
CD1_1= 2.7860853296051710E-004
CD1_2=-1.6078703063518608E-004
CD2_1= 1.6079993747722138E-004
CD2_2= 2.7856541372605660E-004
CMDLINE=/opt/astap/astap_cli -f "Light_M 81_210deg_60.0s_Bin1_20251231-003314_0001.fit" -d /opt/astap
"""
INI_FAILED = """PLTSOLVD=F
CMDLINE=/opt/astap/astap_cli -f frame.fit -r 30
ERROR=No solution found!
"""
WCS_CARDS = [
    "OBJECT  = 'M 81    '           / name or catalog number of object being imaged",
    "ROTATOR =                  210 / Camera Angle",
    "A_ORDER =                    3 / Polynomial order, axis 1. Pixel to Sky",
    "A_0_0   = -2.103080193989E-002 / SIP coefficient",
    "A_1_0   =  2.257776481993E-004 / SIP coefficient",
    "A_2_0   =  3.479399427197E-008 / SIP coefficient",
    "A_3_0   = -2.384859667805E-010 / SIP coefficient",
    "B_ORDER =                    3 / Polynomial order, axis 2. Pixel to sky.",
    "B_0_1   =  3.534765078617E-004 / SIP coefficient",
    "B_1_1   = -8.044472873127E-009 / SIP coefficient",
    "AP_ORDER=                    3 / Inv polynomial order, axis 1. Sky to pixel.",
    "AP_0_0  =  2.104834461030E-002 / SIP coefficient",
    "BP_ORDER=                    3 / Inv polynomial order, axis 2. Sky to pixel.",
    "BP_0_2  = -2.254813353275E-008 / SIP coefficient",
    "CTYPE1  = 'RA---TAN-SIP'       / TAN (gnomic) projection + SIP distortions",
    "CTYPE2  = 'DEC--TAN-SIP'       / TAN (gnomic) projection + SIP distortions",
    "CRPIX1  =  1.504500000000E+003 / X of reference pixel",
    "CRPIX2  =  1.504500000000E+003 / Y of reference pixel",
    "CRVAL1  =  1.489062304331E+002 / RA of reference pixel (deg)",
    "CRVAL2  =  6.906629121667E+001 / DEC of reference pixel (deg)",
    "CDELT1  =  3.216755879126E-004 / X pixel size (deg)",
    "CDELT2  =  3.216446946820E-004 / Y pixel size (deg)",
    "CROTA1  =  2.998955998594E+001 / Image twist of X axis        (deg)",
    "CROTA2  =  2.999539059637E+001 / Image twist of Y axis        (deg)",
    "CD1_1   =  2.786085329605E-004 / CD matrix to convert (x,y) to (Ra, Dec)",
    "CD1_2   = -1.607870306352E-004 / CD matrix to convert (x,y) to (Ra, Dec)",
    "CD2_1   =  1.607999374772E-004 / CD matrix to convert (x,y) to (Ra, Dec)",
    "CD2_2   =  2.785654137261E-004 / CD matrix to convert (x,y) to (Ra, Dec)",
    "PLTSOLVD=                    T / Astrometric solved by ASTAP_CLI v2026.09.01.",
    "END",
]


def wcs_file() -> bytes:
    text = "".join(f"{c:<80}" for c in WCS_CARDS)
    return (text + " " * (-len(text) % 2880)).encode("ascii")


def sip(cards: dict, prefix: str, u: float, v: float) -> float:
    total = 0.0
    for key, value in cards.items():
        m = solve.SIP_TERM.match(key)
        if m and m[1] == prefix:
            total += value * u ** int(m[2]) * v ** int(m[3])
    return total


def sky(cards: dict, x: float, y: float) -> tuple[float, float]:
    """FITS pixel → RA/Dec through TAN-SIP (the forward A/B polynomials)."""
    u, v = x - cards["CRPIX1"], y - cards["CRPIX2"]
    solution = fits.wcs(cards)
    ra, dec = solution.to_sky(np.array(cards["CRPIX1"] + u + sip(cards, "A", u, v)),
                              np.array(cards["CRPIX2"] + v + sip(cards, "B", u, v)))
    return float(ra), float(dec)


class SolveOutputTest(unittest.TestCase):
    def test_ini(self):
        solved = solve.parse_ini(INI_SOLVED)
        self.assertEqual(solved["PLTSOLVD"], "T")
        self.assertAlmostEqual(float(solved["CD1_2"]), -1.6078703063518608e-4)
        self.assertTrue(solved["CMDLINE"].startswith("/opt/astap/astap_cli -f"))
        failed = solve.parse_ini(INI_FAILED)
        self.assertEqual((failed["PLTSOLVD"], failed["ERROR"]), ("F", "No solution found!"))

    def test_wcs_file_to_cards(self):
        header, _ = fits.parse_header(wcs_file())
        cards = solve.cards_from_header(header)
        self.assertEqual((cards["CTYPE1"], cards["CTYPE2"]), ("RA---TAN-SIP", "DEC--TAN-SIP"))
        self.assertEqual((cards["CRPIX1"], cards["CRVAL2"]), (1504.5, 69.06629121667))
        self.assertEqual(cards["CD2_1"], 1.607999374772e-4)
        # SIP passed on, ASTAP's constant and linear terms too; nothing else from the header.
        self.assertEqual((cards["A_ORDER"], cards["A_0_0"], cards["A_1_0"]), (3, -2.103080193989e-2, 2.257776481993e-4))
        self.assertEqual((cards["AP_0_0"], cards["BP_0_2"]), (2.10483446103e-2, -2.254813353275e-8))
        self.assertNotIn("OBJECT", cards)
        self.assertNotIn("CDELT1", cards)
        # The solution as stored for a frame: 1.158"/px, rotated ~30°, not mirrored.
        solution = fits.wcs(cards)
        self.assertAlmostEqual(solution.pixel_scale_arcsec(), 1.158, places=3)
        self.assertGreater(np.linalg.det(np.array(solution.cd)), 0)
        header["PLTSOLVD"] = "F"
        self.assertIsNone(solve.cards_from_header(header))

    def test_rescale_binned_solution_to_full_size(self):
        header, _ = fits.parse_header(wcs_file())
        binned = solve.cards_from_header(header)
        for k in (2, 3):
            full = solve.rescale(binned, k)
            self.assertEqual(full["A_ORDER"], 3)
            # Binned FITS pixel u covers full pixels k(u-1)+1 … ku: the same sky at their centre.
            for u, v in ((1, 1), (1504.5, 1504.5), (3008, 1), (700.25, 2900.75)):
                x, y = k * (u - 1) + (k + 1) / 2, k * (v - 1) + (k + 1) / 2
                a, b = sky(binned, u, v), sky(full, x, y)
                self.assertLess(math.hypot((a[0] - b[0]) * math.cos(math.radians(a[1])), a[1] - b[1]) * 3600, 1e-6)
            # The inverse polynomials scale the same way: k · AP(U/k, V/k).
            self.assertAlmostEqual(sip(full, "BP", 300.0, -900.0), k * sip(binned, "BP", 300.0 / k, -900.0 / k))
        self.assertEqual(solve.rescale(binned, 1), binned)

    def test_luminance_fits_keeps_rows_and_bins(self):
        image = np.zeros((7000, 4100, 3), np.uint16)
        image[0:3, 0:3] = 30000  # top-left block, all channels
        image[6990:6993, 4092:4095, 1] = 60000  # near the bottom right, green only
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "upload.fits")
            k = solve.write_luminance(image, path, 65535.0)
            self.assertEqual(k, 3)  # 7000 / 3000 → 3
            header, data, bscale, bzero = fits.open_image(path)
            self.assertEqual((int(header["NAXIS1"]), int(header["NAXIS2"])), (1366, 2333))
            plane = np.asarray(data[0], np.float32) * bscale + bzero
            # Data row 1 of the FITS is the image's top row (array row 0).
            self.assertAlmostEqual(float(plane[0, 0]), 30000.0, places=2)
            self.assertAlmostEqual(float(plane[2330, 1364]), 60000 / 3, places=2)
            self.assertEqual(int(np.count_nonzero(plane)), 2)

    def test_luminance_scales_to_16_bit(self):
        image = np.full((100, 120), 0.5, np.float32)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "upload.fits")
            self.assertEqual(solve.write_luminance(image, path, 1.0), 1)
            _, data, _, _ = fits.open_image(path)
            self.assertAlmostEqual(float(data[0, 50, 60]), 32767.5, places=1)

    def test_frame_hints(self):
        header = {"NAXIS2": "3008", "XPIXSZ": "3.75999999046326", "FOCALLEN": "671", "RA": "326.039775", "DEC": "90."}
        ra, dec, fov = solve.frame_hints(header)
        self.assertEqual((ra, dec), (326.039775, 90.0))
        self.assertAlmostEqual(fov, 0.9658, places=3)
        ra, dec, fov = solve.frame_hints({"OBJCTRA": "09 55 33", "OBJCTDEC": "+69 03 55"})
        self.assertAlmostEqual(ra, 148.8875, places=3)
        self.assertAlmostEqual(dec, 69.0653, places=3)
        self.assertEqual(fov, 0.0)
        self.assertEqual(solve.frame_hints({}), (None, None, 0.0))


if __name__ == "__main__":
    unittest.main()
