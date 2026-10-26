"""PHD2 guide logs: parser and the mount analysis (python -m unittest discover -s tests)."""

import math
import os
import sys
import unittest
from zoneinfo import ZoneInfo

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import guidelog  # noqa: E402

TZ = ZoneInfo("Europe/Helsinki")

HEADER = """Dither = both axes, Dither scale = 1.000, Image noise reduction = none, Guide-frame time lapse = 0, Server enabled
Pixel scale = {scale} arc-sec/px, Binning = 1, Focal length = 249 mm
Search region = 50 px, Star mass tolerance = 50.0%
Equipment Profile = 
Camera = ZWO ASI120MM Mini, gain = 28, full size = 1280 x 960, no dark, no defect map, pixel size = 3.8 um
Exposure = 3000 ms
Mount = EQMod Mount,  connected, guiding enabled, xAngle = -145.2, xRate = 0.814, yAngle = -53.4, yRate = 1.155, parity = +/+, 
X guide algorithm = Hysteresis, Hysteresis = 0.100, Aggression = 0.700, Minimum move = 0.100
Y guide algorithm = Resist Switch, Minimum move = 0.100 Aggression = 100% FastSwitch = enabled
Backlash comp = disabled, pulse = 0 ms
Calibration step = phdlab_placeholder, Max RA duration = 2000, Max DEC duration = 2000, DEC guide mode = Auto
RA Guide Speed = 3.7 a-s/s, Dec Guide Speed = 3.7 a-s/s, Cal Dec = 47.1, Last Cal Issue = None, Timestamp = Unknown
Dec = {dec} deg, Hour angle = -0.48 hr, Pier side = West, Rotator pos = Unknown
Lock position = 207.494, 801.428, Star position = 207.324, 801.876, HFD = 5.02 px
Frame,Time,mount,dx,dy,RARawDistance,DECRawDistance,RAGuideDistance,DECGuideDistance,RADuration,RADirection,DECDuration,DECDirection,XStep,YStep,StarMass,SNR,ErrorCode"""

# Real lines from 2026-09-02's log: a short section (settling, an error-code row) and part of a
# long one with a lost star, cut off without "Guiding Ends" as the last section of a log can be.
LOG = "\n".join([
    "PHD2 version, Log version 2.5. Log enabled at 2026-09-02 22:39:35",
    "",
    "Guiding Begins at 2026-09-02 22:39:38",
    HEADER.format(scale="3.11", dec="30.8"),
    "INFO: SETTLING STATE CHANGE, Settling started",
    '1,3.482,"Mount",-0.358,0.423,0.053,-0.549,0.000,-0.549,0,,476,N,,,2788,36.92,0',
    '2,6.438,"Mount",-0.367,0.414,0.066,-0.547,0.000,-0.547,0,,474,N,,,2678,36.22,0',
    "INFO: SETTLING STATE CHANGE, Settling complete",
    '3,9.396,"Mount",-0.228,0.389,-0.034,-0.450,0.000,-0.450,0,,390,N,,,0,0.00,7',
    "Guiding Ends at 2026-09-02 22:39:47",
    "",
    "Guiding Begins at 2026-09-02 23:16:56",
    HEADER.format(scale="3.11", dec="30.8"),
    '1153,3459.110,"Mount",0.042,0.026,0.050,0.001,0.000,0.000,0,,0,,,,1923,30.60,0',
    '1154,3462.199,"Mount",-0.057,-0.100,-0.104,0.053,-0.065,0.000,64,E,0,,,,1707,28.83,0',
    '1155,3465.131,"Mount",-0.048,-0.014,-0.047,-0.014,0.000,0.000,0,,0,,,,1331,25.51,0',
    '1156,3468.058,"DROP",,,,,,,,,,,,,536,16.19,6,"Star lost - mass changed"',
    '1157,3471.058,"DROP",,,,,,,,,,,,,382,13.63,6,"Star lost - mass changed"',
])


