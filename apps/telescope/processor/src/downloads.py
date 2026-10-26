"""Everything for processing a target by hand (PixInsight, Siril), as one uncompressed tar, streamed
straight from the archive (no copy; FITS do not compress much anyway):

    <target>/README.txt                              frames, decisions, integration, calibration match
    <target>/lights/<night>/Light_….fit              accepted frames, byte for byte as archived
    <target>/rejected/<night>/Light_….fit            rejected ones (only with include=rejected)
    <target>/calibration/<set id>/….fit              the raw bias/dark/flat sets the match uses
    <target>/calibration/masters/<master id>.fits    their masters (32-bit, Siril)
    <target>/final/<target>-linear.fits, …            the app's latest final of the target, if any

The length is known in advance (POSIX/pax headers are computed before streaming), so the browser
shows progress.
"""

from __future__ import annotations

import os
import tarfile
import time
from collections.abc import Iterator
from datetime import datetime
from zoneinfo import ZoneInfo

import library as lib
import siril
from finals import OUTPUTS, Finals
from library import Library
from service import Service, light_info

CHUNK = 1 << 20


def safe(name: str) -> str:
    return name.replace("/", "_").replace("\0", "").strip() or "_"


class Member:
    def __init__(self, name: str, path: str | None = None, data: bytes | None = None, mtime: float | None = None):
        self.info = tarfile.TarInfo(name)
        self.path, self.data = path, data
        if path is not None:
            st = os.stat(path)
            self.info.size, self.info.mtime = st.st_size, int(st.st_mtime)
        else:
            self.info.size, self.info.mtime = len(data or b""), int(mtime or time.time())
        self.info.mode = 0o644
        self.header = self.info.tobuf(tarfile.PAX_FORMAT, "utf-8", "surrogateescape")

    def length(self) -> int:
        return len(self.header) + self.info.size + (-self.info.size % tarfile.BLOCKSIZE)

    def chunks(self) -> Iterator[bytes]:
        yield self.header
        size = self.info.size
        if self.data is not None:
            yield self.data
        else:
            sent = 0
            with open(self.path, "rb") as f:
                while sent < size:
                    block = f.read(min(CHUNK, size - sent))
                    if not block:
                        break
                    sent += len(block)
                    yield block
            if sent < size:  # the file shrank since it was listed: keep the tar valid
                yield b"\0" * (size - sent)
        if size % tarfile.BLOCKSIZE:
            yield b"\0" * (tarfile.BLOCKSIZE - size % tarfile.BLOCKSIZE)


class Tar:
    def __init__(self, members: list[Member]):
        self.members = members
        body = sum(m.length() for m in members) + 2 * tarfile.BLOCKSIZE
        self.length = body + (-body % tarfile.RECORDSIZE)
        self.padding = self.length - body + 2 * tarfile.BLOCKSIZE

    def chunks(self) -> Iterator[bytes]:
        for m in self.members:
            yield from m.chunks()
        yield b"\0" * self.padding


def fmt_duration(seconds: float) -> str:
    h, m = divmod(round(seconds / 60), 60)
    return f"{h} h {m:02d} min" if h else f"{m} min"


def build(target: str, nights: list[str] | None, include_rejected: bool, service: Service, library: Library,
          finals: Finals, tz: ZoneInfo) -> Tar:
    """The tar for a target (LookupError when it has no frames in the archive)."""
    sessions, frames = service.frames(target, nights)
    if not frames:
        raise LookupError(f"no archived frames of {target!r}" + (f" on {', '.join(nights)}" if nights else ""))
    top = safe(target)
    accepted = [f for f in frames if f.get("accepted")]
    rejected = [f for f in frames if not f.get("accepted")]
    lights = [x for x in (light_info(f) for f in accepted) if x]
    masters = library.masters_list()
    match, groups = lib.match(lights, masters)
    by_id = {m["id"]: m for m in masters}

    members: list[Member] = []
    files: list[Member] = []
    for f in accepted:
        files.append(Member(f"{top}/lights/{f['night']}/{safe(os.path.basename(f['path']))}", f["path"]))
    if include_rejected:
        for f in rejected:
            files.append(Member(f"{top}/rejected/{f['night']}/{safe(os.path.basename(f['path']))}", f["path"]))

    used: list[str] = []
    for m in match["nights"]:
        for key in ("lightsBias", "dark", "flat", "darkFlat", "bias"):
            if m.get(key) and m[key] not in used:
                used.append(m[key])
    for mid in used:
        master = by_id.get(mid)
        if master is None:
            continue
        for sid in master["sets"]:
            s = library.set_by_id(sid)
            for rel in (s or {}).get("files", []):
                path = os.path.join(library.archive, rel)
                if os.path.isfile(path):
                    files.append(Member(f"{top}/calibration/{sid}/{safe(os.path.basename(rel))}", path))
        path = library.master_path(mid)
        if os.path.isfile(path):
            files.append(Member(f"{top}/calibration/masters/{mid}.fits", path))

    final = finals.latest_done(target)
    final_names: list[str] = []
    if final:
        for key, name in OUTPUTS.items():
            path = finals.file_path(final["id"], name)
            if path and os.path.isfile(path):
                stem, ext = os.path.splitext(name)
                final_names.append(f"{top}-{stem}{ext}")
                files.append(Member(f"{top}/final/{top}-{stem}{ext}", path))

    readme = readme_text(target, sessions, frames, accepted, rejected, include_rejected, match, by_id, final,
                         final_names, tz)
    members.append(Member(f"{top}/README.txt", data=readme.encode()))
    members += files
    return Tar(members)


