"""Integration goals and the wishlist per target, chosen in the web app (catalog ids such as
`NGC 7000`, `M 31`, `Sh2-155`): <data>/targets.json, on the backed-up data volume.

    { "<key>": { "goalHours": number|null, "wishlist": bool, "note": string|null, "updatedAt": unix s } }

A PUT changes only the fields it names; null clears a field; an entry with everything cleared is
removed.
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import threading
import time

log = logging.getLogger("targets")

KEY = re.compile(r"^[A-Za-z0-9 +._()-]{1,64}$")
MAX_GOAL_HOURS = 1000
MAX_NOTE = 500


class Targets:
    def __init__(self, data: str):
        self.path = os.path.join(data, "targets.json")
        self.lock = threading.Lock()
        try:
            with open(self.path) as f:
                self.entries: dict[str, dict] = json.load(f)
        except FileNotFoundError:
            self.entries = {}
        except (OSError, ValueError) as e:
            # Keep the broken file for a look by hand; the first PUT writes a new one.
            log.error("%s: %s", self.path, e)
            self.entries = {}

    def all(self) -> dict:
        with self.lock:
            return {"targets": {k: dict(v) for k, v in self.entries.items()}}

    @staticmethod
    def parse(body) -> dict | str:
        """The fields of a PUT body, or what is wrong with it."""
        if not isinstance(body, dict) or not body or set(body) - {"goalHours", "wishlist", "note"}:
            return 'expected {"goalHours"?, "wishlist"?, "note"?}'
        out = {}
        if "goalHours" in body:
            goal = body["goalHours"]
            if goal is not None and (isinstance(goal, bool) or not isinstance(goal, (int, float))
                                     or not math.isfinite(goal) or not 0 < goal <= MAX_GOAL_HOURS):
                return f"goalHours: a number of hours (0 < h <= {MAX_GOAL_HOURS}) or null"
            out["goalHours"] = None if goal is None else round(float(goal), 2)
        if "wishlist" in body:
            if body["wishlist"] not in (True, False, None):
                return "wishlist: true, false or null"
            out["wishlist"] = bool(body["wishlist"])
        if "note" in body:
            note = body["note"]
            if note is not None and (not isinstance(note, str) or len(note) > MAX_NOTE):
                return f"note: text up to {MAX_NOTE} characters or null"
            out["note"] = (note or "").strip() or None
        return out

    def put(self, key: str, fields: dict) -> dict:
        now = time.time()
        with self.lock:
            entry = {"goalHours": None, "wishlist": False, "note": None, **self.entries.get(key, {}), **fields}
            entry["updatedAt"] = now
            entries = dict(self.entries)
            if entry["goalHours"] is None and not entry["wishlist"] and entry["note"] is None:
                entries.pop(key, None)
            else:
                entries[key] = entry
            tmp = self.path + ".tmp"
            with open(tmp, "w") as f:
                json.dump(entries, f, separators=(",", ":"))
            os.replace(tmp, self.path)
            self.entries = entries
        return dict(entry)
