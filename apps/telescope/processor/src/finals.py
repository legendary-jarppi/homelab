"""Final stacks (D3): the queue, the one worker, and the automatic jobs after a night.

A final is `<data>/finals/<id>/final.json` (the record the API shows), `log.txt` (Siril's log) and
the outputs (`linear.fits`, `processed.tif`, `preview.jpg`, `preview-small.jpg`). One job at a
time; the same worker builds masters when no final is waiting. A newer request for a target
replaces its queued (not yet running) final. A final that was running when the processor stopped
is marked failed (it may have been killed for memory: not retried by itself).

Automatic: every `AUTO_CHECK_S`, when no session is active, the newest frame is at least
`AUTO_QUIET_H` old and the local time is within `AUTO_HOURS`, every target whose sessions changed
(new accepted frames, decisions by hand) since its last final gets one over all its nights.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import statistics
import threading
import time
from collections import deque
from datetime import datetime
from zoneinfo import ZoneInfo

import library as lib
import pipeline
import siril
from library import Library
from service import Service, ServiceError, light_info

log = logging.getLogger("finals")

OUTPUTS = {"linearFits": "linear.fits", "processedTiff": "processed.tif", "previewJpg": "preview.jpg",
           "previewSmallJpg": "preview-small.jpg"}
FILES = set(OUTPUTS.values()) | {"log.txt"}
LOG_TAIL = 200
MIN_FRAMES = 2
PUBLIC = ("id", "target", "nights", "sessions", "frames", "integrationS", "status", "progress", "createdAt",
          "startedAt", "finishedAt", "error", "automatic", "calibration", "outputs", "stacking", "colour", "siril",
          "durationS", "peakMemoryBytes")


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "target"


def fingerprint(sessions: list[dict]) -> str:
    """What a final of these sessions was built from: each session's accepted frames and integration."""
    parts = sorted((s["id"], s.get("accepted"), s.get("integrationS")) for s in sessions)
    return hashlib.sha1(json.dumps(parts).encode()).hexdigest()[:12]


