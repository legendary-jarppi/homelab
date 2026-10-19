"""Calibration sets and matching (python -m unittest discover -s tests; numpy needed)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import library  # noqa: E402

DAY = 86400.0
T0 = 1792300000.0  # 2026-10-17 evening


def frame(kind="dark", night="2026-10-17", exposure=300.0, temp=-20.0, angle=None, at=T0, n=0, gain=100, offset=70):
    return {"rel": f"{night}/{kind}/{n}.fit", "kind": kind, "night": night, "size": 1, "mtime": 1.0, "seenAt": 0.0,
            "exposureS": exposure, "gain": gain, "offset": offset, "sensorTempC": temp, "setTempC": -20.0,
            "binning": 1, "rotatorDeg": angle, "camera": "ZWO ASI533MC Pro", "width": 3008, "height": 3008,
            "bayer": "RGGB", "at": at + n}


def master(kind, night, exposure=300.0, temp=-20.0, angle=None, at=T0, gain=100, calibrated=None):
    s = {"id": f"{kind}-{night}-{exposure:g}-{temp:g}-{angle}", "type": kind, "night": night, "exposureS": exposure,
         "gain": gain, "offset": 70, "tempC": temp, "rotatorDeg": angle, "binning": 1, "camera": "ZWO ASI533MC Pro",
         "width": 3008, "height": 3008, "firstAt": at, "lastAt": at + 600, "frames": 20, "warnings": [],
         "calibratedWith": calibrated}
    return s


def lights(night="2026-10-17", exposure=300.0, temp=-20.0, angles=(93.0,), at=T0, count=4):
    out = []
    for i in range(count):
        f = frame("light", night, exposure, temp, angles[i % len(angles)], at, i)
        out.append({**f, "id": str(i)})
    return out


class SetsTest(unittest.TestCase):
    def test_grouping(self):
        frames = ([frame("dark", n=i) for i in range(10)]
                  + [frame("dark", temp=-10, n=20 + i) for i in range(5)]  # another temperature
                  + [frame("dark", exposure=120, n=40 + i) for i in range(5)]
                  + [frame("flat", exposure=1.2 + 0.01 * i, angle=93, n=60 + i) for i in range(6)]
                  + [frame("flat", exposure=1.2, angle=273, n=80 + i) for i in range(6)]
                  + [frame("bias", exposure=0.001, temp=-19.0 + 0.3 * i, n=100 + i) for i in range(8)])
        sets = library.group_sets(frames)
        by_id = {s["id"]: s for s in sets}
        self.assertEqual(len(sets), 6, sorted(by_id))
        self.assertEqual(by_id["dark-20261017-300s-g100-o70-b1-m20c"]["count"], 10)
        self.assertEqual(by_id["dark-20261017-300s-g100-o70-b1-m10c"]["count"], 5)
        self.assertIn("flat-20261017-g100-o70-b1-m20c-93deg", by_id)
        self.assertIn("flat-20261017-g100-o70-b1-m20c-273deg", by_id)  # same physical setup, kept apart
        self.assertEqual(by_id["bias-20261017-0.001s-g100-o70-b1-m18c"]["count"], 8)  # median -17.95 °C

    def test_temperature_span(self):
        sets = library.group_sets([frame(temp=-20 + i) for i in range(8)])  # -20 … -13: wider than ±2 °C
        self.assertEqual(sorted(s["count"] for s in sets), [3, 5])


class MatchTest(unittest.TestCase):
    def setUp(self):
        self.bias = master("bias", "2026-09-06", 0.001)
        self.dark = master("dark", "2026-10-17")
        self.flat = master("flat", "2026-10-17", 1.2, angle=93.0, calibrated={"bias": self.bias["id"]})

    def one(self, group_lights, masters):
        result, groups = library.match(group_lights, masters)
        self.assertEqual(len(result["nights"]), 1)
        return result["nights"][0]

    def test_everything_matches(self):
        m = self.one(lights(angles=(93.0, 273.0)), [self.bias, self.dark, self.flat])
        self.assertEqual((m["dark"], m["flat"], m["lightsBias"], m["bias"]), (self.dark["id"], self.flat["id"], None, self.bias["id"]))
        self.assertEqual(m["warnings"], [])

    def test_missing_dark_scaled(self):
        m = self.one(lights(exposure=180.0), [self.bias, self.dark, self.flat])
        self.assertTrue(m["darkScaled"])
        self.assertEqual(m["lightsBias"], self.bias["id"])
        self.assertEqual(m["warnings"], ["No dark for 180 s, gain 100, -20 °C: using the 300 s dark, scaled"])

    def test_missing_dark_without_bias(self):
        m = self.one(lights(exposure=180.0), [self.dark, self.flat])
        self.assertIsNone(m["dark"])
        self.assertTrue(any(w.startswith("No dark for 180 s, gain 100, -20 °C: hot pixels") for w in m["warnings"]))
        self.assertTrue(any(w.startswith("No bias for gain 100, offset 70") for w in m["warnings"]))

    def test_dark_other_temperature(self):
        m = self.one(lights(temp=-15.0), [self.bias, self.dark, self.flat])
        self.assertEqual(m["dark"], self.dark["id"])
        self.assertEqual(m["warnings"], ["Dark at -20 °C, lights at -15 °C"])

    def test_old_flat(self):
        old = master("flat", "2026-09-06", 1.2, angle=93.0, at=T0 - 41 * DAY)
        m = self.one(lights(), [self.bias, self.dark, old])
        self.assertEqual(m["warnings"], ["Flat is 41 days older than the lights"])

    def test_flat_angle_prefers_same_setup(self):
        rotated = master("flat", "2026-10-17", 1.2, angle=120.0)
        old_same = master("flat", "2026-10-10", 1.2, angle=273.0, at=T0 - 7 * DAY)
        m = self.one(lights(angles=(93.0,)), [self.bias, self.dark, rotated, old_same])
        self.assertEqual(m["flat"], old_same["id"])  # 273 ≡ 93 after a flip; a week old is within limits
        m = self.one(lights(angles=(93.0,)), [self.bias, self.dark, rotated])
        self.assertEqual(m["warnings"], ["Flat taken at camera angle 120°, lights at 93° (dust spots may not match)"])

    def test_no_flat(self):
        m = self.one(lights(), [self.bias, self.dark])
        self.assertEqual(m["warnings"], ["No flat: vignetting and dust spots stay in the image"])

    def test_groups_by_night_and_exposure(self):
        result, groups = library.match(lights() + lights("2026-10-18", 180.0, at=T0 + DAY), [self.bias, self.dark, self.flat])
        self.assertEqual([m["night"] for m in result["nights"]], ["2026-10-17", "2026-10-18"])
        self.assertIn("2026-10-18: No dark for 180 s, gain 100, -20 °C: using the 300 s dark, scaled", result["warnings"])

    def test_darkflat_for_flat(self):
        darkflat = master("dark", "2026-10-17", 1.2)
        flat_set = {**self.flat, "tempC": -20.0}
        self.assertEqual(library.pick_darkflat([self.dark, darkflat], flat_set)["id"], darkflat["id"])
        # A dark-flat is never scaled up to a light.
        m = self.one(lights(exposure=180.0), [self.bias, darkflat, self.flat])
        self.assertIsNone(m["dark"])


if __name__ == "__main__":
    unittest.main()
