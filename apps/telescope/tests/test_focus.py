"""Auto focus runs from the Autorun log (python -m unittest discover -s tests)."""

import os
import struct
import sys
import tempfile
import unittest
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import focus  # noqa: E402

TZ = ZoneInfo("Europe/Helsinki")

# Excerpts of real logs (2026-09-02, 2026-02-13), CRLF as the ASIAIR writes them.
LOG = "\r\n".join("""2026/09/02 22:38:29 [Autorun|Begin] NGC 6960 Start
2026/09/02 23:14:49 [AutoFocus|Begin] Run AF after Auto Meridian filpped, exposure 2.0s Bin1, temperature 17.0℃
2026/09/02 23:14:49 Find Focus Star
2026/09/02 23:14:54 Cancel AF Manually
2026/09/02 23:14:54 [AutoFocus|End] Auto focus failed
2026/09/02 23:15:01 [Autorun|End] Pause Autorun
2026/09/03 02:04:37 [Autorun|Begin] M 31 Start
2026/09/03 04:14:44 [AutoFocus|Begin] Run AF 1 hours later, exposure 2.0s Bin1, temperature 15.0℃
2026/09/03 04:14:44 Find Focus Star
2026/09/03 04:14:50 Find Focus Star: detect and calculate star size 3.0 ,  EAF position 6085
2026/09/03 04:14:50 Find Focus Star: finding appropriate stars star size 3.0
2026/09/03 04:15:00 Find Focus Star: detect and calculate star size 0.0 ,  EAF position 6235
2026/09/03 04:15:17 Find Focus Star: detect and calculate star size 6.5 ,  EAF position 6175
2026/09/03 04:15:17 Calculate V-Curve
2026/09/03 04:15:23 Calculate V-Curve: detect and calculate star size 7.0 ,  EAF position 6175
2026/09/03 04:15:30 Calculate V-Curve: detect and calculate star size 5.2 ,  EAF position 6145
2026/09/03 04:15:36 Calculate V-Curve: detect and calculate star size 3.6 ,  EAF position 6115
2026/09/03 04:15:42 Calculate V-Curve: detect and calculate star size 3.1 ,  EAF position 6085
2026/09/03 04:15:49 Calculate V-Curve: detect and calculate star size 3.4 ,  EAF position 6055
2026/09/03 04:16:13 Find Focus Point
2026/09/03 04:16:38 Calculate Focus Point: detect and calculate star size 3.2 ,  EAF position 6093
2026/09/03 04:16:44 Calculate Focus Point: detect and calculate star size 3.0 ,  EAF position 6078
2026/09/03 04:16:44 Auto focus succeeded, the focused position is 6078
2026/09/03 04:16:45 [AutoFocus|End] Auto focus succeeded
2026/09/03 04:56:31 [Autorun|End] Finish Autorun
Log disabled at 2026/09/03 04:56:55
Log enabled at 2026/02/13 19:53:23
2026/02/13 20:10:13 [AutoFocus|Begin] Run AF when temperature changed 2 degrees, -10.0℃ changed to -13.0℃, exposure 2.0s Bin1, temperature -13.0℃
2026/02/13 20:10:20 Calculate V-Curve: detect and calculate star size 9.2 ,  EAF position 5232
Log disabled at 2026/02/13 20:10:30""".splitlines())


class ParseTest(unittest.TestCase):
    def setUp(self):
        self.runs = focus.parse(LOG, TZ)

    def test_runs(self):
        self.assertEqual(len(self.runs), 3)
        failed, ok, cut = self.runs
        self.assertEqual((failed["target"], failed["reason"], failed["temperatureC"]),
                         ("NGC 6960", "after Auto Meridian filpped", 17.0))
        self.assertFalse(failed["success"])
        self.assertEqual(failed["failure"], "Cancel AF Manually")
        self.assertEqual(failed["points"], [])
        self.assertEqual(failed["endedAt"] - failed["at"], 5)

        self.assertTrue(ok["success"])
        self.assertEqual((ok["target"], ok["reason"], ok["temperatureC"], ok["position"]), ("M 31", "1 hours later", 15.0, 6078))
        self.assertIsNone(ok["failure"])
        self.assertEqual(ok["endedAt"] - ok["at"], 121)

        # A run cut off by the end of the log: failed, with the reason's own temperatures kept in the text.
        self.assertFalse(cut["success"])
        self.assertEqual(cut["reason"], "when temperature changed 2 degrees, -10.0℃ changed to -13.0℃")
        self.assertEqual(cut["temperatureC"], -13.0)
        self.assertEqual(cut["failure"], "log ended during the run")

    def test_points(self):
        ok = self.runs[1]
        # Every step's measurements in order, star size 0 (no star found) left out; step 0/1/2.
        self.assertEqual(ok["points"][:3], [[6085, 3.0, 0], [6175, 6.5, 0], [6175, 7.0, 1]])
        self.assertEqual(ok["points"][-1], [6078, 3.0, 2])
        self.assertEqual(sum(1 for p in ok["points"] if p[2] == 1), 5)
        self.assertEqual(ok["bestSize"], 3.0)  # smallest of the V-curve and focus point steps
        self.assertEqual(ok["at"], 1788398084.0)  # 2026-09-03 04:14:44 EEST


class HeaderTest(unittest.TestCase):
    def test_focus_position_from_header_blocks(self):
        cards = ["SIMPLE  =                    T", "BITPIX  =                   16", "NAXIS   =                    2",
                 "FOCUSPOS=                 6078 / EAF position"] + [f"COMMENT {i}" for i in range(40)] + ["END"]
        header = "".join(c.ljust(80) for c in cards).encode()
        header += b" " * (-len(header) % 2880)
        with tempfile.NamedTemporaryFile(suffix=".fit", delete=False) as f:
            f.write(header + struct.pack(">h", 0) * 1440)
        try:
            self.assertEqual(len(header), 5760)  # the END card in the second block
            self.assertEqual(focus.focus_position(f.name), 6078.0)
        finally:
            os.unlink(f.name)


if __name__ == "__main__":
    unittest.main()