def readme_text(target: str, sessions: list[dict], frames: list[dict], accepted: list[dict], rejected: list[dict],
                include_rejected: bool, match: dict, masters: dict, final: dict | None, final_names: list[str],
                tz: ZoneInfo) -> str:
    def local(ts: float | None) -> str:
        return datetime.fromtimestamp(ts, tz).strftime("%Y-%m-%d %H:%M") if ts else "?"

    out = [f"{target}: frames for your own processing", "=" * 60, "",
           f"Made {local(time.time())} ({tz.key}) by the telescope processor (Siril {siril.version()}).",
           "Times below are local; DATE-OBS in the FITS headers is UTC.", ""]
    integration = sum(f.get("exposureS") or 0 for f in accepted)
    out += [f"Nights: {', '.join(sorted({s['night'] for s in sessions}))}",
            f"Accepted: {len(accepted)} frames, {fmt_duration(integration)} ({integration:.0f} s)",
            f"Rejected: {len(rejected)} frames" + ("" if include_rejected else " (not included; add include=rejected)"), ""]
    out += ["Layout", "------",
            "lights/<night>/            accepted light frames, byte for byte as the ASIAIR saved them",
            "rejected/<night>/          rejected ones (when asked for)",
            "calibration/<set>/         the raw calibration frames of the sets matched below",
            "calibration/masters/       masters built from them with Siril (32-bit float FITS, 0..1 = 0..65535 ADU;",
            "                           flats calibrated with the bias or dark-flat named in the match)",
            "final/                     the app's latest final stack of this target (if there is one)", ""]
    out += ["Calibration match", "-----------------"]
    for m in match["nights"]:
        angle = f", camera angle {m['rotatorDeg']:.0f}°" if m["rotatorDeg"] is not None else ""
        angle += f", {m['filter']}" if m.get("filter") else ", no filter"
        out.append(f"{m['night']}: {m['frames']} × {lib.fmt_exposure(m['exposureS'] or 0)}, gain {m['gain']:g}, "
                   f"{lib.fmt_temp(m['tempC'])}{angle}" if m["gain"] is not None else
                   f"{m['night']}: {m['frames']} × {lib.fmt_exposure(m['exposureS'] or 0)}{angle}")
        for key, label in (("dark", "dark"), ("lightsBias", "bias for the lights"), ("flat", "flat"),
                           ("darkFlat", "dark-flat for the flat"), ("bias", "bias")):
            mid = m.get(key)
            if not mid or (key == "bias" and mid == m.get("lightsBias")):
                continue
            master = masters.get(mid, {})
            temp = lib.fmt_temp(master.get("tempC"))
            extra = " (scaled to the lights' exposure)" if key == "dark" and m["darkScaled"] else ""
            out.append(f"  {label}: {mid} ({master.get('frames', '?')} frames, night {master.get('night', '?')}, {temp}){extra}")
        for w in m["warnings"]:
            out.append(f"  ! {w}")
        if not m["warnings"]:
            out.append("  no warnings")
    out.append("")
    out += ["Frames", "------", "night       local time        file  decision"]
    for f in sorted(frames, key=lambda f: f.get("at") or 0):
        decision = "accepted" if f.get("accepted") else f"rejected: {f.get('rejectReason') or '?'}"
        if f.get("manual"):
            decision += " (by hand)"
        numbers = []
        if f.get("stars") is not None:
            numbers.append(f"{f['stars']} stars")
        if f.get("hfr") is not None:
            numbers.append(f"HFR {f['hfr']:.2f}")
        if f.get("backgroundAdu") is not None:
            numbers.append(f"sky {f['backgroundAdu']:.0f} ADU")
        out.append(f"{f['night']}  {local(f.get('at'))}  {os.path.basename(f['path'])}  {decision}"
                   + (f"  [{', '.join(numbers)}]" if numbers else ""))
    out.append("")
    if final:
        out += ["Final (the app's own)", "---------------------",
                f"{final['id']}: nights {', '.join(final['nights'])}, {final['stacking']['frames']} frames, "
                f"{fmt_duration(final['integrationS'] or 0)}, made {local(final['finishedAt'])}",
                f"Stacking: {final['stacking']['method']}; each frame's gradient (a plane) removed first, additive",
                "normalisation with scaling, weighted by FWHM; the canvas holds every frame (other nights and camera",
                "angles), so its edges are covered by fewer frames or none (zero): crop them",
                f"Colour: {final['colour']}",
                "Files: " + ", ".join(final_names),
                "  *-linear.fits: 32-bit linear RGB stack (calibrated, registered, not stretched; plate solve of the",
                "                 reference frame in the header): start here",
                "  *-processed.tif: cut to the fully covered area, background extracted, colour calibrated,",
                "                   auto-stretched (16-bit)", ""]
    else:
        out += ["No final stack of this target yet.", ""]
    return "\n".join(out) + "\n"