class Finals:
    def __init__(self, data: str, library: Library, service: Service, tz: ZoneInfo, keep: int,
                 work_max_bytes: int, library_scan_s: float):
        self.folder = os.path.join(data, "finals")
        self.work_root = os.path.join(data, "work")
        os.makedirs(self.folder, exist_ok=True)
        shutil.rmtree(self.work_root, ignore_errors=True)  # whatever a stopped job left
        os.makedirs(self.work_root)
        self.library = library
        self.service = service
        self.tz = tz
        self.keep = keep
        self.work_max_bytes = work_max_bytes
        self.library_scan_s = library_scan_s
        self.lock = threading.Lock()
        self.wake = threading.Condition(self.lock)
        self.finals: dict[str, dict] = {}
        self.logs: dict[str, deque] = {}
        self.running: str | None = None
        self.issued: set[str] = set()
        self.last: dict[str, dict] = {}  # kind → {durationS, ok, at}
        for name in os.listdir(self.folder):
            try:
                with open(os.path.join(self.folder, name, "final.json")) as f:
                    final = json.load(f)
            except (OSError, ValueError):
                continue
            if final["status"] == "running":
                final.update(status="failed", progress=None, finishedAt=time.time(),
                             error="interrupted: the processor stopped while it ran (restart, or out of memory)")
                self._write(final)
            self.finals[final["id"]] = final

    # --- records ---

    def _dir(self, fid: str) -> str:
        return os.path.join(self.folder, fid)

    def _write(self, final: dict) -> None:
        folder = self._dir(final["id"])
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "final.json")
        with open(path + ".tmp", "w") as f:
            json.dump(final, f)
        os.replace(path + ".tmp", path)

    def public(self, final: dict, with_log: bool = False) -> dict:
        out = {k: final.get(k) for k in PUBLIC}
        out["outputs"] = {k: (f"/finals/{final['id']}/{name}" if name in final.get("files", []) else None)
                          for k, name in OUTPUTS.items()}
        if with_log:
            tail = self.logs.get(final["id"])
            if tail is None:
                try:
                    with open(os.path.join(self._dir(final["id"]), "log.txt"), errors="replace") as f:
                        tail = deque(f.read().splitlines(), LOG_TAIL)
                except OSError:
                    tail = deque()
            out["log"] = list(tail)
        return out

    def list(self) -> list[dict]:
        with self.lock:
            finals = sorted(self.finals.values(), key=lambda f: f["createdAt"], reverse=True)
            return [self.public(f) for f in finals]

    def get(self, fid: str) -> dict | None:
        with self.lock:
            final = self.finals.get(fid)
            return self.public(final, with_log=True) if final else None

    def latest_done(self, target: str) -> dict | None:
        with self.lock:
            done = [f for f in self.finals.values() if f["target"] == target and f["status"] == "done"]
            return dict(max(done, key=lambda f: f["finishedAt"])) if done else None

    def file_path(self, fid: str, name: str) -> str | None:
        with self.lock:
            final = self.finals.get(fid)
            if final is None or name not in FILES or (name != "log.txt" and name not in final.get("files", [])):
                return None
        return os.path.join(self._dir(fid), name)

    def queue_length(self) -> int:
        with self.lock:
            return sum(1 for f in self.finals.values() if f["status"] == "queued")

    def counts(self) -> dict[str, int]:
        with self.lock:
            out = {"queued": 0, "running": 0, "done": 0, "failed": 0}
            for f in self.finals.values():
                out[f["status"]] += 1
            return out

    # --- requests ---

    def create(self, target: str, nights: list[str] | None, automatic: bool) -> dict:
        """Queue a final (ServiceError if the service does not answer, LookupError for an unknown
        target or night)."""
        sessions = self.service.target_sessions(target)
        if not sessions:
            raise LookupError(f"no sessions of {target!r}")
        if nights:
            unknown = sorted(set(nights) - {s["night"] for s in sessions})
            if unknown:
                raise LookupError(f"{target!r} has no session on {', '.join(unknown)}")
            sessions = [s for s in sessions if s["night"] in nights]
        now = time.time()
        stamp = datetime.fromtimestamp(now, self.tz).strftime("%Y%m%d-%H%M%S")
        final = {
            "id": f"{stamp}-{slug(target)}", "target": target,
            "nights": sorted({s["night"] for s in sessions}), "sessions": [s["id"] for s in sessions],
            "frames": sum(s.get("accepted") or 0 for s in sessions),
            "integrationS": sum(s.get("integrationS") or 0 for s in sessions),
            "status": "queued", "progress": None, "createdAt": now, "startedAt": None, "finishedAt": None,
            "error": None, "automatic": automatic, "calibration": None, "stacking": None, "colour": None,
            "siril": None, "durationS": None, "peakMemoryBytes": None, "files": [],
            "fingerprint": fingerprint(sessions), "allNights": not nights,
        }
        with self.lock:
            # Unique also against superseded ones (a client may still poll those).
            base, n = final["id"], 1
            while final["id"] in self.finals or final["id"] in self.issued:
                n += 1
                final["id"] = f"{base}-{n}"
            self.issued.add(final["id"])
            for old in [f for f in self.finals.values() if f["target"] == target and f["status"] == "queued"]:
                del self.finals[old["id"]]
                shutil.rmtree(self._dir(old["id"]), ignore_errors=True)
                log.info("final %s superseded by %s", old["id"], final["id"])
            self.finals[final["id"]] = final
            self._write(final)
            self.wake.notify_all()
        log.info("final %s queued (%s): %s, nights %s, %d frames", final["id"], "automatic" if automatic else "by hand",
                 target, ", ".join(final["nights"]), final["frames"])
        return self.public(final)

    def automatic(self, auto_hours: tuple[int, int], quiet_s: float) -> None:
        """Queue finals for targets with new accepted frames, in the daytime after a night."""
        try:
            sessions = self.service.sessions()
        except ServiceError as e:
            log.warning("automatic finals: %s", e)
            return
        if not sessions or any(s.get("active") for s in sessions):
            return
        if time.time() - max(s["lastFrameAt"] for s in sessions) < quiet_s:
            return
        hour = datetime.now(self.tz).hour
        if not auto_hours[0] <= hour < auto_hours[1]:
            return
        by_target: dict[str, list[dict]] = {}
        for s in sessions:
            by_target.setdefault(s["target"], []).append(s)
        for target, own in sorted(by_target.items()):
            if sum(s.get("accepted") or 0 for s in own) < MIN_FRAMES:
                continue
            fp = fingerprint(own)
            with self.lock:
                known = any(f["target"] == target and f["fingerprint"] == fp for f in self.finals.values())
            if not known:
                try:
                    self.create(target, None, automatic=True)
                except (ServiceError, LookupError) as e:
                    log.warning("automatic final of %s: %s", target, e)

    # --- the worker ---

    def worker(self) -> None:
        last_scan = 0.0
        while True:
            if time.time() - last_scan >= self.library_scan_s:
                try:
                    self.library.scan()
                except OSError as e:
                    log.error("library scan: %s", e)
                last_scan = time.time()
            with self.lock:
                queued = sorted((f for f in self.finals.values() if f["status"] == "queued"), key=lambda f: f["createdAt"])
                job = queued[0] if queued else None
                if job:
                    job.update(status="running", startedAt=time.time(), progress="preparing")
                    self.running = job["id"]
                    self._write(job)
            if job:
                self.run_final(job)
                continue
            if self.build_masters():
                continue
            with self.lock:
                self.wake.wait(timeout=min(60, self.library_scan_s))

    def build_masters(self, on_log=None) -> int:
        built = 0
        for plan in self.library.pending():
            started = time.time()
            say = on_log or (lambda line: None)
            say(f"building master {plan['id']} ({plan['set']['count']} frames)")
            try:
                record, peak = pipeline.build_master(plan, self.library, self.work_root, lambda line: None)
            except (siril.SirilError, OSError, ValueError) as e:
                log.error("master %s failed: %s", plan["id"], e)
                self.library.add_failure(plan, str(e))
                self.last["master"] = {"durationS": time.time() - started, "ok": False, "at": time.time()}
                continue
            built += 1
            took = time.time() - started
            self.last["master"] = {"durationS": took, "ok": True, "at": time.time()}
            log.info("master %s: %d frames, median %.1f ADU, noise %.2f ADU, %.1f s, Siril peak %.0f MB",
                     record["id"], record["frames"], record["median"], record["noise"], took, peak / 2**20)
            say(f"master {record['id']} built in {took:.0f} s")
        return built

    def run_final(self, final: dict) -> None:
        fid = final["id"]
        folder = self._dir(fid)
        work = pipeline.fresh(os.path.join(self.work_root, fid))
        tail: deque = deque(maxlen=LOG_TAIL)
        logfile = open(os.path.join(folder, "log.txt"), "w")
        with self.lock:
            self.logs[fid] = tail

        def say(line: str) -> None:
            stamped = f"{datetime.now(self.tz).strftime('%H:%M:%S')} {line}"
            tail.append(stamped)
            logfile.write(stamped + "\n")
            logfile.flush()

        def progress(text: str) -> None:
            with self.lock:
                if final["progress"] != text:
                    final["progress"] = text

        started = time.time()
        timings: dict[str, float] = {}
        try:
            say(f"final of {final['target']}, nights {', '.join(final['nights'])} ({'automatic' if final['automatic'] else 'by hand'}), Siril {siril.version()}")
            progress("building masters")
            self.library.scan()
            self.build_masters(say)
            t = time.time()
            progress("preparing")
            plan = self.prepare(final, say)
            timings["prepare"] = time.time() - t
            with self.lock:
                final.update(calibration=plan["calibration"], frames=plan["frames"], integrationS=plan["integrationS"],
                             sessions=plan["sessions"], siril=siril.version())
                self._write(final)
            steps = pipeline.Final(work, say, progress)
            need = plan["frames"] * plan["width"] * plan["height"] * 3 * 4 * 2.4
            free = shutil.disk_usage(self.work_root).free
            if need > min(self.work_max_bytes, free * 0.9):
                steps.force_16bit = True
                say(f"intermediate frames in 16 bit: 32 bit needs ~{need / 1e9:.0f} GB, "
                    f"limit {self.work_max_bytes / 1e9:.0f} GB, {free / 1e9:.0f} GB free")
                if need / 2 > free * 0.9:
                    raise RuntimeError(f"not enough disk for {plan['frames']} frames: ~{need / 2e9:.0f} GB needed, {free / 1e9:.0f} GB free")
            t = time.time()
            groups = []
            for i, (group, match) in enumerate(plan["groups"], 1):
                say(f"group {i}: {match['night']}, {len(group['frames'])} × {lib.fmt_exposure(group['exposureS'])}, "
                    f"{lib.fmt_temp(group['sensorTempC'])}, angle {group['angles']}: bias {match['lightsBias']}, "
                    f"dark {match['dark']}{' (scaled)' if match['darkScaled'] else ''}, flat {match['flat']}")
                for w in match["warnings"]:
                    say(f"  warning: {w}")
                prefix = steps.calibrate(i, [f["path"] for f in group["frames"]], match, self.library.master_path)
                groups.append((i, prefix, len(group["frames"])))
            timings["calibrate"] = time.time() - t
            t = time.time()
            registered = steps.register(groups)
            timings["register"] = time.time() - t
            if registered < MIN_FRAMES:
                raise RuntimeError(f"only {registered} of {plan['frames']} frames registered")
            t = time.time()
            method = steps.stack(registered)
            timings["stack"] = time.time() - t
            t = time.time()
            colour = steps.process(plan["ra"], plan["dec"], plan["focal"], plan["pixel"])
            timings["process"] = time.time() - t
            files = []
            for src, name in (("linear.fit", "linear.fits"), ("processed.tif", "processed.tif"),
                              ("preview.jpg", "preview.jpg"), ("preview-small.jpg", "preview-small.jpg")):
                os.replace(os.path.join(work, src), os.path.join(folder, name))
                files.append(name)
            took = time.time() - started
            say("timings: " + ", ".join(f"{k} {v:.0f} s" for k, v in timings.items()) + f"; total {took:.0f} s; "
                f"Siril peak {steps.peak / 2**20:.0f} MB")
            with self.lock:
                final.update(status="done", progress=None, finishedAt=time.time(), files=files, colour=colour,
                             stacking={"method": method, "frames": registered, "registered": registered,
                                       "intermediate": "16-bit" if steps.force_16bit else "32-bit",
                                       "timingsS": {k: round(v, 1) for k, v in timings.items()}},
                             durationS=round(took, 1), peakMemoryBytes=steps.peak)
                self._write(final)
            self.last["final"] = {"durationS": took, "ok": True, "at": time.time()}
            log.info("final %s done: %d frames, %s, %.0f s", fid, registered, colour, took)
            self.prune(final["target"])
        except (siril.SirilError, ServiceError, OSError, ValueError, RuntimeError, LookupError) as e:
            say(f"failed: {e}")
            log.error("final %s failed: %s", fid, e)
            with self.lock:
                final.update(status="failed", progress=None, finishedAt=time.time(), error=str(e),
                             durationS=round(time.time() - started, 1))
                self._write(final)
            self.last["final"] = {"durationS": time.time() - started, "ok": False, "at": time.time()}
        finally:
            logfile.close()
            shutil.rmtree(work, ignore_errors=True)
            with self.lock:
                self.running = None
                self.logs.pop(fid, None)

    def prepare(self, final: dict, say) -> dict:
        """The accepted frames (from the service, in the archive), their calibration groups and
        the masters for each."""
        sessions, frames = self.service.frames(final["target"], None if final.get("allNights") else final["nights"])
        if not final.get("allNights"):
            sessions = [s for s in sessions if s["night"] in final["nights"]]
        accepted = [f for f in frames if f.get("accepted")]
        lights = [x for x in (light_info(f) for f in accepted) if x]
        if len(lights) < MIN_FRAMES:
            raise RuntimeError(f"{len(lights)} accepted frames in the archive, at least {MIN_FRAMES} needed")
        sizes = {(x["width"], x["height"]) for x in lights}
        if len(sizes) > 1:
            biggest = max(sizes, key=lambda s: sum(1 for x in lights if (x["width"], x["height"]) == s))
            say(f"frames of {len(sizes)} sizes: only the {biggest[0]}×{biggest[1]} ones are stacked")
            lights = [x for x in lights if (x["width"], x["height"]) == biggest]
        match, groups = lib.match(lights, self.library.masters_list())
        say(f"{len(lights)} accepted frames in {len(groups)} calibration group(s); "
            f"{len(frames) - len(accepted)} rejected or failed frames left out")
        first = lights[0]
        pointed = next((x for x in lights if x["ra"] is not None and x["dec"] is not None), None)
        ra, dec = (pointed["ra"], pointed["dec"]) if pointed else (None, None)
        return {
            "sessions": [s["id"] for s in sessions],
            "frames": len(lights),
            "integrationS": round(sum(x["exposureS"] or 0 for x in lights)),
            "calibration": match,
            "groups": list(zip(groups, match["nights"])),
            "width": first["width"], "height": first["height"],
            "ra": ra, "dec": dec,
            "focal": statistics.median([x["focalMm"] for x in lights if x.get("focalMm")] or [0]) or None,
            "pixel": statistics.median([x["pixelUm"] for x in lights if x.get("pixelUm")] or [0]) or None,
        }

    def prune(self, target: str) -> None:
        """The newest `keep` done finals of a target, and failed ones of the last week."""
        with self.lock:
            own = sorted((f for f in self.finals.values() if f["target"] == target), key=lambda f: f["createdAt"], reverse=True)
            done = [f for f in own if f["status"] == "done"]
            old = done[self.keep:] + [f for f in own if f["status"] == "failed" and time.time() - f["createdAt"] > 7 * 86400]
            for f in old:
                del self.finals[f["id"]]
        for f in old:
            shutil.rmtree(self._dir(f["id"]), ignore_errors=True)
            log.info("final %s removed (older than the newest %d)", f["id"], self.keep)
