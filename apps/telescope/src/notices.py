"""Sent markers for the web app's digests (tonight's pick, the morning report): which notification
went out when, so a restart or a second tick of telescope-web never sends one twice.
<data>/notices.json, on the backed-up data volume:

    { "<key>": unix s }      key e.g. "pick:2026-10-20", "report:2026-10-19"

Markers older than KEEP_DAYS are dropped whenever the file is written.
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import threading
import time

log = logging.getLogger("notices")

KEY = re.compile(r"^[a-z0-9:-]{1,80}\Z")
KEEP_DAYS = 90


class Notices:
    def __init__(self, data: str, clock=time.time):
        self.path = os.path.join(data, "notices.json")
        self.clock = clock
        self.lock = threading.Lock()
        try:
            with open(self.path) as f:
                loaded = json.load(f)
            self.entries: dict[str, float] = {k: float(v) for k, v in loaded.items()
                                              if isinstance(k, str) and KEY.match(k)
                                              and isinstance(v, (int, float)) and not isinstance(v, bool)}
        except FileNotFoundError:
            self.entries = {}
        except (OSError, ValueError, AttributeError) as e:
            # Keep the broken file for a look by hand; the first PUT writes a new one.
            log.error("%s: %s", self.path, e)
            self.entries = {}

    def get(self, key: str) -> dict | None:
        with self.lock:
            sent = self.entries.get(key)
        return None if sent is None else {"key": key, "sentAt": sent}

    @staticmethod
    def parse(body) -> float | str:
        """The sentAt of a PUT body, or what is wrong with it."""
        sent = body.get("sentAt") if isinstance(body, dict) else None
        if isinstance(sent, bool) or not isinstance(sent, (int, float)) or not math.isfinite(sent) or sent <= 0:
            return 'expected {"sentAt": <unix s>}'
        return float(sent)

    def put(self, key: str, sent_at: float) -> dict:
        cutoff = self.clock() - KEEP_DAYS * 86400
        with self.lock:
            entries = {k: v for k, v in self.entries.items() if v >= cutoff}
            entries[key] = sent_at
            tmp = self.path + ".tmp"
            with open(tmp, "w") as f:
                json.dump(entries, f, separators=(",", ":"))
            os.replace(tmp, self.path)
            self.entries = entries
        return {"key": key, "sentAt": sent_at}
