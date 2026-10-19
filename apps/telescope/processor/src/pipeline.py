"""The Siril steps: masters (D2) and a target's final stack (D3).

Work happens in `<data>/work/<job>/` (removed afterwards); the archive is only read, through
symlinks (Siril's `link` makes a sequence of them). Paths given to Siril never contain spaces: the
symlinks are numbered.

Masters: bias and darks `stack … rej w 3 3 -nonorm` (winsorized sigma clipping, no normalisation);
flats calibrated with their dark-flat or bias, then `stack … rej w 3 3 -norm=mul`.

Final, per calibration group of lights (library.light_groups):
  calibrate light -dark -cc=dark 3 3 -cfa [-flat -equalize_cfa]          (dark of the exposure)
  or: thermal = dark − bias (isub); calibrate light -bias -dark=thermal -opt=exp -cc=dark 0 3
      -cfa …                              (another exposure's dark, scaled by the exposure ratio)
  or: calibrate light -bias [-flat …]; seqfind_cosme_cfa 3 3               (no dark: hot pixels
                                           from the lights themselves)
then all groups together (CFA until here):
  convert light -debayer                  (RGGB from BAYERPAT, rows top-down as the ASIAIR writes)
  seqsubsky light 1                       (each frame's own gradient: a plane)
  register bkg_light -2pass               (global star alignment, best frame as reference; flips
                                           and other nights are rotations to it)
  seqapplyreg bkg_light -framing=max      (canvas holding every frame)
  stack r_bkg_light rej <by count> -norm=addscale -maximize -weight=wfwhm -32b   → linear.fits
and the app's own version of it:
  imaging.crop_to_coverage                (the largest rectangle with data everywhere)
  subsky 1                                (linear background, nebulae spared)
  pcc -catalog=gaia                       (photometric, online: Gaia DR3 via VizieR; plate solve
                                           from the reference frame's ASIAIR solve, else Siril's)
  or imaging.star_white_balance           (when PCC cannot run)
  autostretch -linked -2.8 0.15; mirrorx  (rows top-down like the ASIAIR app and the live stack)
  savetif -astro -deflate, savejpg full size (full.jpg, the viewer's), 1504 px and 300 px
"""

from __future__ import annotations

import logging
import os
import re
import shutil
from collections.abc import Callable

import imaging
import siril
from library import Library

log = logging.getLogger("pipeline")

PREVIEW_PX = 1504
SMALL_PX = 300


def rejection(frames: int) -> tuple[str, str]:
    """Siril's rejection for a frame count (its documentation's advice) and a description."""
    if frames < 3:
        return "rej n", "no rejection (fewer than 3 frames)"
    if frames <= 6:
        return "rej p 0.2 0.1", "percentile clipping 0.2/0.1"
    if frames < 30:
        return "rej w 3 3", "winsorized sigma clipping 3/3"
    if frames < 50:
        return "rej l 5 2.5", "linear fit clipping 5/2.5"
    return "rej g 0.3 0.05", "generalized extreme studentized deviate test 0.3/0.05"


def fresh(path: str) -> str:
    shutil.rmtree(path, ignore_errors=True)
    os.makedirs(path)
    return path


def link_files(paths: list[str], folder: str) -> None:
    os.makedirs(folder, exist_ok=True)
    for i, path in enumerate(paths, 1):
        os.symlink(path, os.path.join(folder, f"{i:05d}.fit"))


def build_master(plan: dict, library: Library, work_root: str, on_log: Callable[[str], None]) -> tuple[dict, int]:
    """One master from its set; returns the stored record and Siril's peak memory."""
    s = plan["set"]
    work = fresh(os.path.join(work_root, f"master-{plan['id']}"))
    try:
        link_files([os.path.join(library.archive, rel) for rel in s["files"]], os.path.join(work, "src"))
        lines = ["cd src", "link frame -out=..", "cd .."]
        if s["type"] == "flat":
            calibrator = plan["calibrator"] or {}
            if calibrator.get("darkFlat"):
                lines.append(f"calibrate frame -dark={library.master_path(calibrator['darkFlat'])} -prefix=pp_")
            elif calibrator.get("bias"):
                lines.append(f"calibrate frame -bias={library.master_path(calibrator['bias'])} -prefix=pp_")
            seq = "pp_frame" if calibrator else "frame"
            lines.append(f"stack {seq} rej w 3 3 -norm=mul -32b -out=master")
        else:
            lines.append("stack frame rej w 3 3 -nonorm -32b -out=master")
        _, peak = siril.run(lines, work, "master", on_log)
        path = os.path.join(work, "master.fit")
        stats = imaging.master_stats(path)
        return library.add_master(plan, path, stats), peak
    finally:
        shutil.rmtree(work, ignore_errors=True)