class ParseTest(unittest.TestCase):
    def test_sections(self):
        enabled, sections = guidelog.parse(LOG, TZ)
        self.assertEqual(enabled, 1788377975.0)  # 2026-09-02 22:39:35 EEST
        self.assertEqual(len(sections), 2)
        first, second = sections
        self.assertEqual(first.started_at, enabled + 3)
        self.assertEqual(first.ended_at, enabled + 12)
        self.assertEqual((first.pixel_scale, first.dec, first.hour_angle, first.pier, first.mount, first.exposure_s),
                         (3.11, 30.8, -0.48, "West", "EQMod Mount", 3.0))
        self.assertEqual([row[1] for row in first.rows], [True, True, False])  # error code 7: no measurement
        self.assertEqual([row[8] for row in first.rows], [True, True, False])  # settling
        self.assertEqual(first.rows[0][5], -0.549)
        self.assertEqual(first.rows[0][7], -476)  # Dec pulse ms, signed like the guide distance
        self.assertIsNone(second.ended_at)
        self.assertEqual([row[1] for row in second.rows], [True, True, True, False, False])
        self.assertEqual(second.rows[1][6], -64)

    def test_summary(self):
        result = guidelog.analyse(LOG, TZ)
        self.assertEqual(result["sections"], 2)
        first, second = result["guidingSections"]
        self.assertEqual((first["steps"], first["lost"], first["settling"]), (2, 1, 2))
        self.assertIsNone(first["rmsArcsec"]["total"])  # only settling steps
        self.assertEqual((second["steps"], second["lost"]), (3, 2))
        self.assertEqual(second["endedAt"], second["startedAt"] + 3471.058)  # the last row without "Guiding Ends"
        self.assertIsNone(second["rmsArcsec"]["ra"])  # under 10 steady steps: no section RMS
        ra = np.array([0.050, -0.104, -0.047]) * 3.11
        self.assertAlmostEqual(result["rmsArcsec"]["ra"], float(np.std(ra)), places=2)  # the log's: every steady step


def synthetic_log(amplitude: float, period: float, drift: float, duration: float = 3600.0, seed: int = 1) -> str:
    """A guided hour: the mount's RA error is a sine plus a linear drift; PHD2 measures it (with
    0.05 px seeing noise) and corrects 70 % of what it sees (minimum move 0.1 px), as Hysteresis does."""
    rng = np.random.default_rng(seed)
    rows = []
    applied = 0.0
    for i, t in enumerate(np.arange(3.0, duration + 3.0, 3.0)):
        true = amplitude * math.sin(2 * math.pi * t / period + 0.7) + drift * t
        raw = true - applied + rng.normal(0, 0.05)
        guide = 0.7 * raw if abs(raw) >= 0.1 else 0.0
        applied += guide
        ms = round(abs(guide) / 0.814 * 1000)
        direction = ("W" if guide > 0 else "E") if guide else ""
        rows.append(f'{i + 1},{t:.3f},"Mount",0,0,{raw:.3f},0.000,{guide:.3f},0.000,{ms},{direction},0,,,,2000,30.00,0')
    return "\n".join(["PHD2 version, Log version 2.5. Log enabled at 2026-10-17 22:30:00", "",
                      "Guiding Begins at 2026-10-17 22:31:00", HEADER.format(scale="1.00", dec="60.0"), *rows,
                      "Guiding Ends at 2026-10-17 23:31:03"])


