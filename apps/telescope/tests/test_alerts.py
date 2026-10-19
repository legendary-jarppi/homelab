"""Notification decisions: clouds, dew, guiding lost, meridian flip, sensor cooling, under-voltage
(python -m unittest discover -s tests)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import alerts  # noqa: E402


class CloudsTest(unittest.TestCase):
    def test_two_collapsed_frames_then_clear(self):
        clouds = alerts.Clouds()
        stars = [800, 820, 790, 810, 805, 800]
        self.assertIsNone(clouds.update("s", stars))
        # One dim frame (a passing wisp) is not clouds yet.
        stars.append(300)
        self.assertIsNone(clouds.update("s", stars))
        stars.append(240)
        kind, ratio, run = clouds.update("s", stars)
        self.assertEqual((kind, run), ("clouds", 2))
        self.assertAlmostEqual(ratio, 240 / 800, places=2)
        # Still cloudy: said once.
        stars.append(100)
        self.assertIsNone(clouds.update("s", stars))
        # Half back is not clear yet (hysteresis), then two good frames are.
        stars.append(600)
        self.assertIsNone(clouds.update("s", stars))
        stars.append(780)
        self.assertEqual(clouds.update("s", stars)[0], "clear")
        self.assertIsNone(clouds.update("s", stars + [800]))

    def test_session_start_uses_absolute_limit(self):
        # Fewer frames than the session statistics need: only "almost no stars" counts.
        clouds = alerts.Clouds()
        self.assertIsNone(clouds.update("s", [800, 300, 290]))
        kind, ratio, run = clouds.update("s", [800, 8, 5])
        self.assertEqual((kind, ratio, run), ("clouds", None, 2))

    def test_seeded_state_is_not_announced(self):
        clouds = alerts.Clouds()
        stars = [800] * 6 + [200, 150]
        self.assertIsNone(clouds.update("s", stars, emit=False))
        self.assertIsNone(clouds.update("s", stars + [100]))
        self.assertEqual(clouds.update("s", stars + [100, 800, 790])[0], "clear")


class DewTest(unittest.TestCase):
    def air(self, temp, dew):
        calls = []

        def read():
            calls.append(1)
            return temp, dew
        return read, calls

    def test_steady_rise_near_dew_point(self):
        dew = alerts.Dew()
        hfrs = [2.4, 2.45, 2.4, 2.5, 2.6, 2.75, 2.9, 3.05]
        read, _ = self.air(3.0, 1.8)
        rise, temp, point = dew.update("s", hfrs, read)
        self.assertGreater(rise, alerts.DEW_HFR_RISE)
        self.assertEqual((temp, point), (3.0, 1.8))
        self.assertIsNone(dew.update("s", hfrs + [3.2], read))  # once per session

    def test_dry_air_is_not_dew(self):
        dew = alerts.Dew()
        read, _ = self.air(5.0, -3.0)
        self.assertIsNone(dew.update("s", [2.4, 2.5, 2.6, 2.75, 2.9, 3.05], read))
        # Later the air nears its dew point while the stars keep swelling.
        read, _ = self.air(1.0, 0.0)
        self.assertIsNotNone(dew.update("s", [2.5, 2.6, 2.75, 2.9, 3.05, 3.2], read))

    def test_no_weather_lookup_without_a_trend(self):
        dew = alerts.Dew()
        read, calls = self.air(1.0, 0.5)
        # Seeing jitter, a single bad frame, and a slow drift under the limit.
        for hfrs in ([2.4, 2.6, 2.3, 2.7, 2.4, 2.6], [2.4, 2.4, 2.4, 2.4, 2.4, 3.4], [2.40, 2.42, 2.44, 2.46, 2.48, 2.50]):
            self.assertIsNone(dew.update("s", hfrs, read))
        self.assertEqual(calls, [])

    def test_focus_jump_down_breaks_the_trend(self):
        self.assertIsNone(alerts.hfr_rise([2.4, 2.6, 2.8, 2.2, 2.4, 2.6]))


class EpisodeTest(unittest.TestCase):
    def test_holds_then_once_then_rearms(self):
        e = alerts.Episode(60)
        self.assertFalse(e.update(True, 0))
        self.assertFalse(e.update(True, 59))
        self.assertTrue(e.update(True, 60))
        self.assertFalse(e.update(True, 200))
        self.assertFalse(e.update(False, 210))
        self.assertFalse(e.update(True, 220))
        self.assertTrue(e.update(True, 280))

    def test_quiet_time_before_a_new_occurrence(self):
        e = alerts.Episode(0, 600)
        self.assertTrue(e.update(True, 0))
        self.assertFalse(e.update(False, 10))
        self.assertFalse(e.update(True, 300))  # flapping: the same occurrence
        self.assertFalse(e.update(False, 310))
        self.assertFalse(e.update(False, 909))
        self.assertFalse(e.update(False, 910))
        self.assertTrue(e.update(True, 1000))

    def test_seeded_condition_is_known(self):
        e = alerts.Episode(60)
        self.assertFalse(e.update(True, 0, emit=False))
        self.assertFalse(e.update(True, 120))


class GuidingLostTest(unittest.TestCase):
    def test_lost_while_exposing(self):
        g = alerts.GuidingLost()
        s = ("root", "Autorun", "C 9", 1.0)
        self.assertIsNone(g.update(s, "Exposing", "Guiding", 0))
        self.assertIsNone(g.update(s, "Exposing", "LostLock", 10))
        self.assertIsNone(g.update(s, "Exposing", "LostLock", 60))
        self.assertEqual(g.update(s, "Exposing", "LostLock", 75), 65)
        self.assertIsNone(g.update(s, "Exposing", "Looping", 200))

    def test_not_during_flip_focus_or_unguided(self):
        g = alerts.GuidingLost()
        s = ("root", "Autorun", "C 9", 1.0)
        g.update(s, "Exposing", "Guiding", 0)
        for t in range(10, 600, 10):
            self.assertIsNone(g.update(s, "Meridian flip" if t < 300 else "Auto focus", "Stopped", t))
        # A session that never guided (or the guider's port not answering) is no alarm.
        other = ("root", "Live", "M 42", 2.0)
        for t in range(600, 900, 10):
            self.assertIsNone(g.update(other, "Exposing", "Stopped", t))
            self.assertIsNone(g.update(s, "Exposing", None, t))


class FlipTest(unittest.TestCase):
    def test_done(self):
        f = alerts.Flip()
        self.assertIsNone(f.update("Exposing", 0, 0, False, 100))
        self.assertIsNone(f.update("Meridian flip", None, 90, False, 110))
        self.assertIsNone(f.update("Plate solving", None, 90, False, 300))
        # Still the exposure from before the flip: not resumed.
        self.assertIsNone(f.update("Exposing", 80, 90, False, 320))
        self.assertEqual(f.update("Exposing", 400, 90, False, 430), ("done", 320, False))

    def test_late_then_done(self):
        f = alerts.Flip()
        f.update("Meridian flip", None, 0, False, 0)
        self.assertIsNone(f.update("Idle", None, 0, False, alerts.FLIP_RESUME_S - 1))
        self.assertEqual(f.update("Idle", None, 0, False, alerts.FLIP_RESUME_S), ("late", alerts.FLIP_RESUME_S))
        self.assertIsNone(f.update("Idle", None, 0, False, alerts.FLIP_RESUME_S + 60))
        # A new frame proves it resumed even without the live exposure (control ports gone).
        self.assertEqual(f.update(None, None, 1500, False, 1600), ("done", 1600, True))

    def test_plan_end_cancels(self):
        f = alerts.Flip()
        f.update("Meridian flip", None, 0, False, 0)
        self.assertIsNone(f.update("Idle", None, 0, True, 60))
        self.assertIsNone(f.update("Idle", None, 0, False, 3000))


class StorageTest(unittest.TestCase):
    def test_once_per_crossing(self):
        s = alerts.Storage()
        self.assertFalse(s.update("EMMC Images", 40e9, 58e9))
        self.assertTrue(s.update("EMMC Images", 14e9, 58e9))
        self.assertFalse(s.update("EMMC Images", 13e9, 58e9))
        self.assertFalse(s.update("EMMC Images", 30e9, 58e9))
        self.assertTrue(s.update("EMMC Images", 14.9e9, 58e9))
        # A big disk: under 10 % counts even above 15 GB.
        self.assertTrue(s.update("Udisk Images", 90e9, 1000e9))


if __name__ == "__main__":
    unittest.main()
