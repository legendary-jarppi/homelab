"""Automatic frame rejection decisions (python -m unittest discover -s tests)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import rejection  # noqa: E402


def good(**overrides):
    frame = {"stars": 800, "hfr": 2.4, "backgroundAdu": 1500, "elongation": 0.12, "guidingRmsArcsec": 0.7,
             "alignError": None}
    frame.update(overrides)
    return frame


class RejectionTest(unittest.TestCase):
    def test_good_session_all_accepted(self):
        decisions = rejection.judge([good(stars=780 + i * 10, hfr=2.3 + i * 0.02) for i in range(10)])
        self.assertTrue(all(accepted for accepted, _ in decisions))

    def test_reasons(self):
        frames = [good() for _ in range(8)] + [
            good(stars=280),  # clouds
            good(hfr=3.6),  # focus
            good(backgroundAdu=2600),  # dawn
            good(elongation=0.5),  # trailing
            good(guidingRmsArcsec=2.4),
            good(alignError="no match with the reference stars (40 stars)"),
        ]
        decisions = rejection.judge(frames)
        self.assertTrue(all(accepted for accepted, _ in decisions[:8]))
        reasons = [reason for _, reason in decisions[8:]]
        self.assertEqual(reasons[0], "stars 35 % of session median: clouds")
        self.assertEqual(reasons[1], "HFR 1.5× session median: focus or seeing")
        self.assertEqual(reasons[2], "background 1.7× session median: clouds lit, moon or dawn")
        self.assertEqual(reasons[3], "stars elongated 0.50 (session 0.12): trailing or wind")
        self.assertEqual(reasons[4], "guiding RMS 2.4″ (session 0.7″)")
        self.assertTrue(reasons[5].startswith("not aligned: "))
        self.assertTrue(all(not accepted for accepted, _ in decisions[8:]))

    def test_first_frames_only_absolute_limits(self):
        # Too few frames for session statistics: a dim frame passes for now, an empty one does not.
        decisions = rejection.judge([good(), good(stars=300), good(stars=4)])
        self.assertEqual([accepted for accepted, _ in decisions], [True, True, False])
        self.assertEqual(decisions[2][1], "only 4 stars: clouds or not on target")

    def test_rejudged_when_statistics_exist(self):
        frames = [good(stars=300)] + [good() for _ in range(6)]
        self.assertFalse(rejection.judge(frames)[0][0])

    def test_session_wide_elongation_is_tolerated(self):
        # Tilt or a slightly oval PSF across the whole session is not trailing.
        frames = [good(elongation=0.4) for _ in range(8)]
        self.assertTrue(all(accepted for accepted, _ in rejection.judge(frames)))

    def test_steady_mediocre_guiding_is_not_a_reason(self):
        # 2026-10-19: the first frame of a night with steady 1.5″ guiding was rejected on the absolute
        # limit alone, with round, sharp stars. Guiding counts only against the session's own median.
        self.assertTrue(rejection.judge([good(guidingRmsArcsec=1.6)])[0][0])
        frames = [good(guidingRmsArcsec=1.5 + i * 0.02) for i in range(8)]
        self.assertTrue(all(accepted for accepted, _ in rejection.judge(frames)))


if __name__ == "__main__":
    unittest.main()