class Final:
    """One final stack's Siril steps in its work folder."""

    def __init__(self, work: str, on_log: Callable[[str], None], on_progress: Callable[[str], None]):
        self.work = work
        self.on_log = on_log
        self.on_progress = on_progress
        self.peak = 0
        self.force_16bit = False

    def run(self, lines: list[str], name: str, label: str | None = None, count: int = 0, online: bool = False) -> list[str]:
        def progress(_text: str, pct: float) -> None:
            if label:
                self.on_progress(f"{label} {min(count, round(pct * count / 100))}/{count}" if count else label)

        if label:
            self.on_progress(f"{label} 0/{count}" if count else label)
        out, peak = siril.run(lines, self.work, name, self.on_log, progress, online=online, force_16bit=self.force_16bit)
        self.peak = max(self.peak, peak)
        return out

    def calibrate(self, index: int, paths: list[str], match: dict, master_path: Callable[[str], str]) -> str:
        """One group's calibrated CFA frames: g<index>/<prefix>light_NNNNN.fit; returns the prefix."""
        folder = fresh(os.path.join(self.work, f"g{index}"))
        link_files(paths, os.path.join(folder, "src"))
        lines = [f"cd g{index}/src", "link light -out=..", "cd .."]
        args = []
        if match["lightsBias"]:
            args.append(f"-bias={master_path(match['lightsBias'])}")
        if match["dark"] and match["darkScaled"]:
            # Siril scales the dark as given: take the bias out of it first (dark current and hot
            # pixels only), then scale by the exposure ratio. Cold pixels cannot be told in it.
            lines += [f"load {master_path(match['dark'])}", f"isub {master_path(match['lightsBias'])}", "save thermal"]
            args.append("-dark=thermal -opt=exp -cc=dark 0 3 -cfa")
        elif match["dark"]:
            args.append(f"-dark={master_path(match['dark'])} -cc=dark 3 3 -cfa")
        if match["flat"]:
            args.append(f"-flat={master_path(match['flat'])} -equalize_cfa")
        prefix = ""
        if args:
            lines.append(f"calibrate light {' '.join(args)} -prefix=pp_")
            prefix = "pp_"
        if not match["dark"]:
            lines.append(f"seqfind_cosme_cfa {prefix}light 3 3 -prefix=cc_")
            prefix = "cc_" + prefix
        self.run(lines, f"calibrate-g{index}", f"calibrating {match['night']}", len(paths))
        return prefix

    def register(self, groups: list[tuple[int, str, int]]) -> int:
        """Debayer every group's calibrated frames into one sequence, take each frame's own
        gradient out (the sky changes through a night and between nights: a plane, `seqsubsky 1`)
        and register them; returns the number of frames registered. Intermediate files are
        removed as soon as they are used."""
        folder = fresh(os.path.join(self.work, "stack"))
        src = os.path.join(folder, "src")
        os.makedirs(src)
        total = 0
        for index, prefix, count in groups:
            for n in range(1, count + 1):
                total += 1
                os.symlink(os.path.join(self.work, f"g{index}", f"{prefix}light_{n:05d}.fit"),
                           os.path.join(src, f"{total:05d}.fit"))
        self.run(["cd stack/src", "convert light -debayer -out=..", "cd .."], "debayer", "debayering", total)
        for index, _, _ in groups:
            shutil.rmtree(os.path.join(self.work, f"g{index}"), ignore_errors=True)
        shutil.rmtree(src, ignore_errors=True)
        self.run(["cd stack", "seqsubsky light 1 -samples=20 -tolerance=1.0"], "gradients", "removing gradients", total)
        self.remove("light_")
        # Framing: the bounding box of all frames (other nights, other camera angles); stack
        # -maximize then knows where each frame has data.
        out = self.run(["cd stack", "register bkg_light -2pass", "seqapplyreg bkg_light -framing=max"],
                       "register", "registering", total)
        self.remove("bkg_light_")
        exported = next((line for line in reversed(out) if line.startswith("Total:") and "exported" in line), None)
        if exported:
            return int(exported.split(",")[1].split()[0])
        return total

    def remove(self, prefix: str) -> None:
        folder = os.path.join(self.work, "stack")
        for name in os.listdir(folder):
            if name.startswith(prefix) and name.endswith(".fit"):
                os.unlink(os.path.join(folder, name))

    def stack(self, frames: int) -> str:
        method, description = rejection(frames)
        # -maximize: the canvas holds every frame, each pixel stacked from the frames that cover
        # it. Normalisation over whole frames (their gradients are gone); -overlap_norm would
        # compare every pair of frames (1.5 min for 21 frames, growing with the square).
        self.run(["cd stack", f"stack r_bkg_light {method} -norm=addscale -maximize -weight=wfwhm -32b -out=../linear"],
                 "stack", "stacking", frames)
        shutil.rmtree(os.path.join(self.work, "stack"), ignore_errors=True)
        return description

    def process(self, ra: float | None, dec: float | None, focal: float | None,
                pixel: float | None) -> tuple[str, dict]:
        """The app's own version: cut to the area with data, background, colour, stretch, TIFF
        and JPEGs (`full.jpg` at full resolution for the viewer). Returns how the colour was
        calibrated and the crop ({x, y, width, height} in the stack, 0-based)."""
        x0, y0, w, h, full_w, full_h = imaging.crop_to_coverage(os.path.join(self.work, "linear.fit"),
                                                                os.path.join(self.work, "cropped.fit"))
        self.on_log(f"processed version cut to {w}×{h} at ({x0}, {y0}) of the {full_w}×{full_h} stack (area every pixel of has data)")
        self.run(["load cropped", "subsky 1 -samples=20 -tolerance=1.0", "save bgx"], "background", "background extraction")
        solve = "platesolve"
        if ra is not None and dec is not None:
            solve += f" {ra:.5f},{dec:.5f}"
        if focal:
            solve += f" -focal={focal:g}"
        if pixel:
            solve += f" -pixelsize={pixel:g}"
        try:
            out = self.run(["load bgx", solve, "pcc -catalog=gaia", "save colour"], "pcc", "colour calibration", online=True)
            found = next((re.search(r"using (\d+) stars", line) for line in out if "solution for color calibration" in line), None)
            colour = "photometric (Siril PCC, Gaia DR3" + (f", {found[1]} stars)" if found else ")")
        except siril.SirilError as e:
            self.on_log(f"photometric colour calibration failed ({e}); using the stars' average as white")
            reason = str(e).split(": ", 1)[-1].split("; ")[0][:100]
            colour = f"stars' average as white (photometric calibration failed: {reason})"
            try:
                detail = imaging.star_white_balance(os.path.join(self.work, "bgx.fit"), os.path.join(self.work, "colour.fit"))
                self.on_log(detail)
            except ValueError as e2:
                self.on_log(f"star white balance failed ({e2}); background-neutral colours only")
                shutil.copyfile(os.path.join(self.work, "bgx.fit"), os.path.join(self.work, "colour.fit"))
                colour = f"none (photometric calibration failed: {reason}; too few stars for a white balance: {e2})"
        # Linked (keeps the calibrated colour); sky at 15 % instead of Siril's 25 %: darker, more contrast.
        self.run(["load colour", "autostretch -linked -2.8 0.15", "mirrorx", "savetif processed -astro -deflate",
                  "savejpg full 92", f"resample -maxdim={PREVIEW_PX}", "savejpg preview 90",
                  f"resample -maxdim={SMALL_PX}", "savejpg preview-small 85"], "stretch", "stretching")
        return colour, {"x": x0, "y": y0, "width": w, "height": h}
