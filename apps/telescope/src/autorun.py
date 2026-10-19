"""The ASIAIR's Autorun log (log/Autorun_Log_<date>_<time>.txt, one per plan or autorun run):

    2026/04/10 22:33:12 Plan  coddington Start
    2026/04/10 22:33:13 [Autorun|Begin] IC 2574 Start
    2026/04/10 22:33:44 Shooting 70 light frames, exposure 300.0s Bin1
    2026/04/10 22:33:44 [AutoFocus|Begin] Run AF before Autorun start, exposure 2.0s Bin1, temperature 11.0℃
    2026/04/10 22:35:41 [AutoFocus|End] Auto focus succeeded
    2026/04/10 22:36:02 Exposure 300.0s image 1#
    2026/04/11 04:39:54 [Autorun|End] Finish Autorun
    2026/04/11 04:39:54 Plan  coddington Finish
    Log disabled at 2026/04/11 04:40:11

Times are the ASIAIR's local clock (it takes the phone's time).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

LINE = re.compile(r"^(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}) (.*)$")
PLAN = re.compile(r"^Plan\s+(.*?)\s+(Start|Finish|Stop\w*)$")
STEP = re.compile(r"^\[(\w+)\|(Begin|End)\]\s*(.*)$")
SHOOTING = re.compile(r"^Shooting (\d+) light frames, exposure ([\d.]+)s")
EXPOSURE = re.compile(r"^Exposure ([\d.]+)s image (\d+)#")
# Step-by-step focus measurements: too many for the event list.
NOISE = re.compile(r"^(Find Focus Star|Calculate V-Curve|Calculate Focus Point|Find Focus Point|Exposure [\d.]+s image)")
STEP_NAMES = {
    "Autorun": "Exposing",
    "AutoFocus": "Auto focus",
    "AutoCenter": "Centering",
    "MeridianFlip": "Meridian flip",
}


def step_name(raw: str) -> str:
    return STEP_NAMES.get(raw) or re.sub(r"(?<=[a-z])(?=[A-Z])", " ", raw).capitalize()


@dataclass
class Plan:
    name: str | None = None
    target: str | None = None
    planned: int | None = None
    current: int | None = None
    exposure_s: float | None = None
    state: str = "running"
    activity: str | None = None
    started_at: float | None = None
    updated_at: float | None = None
    events: list[tuple[float, str]] = field(default_factory=list)

    def json(self) -> dict:
        return {
            "name": self.name,
            "target": self.target,
            "planned": self.planned,
            "current": self.current,
            "exposureS": self.exposure_s,
            "state": self.state,
            "activity": self.activity,
            "startedAt": self.started_at,
            "updatedAt": self.updated_at,
            "events": [{"at": at, "text": text} for at, text in reversed(self.events[-15:])],
        }


def parse(text: str, tz: ZoneInfo) -> Plan | None:
    plan = Plan()
    seen = False
    for raw in text.splitlines():
        if raw.startswith("Log disabled"):
            if plan.state == "running":
                plan.state = "stopped"
                plan.activity = None
            continue
        m = LINE.match(raw.strip())
        if not m:
            continue
        at = datetime.strptime(m[1], "%Y/%m/%d %H:%M:%S").replace(tzinfo=tz).timestamp()
        text_ = m[2].strip()
        seen = True
        plan.started_at = plan.started_at or at
        plan.updated_at = at
        if not NOISE.match(text_):
            plan.events.append((at, text_))
        if p := PLAN.match(text_):
            plan.name = p[1]
            if p[2] == "Start":
                plan.state, plan.activity = "running", None
            else:
                plan.state = "finished" if p[2] == "Finish" else "stopped"
                plan.activity = "Finished" if p[2] == "Finish" else None
        elif s := STEP.match(text_):
            name, edge, rest = s[1], s[2], s[3]
            if name == "Autorun":
                if edge == "Begin":
                    plan.target = rest.removesuffix(" Start").strip() or plan.target
                    plan.state, plan.activity = "running", "Starting"
                    plan.planned = plan.current = None
                elif "Finish" in rest:
                    plan.state, plan.activity = "finished", "Finished"
                else:
                    plan.state, plan.activity = "stopped", None
            elif edge == "Begin":
                plan.activity = step_name(name)
            elif plan.state == "running":
                plan.activity = "Exposing" if plan.current else "Preparing"
        elif s := SHOOTING.match(text_):
            plan.planned, plan.exposure_s = int(s[1]), float(s[2])
        elif e := EXPOSURE.match(text_):
            plan.exposure_s, plan.current = float(e[1]), int(e[2])
            plan.activity = "Exposing"
        elif text_.startswith("[Guide] Guide Settle"):
            plan.activity = "Guiding settle"
    return plan if seen else None


@dataclass
class Target:
    """One target's part of a run: [Autorun|Begin] … [Autorun|End]."""

    name: str
    index: int
    started_at: float
    ended_at: float | None = None
    planned: int | None = None
    current: int | None = None


@dataclass
class Log:
    """A whole Autorun log as timeline events (at, kind, text) and per-target parts."""

    started_at: float
    ended_at: float
    events: list[tuple[float, str, str]]
    targets: list[Target]


def step_kind(name: str) -> str | None:
    name = name.lower()
    for key, kind in (("meridian", "meridian_flip"), ("focus", "autofocus"), ("center", "centering"), ("goto", "goto")):
        if key in name:
            return kind
    return None


def timeline(text: str, tz: ZoneInfo) -> Log | None:
    events: list[tuple[float, str, str]] = []
    targets: list[Target] = []
    first = last = None
    for raw in text.splitlines():
        m = LINE.match(raw.strip())
        if not m:
            continue
        at = datetime.strptime(m[1], "%Y/%m/%d %H:%M:%S").replace(tzinfo=tz).timestamp()
        line = m[2].strip()
        first, last = first or at, at
        if p := PLAN.match(line):
            events.append((at, "plan_start" if p[2] == "Start" else "plan_end", line))
        elif s := STEP.match(line):
            name, edge, rest = s[1], s[2], s[3]
            if name == "Autorun":
                if edge == "Begin":
                    target = rest.removesuffix(" Start").strip()
                    targets.append(Target(target, len(targets) + 1, at))
                    events.append((at, "target_start", line))
                elif targets:
                    targets[-1].ended_at = at
            elif edge == "Begin" and (kind := step_kind(name)):
                events.append((at, kind, line))
        elif (s := SHOOTING.match(line)) and targets:
            targets[-1].planned = int(s[1])
        elif (e := EXPOSURE.match(line)) and targets:
            targets[-1].current = int(e[2])
        elif "lost" in line.lower() and "guide" in line.lower():
            events.append((at, "guiding_lost", line))
    if first is None:
        return None
    return Log(first, last, events, targets)