class PeriodicErrorTest(unittest.TestCase):
    def test_reconstruct_undoes_the_corrections(self):
        t = np.arange(10.0)
        true = 0.3 * t
        applied, raw, guide = 0.0, [], []
        for x in true:
            raw.append(x - applied)
            guide.append(0.5 * raw[-1])
            applied += guide[-1]
        times, pos = guidelog.reconstruct(t, np.ones(10, bool), np.array(raw), np.array(guide))
        np.testing.assert_allclose(pos, true, atol=1e-12)

    def test_sine_period_and_amplitude(self):
        result = guidelog.analyse(synthetic_log(amplitude=5.0, period=479.0, drift=0.01), TZ)
        section = result["guidingSections"][0]
        self.assertLess(section["rmsArcsec"]["ra"], 0.5)  # guided: far below the sine
        pe = result["pe"]
        self.assertEqual(pe["sections"], 1)
        top = pe["periods"][0]
        self.assertAlmostEqual(top["periodS"], 479.0, delta=479 * 0.01)
        self.assertAlmostEqual(top["amplitudeArcsec"], 5.0, delta=0.25)
        self.assertAlmostEqual(pe["peakToPeakArcsec"], 10.0, delta=0.6)
        # Dec 60°: the worm's own error is twice the error on the sky.
        self.assertAlmostEqual(pe["peakToPeakAxisArcsec"], pe["peakToPeakArcsec"] * 2, delta=0.05)
        self.assertAlmostEqual(section["pe"]["unguidedRmsArcsec"], 5.0 / math.sqrt(2), delta=0.2)
        self.assertAlmostEqual(section["pe"]["raDriftArcsecPerMin"], 0.6, delta=0.05)  # 0.01 px/s, removed first

    def test_short_section_has_no_periodic_error(self):
        result = guidelog.analyse(synthetic_log(amplitude=5.0, period=479.0, drift=0.0, duration=1800.0), TZ)
        self.assertIsNone(result["pe"])
        self.assertIsNone(result["guidingSections"][0]["pe"])

    def test_two_periods_ranked(self):
        log = synthetic_log(amplitude=4.0, period=479.0, drift=0.0)
        base = guidelog.analyse(log, TZ)["pe"]["periods"]
        self.assertGreater(base[0]["amplitudeArcsec"], 3.6)
        # A spectrum with two peaks: the stronger first, both found.
        t = np.arange(0, 3600, 3.0)
        y = 3 * np.sin(2 * np.pi * t / 479) + 1.5 * np.sin(2 * np.pi * t / 160)
        amps = guidelog.amplitude_spectrum(t, y, guidelog.PE_FREQS)
        periods = guidelog.top_periods([(3600.0, t, y)], amps, count=2)
        self.assertAlmostEqual(periods[0]["periodS"], 479, delta=5)
        self.assertAlmostEqual(periods[0]["amplitudeArcsec"], 3.0, delta=0.15)
        self.assertAlmostEqual(periods[1]["periodS"], 160, delta=2)
        self.assertAlmostEqual(periods[1]["amplitudeArcsec"], 1.5, delta=0.15)


class DriftTest(unittest.TestCase):
    def test_dec_drift_and_polar_error(self):
        # Dec drifting 1″/min, corrected by the guider (70 % of each error): reconstructed from the corrections.
        rows, applied = [], 0.0
        for i, t in enumerate(np.arange(3.0, 903.0, 3.0)):
            raw = t / 60 - applied
            guide = 0.7 * raw
            applied += guide
            rows.append(f'{i + 1},{t:.3f},"Mount",0,0,0.000,{raw:.4f},0.000,{guide:.4f},0,,{round(guide * 866)},S,,,2000,30.00,0')
        log = "\n".join(["Guiding Begins at 2026-10-17 22:31:00", HEADER.format(scale="1.00", dec="60.0"), *rows])
        drift = guidelog.analyse(log, TZ)["guidingSections"][0]["decDrift"]
        self.assertAlmostEqual(drift["arcsecPerMin"], 1.0, places=3)
        # ε ≥ rate / ω: 1″/min over 0.004375 rad/min = 228.6″ = 3.8′.
        self.assertAlmostEqual(drift["polarErrorArcmin"], 3.8, places=1)


if __name__ == "__main__":
    unittest.main()
