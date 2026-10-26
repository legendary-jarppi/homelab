"""The filter in the imaging train on a night.

The ASIAIR writes no FILTER keyword for a filter screwed into the train (no filter wheel), so the
history is a setting: FILTERS="2026-02-13=Baader UHC-L" (entries `<night>=<filter>`, separated by
`;`, each valid from that night on until the next; `none` for no filter). A FILTER keyword in a
frame's header wins over the history. Nights are the evening's local date, as everywhere.

The telescope service (apps/telescope/src) and its processor (apps/telescope/processor/src) keep
identical copies of this file.
"""

from __future__ import annotations

import logging
import os
import re

log = logging.getLogger("filters")

NIGHT = re.compile(r"^\d{4}-\d{2}-\d{2}$")
NONE = {"", "none", "no filter"}


def parse(raw: str) -> list[tuple[str, str | None]]:
    """`<night>=<filter>;…` → [(night, filter or None)], sorted by night; bad entries are logged and skipped."""
    history = []
    for entry in raw.split(";"):
        if not entry.strip():
            continue
        night, sep, name = entry.partition("=")
        night, name = night.strip(), name.strip()
        if not sep or not NIGHT.match(night):
            log.warning("FILTERS: ignoring %r (expected <YYYY-MM-DD>=<filter>)", entry.strip())
            continue
        history.append((night, None if name.lower() in NONE else name))
    return sorted(history)


HISTORY = parse(os.environ.get("FILTERS", ""))


def on(night: str | None, header: str | None = None, history: list[tuple[str, str | None]] | None = None) -> str | None:
    """The filter on a night: the header's FILTER keyword if it names one, else the latest history
    entry on or before the night; None for no filter (or before the first entry)."""
    if header and header.strip().lower() not in NONE:
        return header.strip()
    current = None
    for since, name in HISTORY if history is None else history:
        if night is None or since > night:
            break
        current = name
    return current
