"""The filter history (FILTERS) and the filter on a night."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import filters  # noqa: E402


class FiltersTest(unittest.TestCase):
    def test_history_from_a_night_on(self):
        history = filters.parse("2026-02-13=Baader UHC-L; 2026-11-01=none;2027-01-05=Optolong L-eXtreme")
        self.assertIsNone(filters.on("2025-12-30", history=history))  # before the first entry
        self.assertEqual(filters.on("2026-02-13", history=history), "Baader UHC-L")  # valid from that night
        self.assertEqual(filters.on("2026-10-19", history=history), "Baader UHC-L")
        self.assertIsNone(filters.on("2026-11-01", history=history))  # taken out
        self.assertEqual(filters.on("2027-03-01", history=history), "Optolong L-eXtreme")

    def test_header_wins(self):
        history = filters.parse("2026-02-13=Baader UHC-L")
        self.assertEqual(filters.on("2026-10-19", "L-Pro ", history=history), "L-Pro")
        self.assertEqual(filters.on("2026-10-19", "  ", history=history), "Baader UHC-L")  # empty keyword: the history

    def test_bad_entries_skipped(self):
        self.assertEqual(filters.parse("13.2.2026=UHC-L;2026-02-13;2026-02-13=UHC-L"), [("2026-02-13", "UHC-L")])


if __name__ == "__main__":
    unittest.main()
