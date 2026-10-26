"""The digests' sent-marker store (python -m unittest discover -s tests)."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from notices import KEY, Notices  # noqa: E402

DAY = 86400
NOW = 1_792_000_000.0


class NoticesTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.data = self.dir.name

    def tearDown(self):
        self.dir.cleanup()

    def test_put_get_and_reload(self):
        store = Notices(self.data, clock=lambda: NOW)
        self.assertIsNone(store.get("pick:2026-10-20"))
        self.assertEqual(store.put("pick:2026-10-20", NOW), {"key": "pick:2026-10-20", "sentAt": NOW})
        self.assertEqual(store.get("pick:2026-10-20"), {"key": "pick:2026-10-20", "sentAt": NOW})
        again = Notices(self.data, clock=lambda: NOW)
        self.assertEqual(again.get("pick:2026-10-20")["sentAt"], NOW)
        self.assertFalse(os.path.exists(os.path.join(self.data, "notices.json.tmp")))

    def test_prunes_older_than_90_days_on_write(self):
        store = Notices(self.data, clock=lambda: NOW)
        store.put("report:old", NOW - 91 * DAY)
        store.put("report:kept", NOW - 89 * DAY)
        store.put("report:new", NOW)
        with open(os.path.join(self.data, "notices.json")) as f:
            self.assertEqual(set(json.load(f)), {"report:kept", "report:new"})
        self.assertIsNone(store.get("report:old"))

    def test_parse(self):
        self.assertEqual(Notices.parse({"sentAt": 1792000000}), 1792000000.0)
        for bad in (None, [], {}, {"sentAt": "1"}, {"sentAt": True}, {"sentAt": 0}, {"sentAt": float("nan")}):
            self.assertIsInstance(Notices.parse(bad), str, bad)

    def test_key_rule(self):
        for good in ("pick:2026-10-20", "report:2026-10-19", "a", "x" * 80):
            self.assertTrue(KEY.match(good), good)
        for bad in ("", "x" * 81, "Pick:1", "pick/1", "pick 1", "../x", "pick:2026-10-20\n"):
            self.assertFalse(KEY.match(bad), bad)

    def test_broken_file_starts_empty(self):
        with open(os.path.join(self.data, "notices.json"), "w") as f:
            f.write("{not json")
        store = Notices(self.data, clock=lambda: NOW)
        self.assertIsNone(store.get("pick:2026-10-20"))
        store.put("pick:2026-10-20", NOW)
        self.assertEqual(Notices(self.data).get("pick:2026-10-20")["sentAt"], NOW)


if __name__ == "__main__":
    unittest.main()
