"""Checks of the end-to-end run on the synthetic archive (run by e2e.sh inside the processor's
container, beside the running processor at localhost:8080 and the fake service).

What it checks and prints:
- the library: sets and masters, bias level ~ offset × 16, dark ~ bias;
- the match: the deliberately missing dark (night 2, 180 s) and the 41-day-old flat (night 1);
- the automatic final and a manual one (one superseded while queued);
- calibration in the final stack: the dust donuts of every frame, mapped through the plate solves
  into the stack, against the same measured on a raw frame (uncorrected); the vignetting as the
  radial falloff of the sky against the known synthetic nebula, stack vs raw frame;
- stars: FWHM and elongation of the bright ones in the stack; the satellite trail rejected;
- the tar: length as announced, every member, a light byte for byte, the README.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import os
import sys
import tarfile
import time
import urllib.parse
import urllib.request

import numpy as np

sys.path.insert(0, "/app/src")
sys.path.insert(0, os.path.dirname(__file__))
import fitsio  # noqa: E402
import synthetic  # noqa: E402

API = "http://localhost:8080"
ARCHIVE = "/archive"
PROCESSED = "/processed"
failures: list[str] = []


def check(ok: bool, what: str) -> None:
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        failures.append(what)


def get(path: str):
    with urllib.request.urlopen(API + path, timeout=120) as r:
        return json.load(r)


def post(path: str, body: dict) -> tuple[int, dict]:
    req = urllib.request.Request(API + path, json.dumps(body).encode(), {"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, json.load(r)


def wait_done(ids: list[str], timeout: float = 3600) -> dict[str, dict]:
    started = time.time()
    while time.time() - started < timeout:
        finals = {f["id"]: f for f in get("/api/finals")}
        if all(finals.get(i, {}).get("status") in ("done", "failed") for i in ids):
            return finals
        time.sleep(5)
    raise SystemExit(f"finals {ids} not done after {timeout:.0f} s")


# --- geometry: the plate solves ---

class Wcs:
    def __init__(self, header: dict[str, str]):
        n = lambda k: fitsio.number(header, k)  # noqa: E731
        self.crpix = np.array([n("CRPIX1"), n("CRPIX2")])
        self.crval = (n("CRVAL1"), n("CRVAL2"))
        if n("CD1_1") is not None:
            self.cd = np.array([[n("CD1_1"), n("CD1_2")], [n("CD2_1"), n("CD2_2")]])
        else:
            pc = np.array([[n("PC1_1") or 1, n("PC1_2") or 0], [n("PC2_1") or 0, n("PC2_2") or 1]])
            self.cd = np.diag([n("CDELT1"), n("CDELT2")]) @ pc
        self.inv = np.linalg.inv(self.cd)

    def to_sky(self, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """0-based array column/row (any shape) → RA/Dec (degrees)."""
        shape = np.shape(x)
        d = np.stack([np.ravel(x) + 1 - self.crpix[0], np.ravel(y) + 1 - self.crpix[1]])
        xi, eta = np.radians(self.cd @ d)
        a0, d0 = map(math.radians, self.crval)
        rho = np.hypot(xi, eta)
        c = np.arctan(rho)
        with np.errstate(invalid="ignore", divide="ignore"):
            dec = np.arcsin(np.cos(c) * math.sin(d0) + np.where(rho > 0, eta * np.sin(c) * math.cos(d0) / rho, 0))
            ra = a0 + np.arctan2(xi * np.sin(c), rho * math.cos(d0) * np.cos(c) - eta * math.sin(d0) * np.sin(c))
        return (np.degrees(ra) % 360).reshape(shape), np.degrees(dec).reshape(shape)

    def to_pixel(self, ra: np.ndarray, dec: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        shape = np.shape(ra)
        xi, eta = synthetic.tangent(np.ravel(ra), np.ravel(dec), *self.crval)
        p = self.inv @ np.stack([xi, eta])
        return (p[0] + self.crpix[0] - 1).reshape(shape), (p[1] + self.crpix[1] - 1).reshape(shape)


def green_superpixel(raw_path: str) -> np.ndarray:
    """A raw light, bias taken off, as its green plane at full size (each 2×2 cell's two greens)."""
    header, offset = fitsio.read_header(raw_path)
    with open(raw_path, "rb") as f:
        raw = f.read()
    n = int(header["NAXIS1"])
    a = np.frombuffer(raw, ">i2", count=n * n, offset=offset).reshape(n, n).astype(np.float32) + 32768 - synthetic.BIAS_DN * 4
    g = 0.5 * (a[0::2, 1::2] + a[1::2, 0::2])
    return np.repeat(np.repeat(g, 2, axis=0), 2, axis=1)


def ring_ratio(plane: np.ndarray, x: float, y: float, radius: float) -> float:
    """Median in the donut's ring over the median just outside it (1 = no dust)."""
    r0 = int(radius * 2.2)
    cx, cy = int(round(x)), int(round(y))
    cut = plane[cy - r0 : cy + r0 + 1, cx - r0 : cx + r0 + 1]
    yy, xx = np.mgrid[cy - r0 : cy + r0 + 1, cx - r0 : cx + r0 + 1]
    rr = np.hypot(xx - x, yy - y) / radius
    ring = np.nanmedian(cut[(rr > 0.45) & (rr < 0.9)])
    outside = np.nanmedian(cut[(rr > 1.3) & (rr < 2.0)])
    return float(ring / outside)


def dust_in_frame(turn: float, size: int) -> list[tuple[float, float, float, float]]:
    """(x, y, radius, depth) of the synthetic dust donuts in a frame's pixels (0-based), as
    synthetic.Optics puts them for a camera turned by `turn` against the optics."""
    s = size / 3008
    dust = [(-610 * s, 420 * s, 62 * s, 0.11), (380 * s, -720 * s, 45 * s, 0.08), (930 * s, 640 * s, 75 * s, 0.07)]
    c, sn = math.cos(math.radians(turn)), math.sin(math.radians(turn))
    centre = (size - 1) / 2
    return [(centre + c * dx - sn * dy, centre + sn * dx + c * dy, r, depth) for dx, dy, r, depth in dust]


def vignetting_profile(plane: np.ndarray, wcs: Wcs, optical_xy: tuple[float, float]) -> tuple[float, float]:
    """Radial falloff of the sky around the optical centre: block medians (64 px) fitted as
    a + b·x + c·y (the light-pollution gradient) + d·r² + e·nebula (the known synthetic one);
    returns d·(1300² − 650²)/a, the sky lost from 650 to 1300 px out as a fraction (0 = flat;
    the synthetic vignetting is about −0.14), and the fit's residual RMS as a fraction."""
    h, w = plane.shape
    b = 64
    ys, xs = np.mgrid[b // 2 : h - b // 2 : b, b // 2 : w - b // 2 : b]
    med = np.array([[np.nanmedian(plane[y - b // 2 : y + b // 2, x - b // 2 : x + b // 2]) if
                     np.isfinite(plane[y - b // 2 : y + b // 2, x - b // 2 : x + b // 2]).any() else np.nan
                     for x in xs[0]] for y in ys[:, 0]])
    ra, dec = wcs.to_sky(xs.astype(float), ys.astype(float))
    xi, eta = synthetic.tangent(ra, dec, synthetic.RA0, synthetic.DEC0)
    neb = synthetic.nebula(xi, eta)[1]
    x, y = xs - optical_xy[0], ys - optical_xy[1]
    r2 = x**2 + y**2
    ok = np.isfinite(med) & (med != 0) & (r2 < 1500**2)
    A = np.stack([np.ones(ok.sum()), x[ok], y[ok], r2[ok], neb[ok]], axis=1)
    coef, *_ = np.linalg.lstsq(A, med[ok], rcond=None)
    resid = (med[ok] - A @ coef) / coef[0]
    return float(coef[3] * (1300**2 - 650**2) / coef[0]), float(np.sqrt(np.mean(resid**2)))


def star_shapes(plane: np.ndarray) -> tuple[float, float, int]:
    """Median FWHM (px) and elongation (1 − minor/major) of bright unsaturated stars."""
    bg = np.nanmedian(plane[::8, ::8])
    noise = np.nanmedian(np.abs(plane[::8, ::8] - bg)) * 1.4826
    p = np.nan_to_num(plane - bg)
    peak = p.copy()
    for dy in (-2, -1, 0, 1, 2):
        for dx in (-2, -1, 0, 1, 2):
            if dx or dy:
                np.maximum(peak, np.roll(p, (dy, dx), axis=(0, 1)), out=peak)
    cand = (p == peak) & (p > 60 * noise) & (p < 0.5 * np.nanmax(p))
    cand[:20], cand[-20:], cand[:, :20], cand[:, -20:] = False, False, False, False
    ys, xs = np.nonzero(cand)
    order = np.argsort(p[ys, xs])[::-1][:300]
    fwhm, elong = [], []
    yy, xx = np.mgrid[-7:8, -7:8]
    for i in order:
        cut = p[ys[i] - 7 : ys[i] + 8, xs[i] - 7 : xs[i] + 8]
        cut = np.clip(cut - np.median(cut[[0, -1], :]), 0, None)
        total = cut.sum()
        if total <= 0:
            continue
        mx, my = (cut * xx).sum() / total, (cut * yy).sum() / total
        sxx, syy = (cut * (xx - mx) ** 2).sum() / total, (cut * (yy - my) ** 2).sum() / total
        sxy = (cut * (xx - mx) * (yy - my)).sum() / total
        tr, det = sxx + syy, sxx * syy - sxy**2
        l1 = tr / 2 + math.sqrt(max(tr * tr / 4 - det, 0))
        l2 = tr / 2 - math.sqrt(max(tr * tr / 4 - det, 0))
        if l2 <= 0:
            continue
        fwhm.append(2.3548 * math.sqrt((l1 + l2) / 2))
        elong.append(1 - math.sqrt(l2 / l1))
    return float(np.median(fwhm)), float(np.median(elong)), len(fwhm)


def main() -> None:
    sessions = json.load(open(sys.argv[1]))
    print("Finals")
    started = time.time()
    while True:
        auto = [f for f in get("/api/finals") if f["automatic"]]
        if auto and auto[0]["status"] != "queued" or time.time() - started > 300:
            break
        time.sleep(1)
    check(len(auto) == 1, f"one automatic final queued after the night ({len(auto)})")
    # While it runs: three requests for night 2; each replaces the one still queued.
    ids = [post("/api/finals", {"target": "C 9", "nights": ["2026-10-18"]})[1]["id"] for _ in range(3)]
    listed = {f["id"]: f for f in get("/api/finals")}
    check(ids[0] not in listed and ids[1] not in listed and listed.get(ids[2], {}).get("status") == "queued",
          f"a queued final is superseded by a newer request ({ids})")
    finals = wait_done([auto[0]["id"], ids[2]])
    final = get(f"/api/finals/{auto[0]['id']}")
    manual = finals[ids[2]]
    for f in (final, manual):
        check(f["status"] == "done", f"final {f['id']} ({', '.join(f['nights'])}): {f['status']} {f['error'] or ''}")
    print(f"       {final['frames']} frames, {final['integrationS']} s, {final['stacking']}, colour: {final['colour']}")
    print(f"       took {final['durationS']} s, Siril peak {final['peakMemoryBytes'] / 2**20:.0f} MB")
    check(final["frames"] == 21, "21 accepted frames used (the cloudy one left out)")
    check(final["stacking"]["registered"] == 21, "all 21 registered (both nights, before and after the flip)")
    check(final["colour"].startswith("photometric"), f"colour: {final['colour']}")
    check(manual["frames"] == 10 and manual["nights"] == ["2026-10-18"], "manual final of night 2 only: 10 frames")

    print("Library")
    lib = get("/api/library")
    types = sorted(s["type"] for s in lib["sets"])
    check(types == ["bias", "dark", "flat", "flat", "flat"], f"sets: {types}")
    masters = {m["type"] + ("-" + m["night"] + f"-{m['rotatorDeg']:.0f}" if m["type"] == "flat" else ""): m for m in lib["masters"]}
    check(len(lib["masters"]) == 5, f"{len(lib['masters'])} masters")
    for m in lib["masters"]:
        print(f"       {m['id']}: {m['frames']} frames, median {m['median']:.1f} ADU, noise {m['noise']:.2f} ADU"
              + (f", calibrated with {m['calibratedWith']}" if m["calibratedWith"] else ""))
    bias, dark = masters.get("bias"), masters.get("dark")
    check(bias and abs(bias["median"] - 1120) < 5, f"bias level {bias and bias['median']} ADU (offset 70 × 16 = 1120)")
    check(dark and 0 < dark["median"] - bias["median"] < 5, f"dark level {dark and dark['median']} ADU: bias + 300 s of dark current")
    check(all(m["calibratedWith"] == {"bias": bias["id"]} for m in lib["masters"] if m["type"] == "flat"),
          "flats calibrated with the bias (no dark-flats in the archive)")

    print("Match (C 9)")
    match = get("/api/library/match?target=" + urllib.parse.quote("C 9"))
    for w in match["warnings"]:
        print(f"       warning: {w}")
    n1 = next(m for m in match["nights"] if m["night"] == "2026-10-17")
    n2 = next(m for m in match["nights"] if m["night"] == "2026-10-18")
    check(n1["dark"] == dark["id"] and not n1["darkScaled"], "night 1 (300 s): the 300 s dark")
    check(n1["flat"].startswith("flat-20260906"), f"night 1: the only flats at its camera angle (93°/273°): {n1['flat']}")
    check(any(w.startswith("Flat is 41 days older") for w in n1["warnings"]), "night 1: old-flat warning (41 days)")
    check(n2["dark"] == dark["id"] and n2["darkScaled"] and n2["lightsBias"] == bias["id"], "night 2 (180 s): 300 s dark scaled, with the bias")
    check(any(w.startswith("No dark for 180 s, gain 100, -20 °C") for w in n2["warnings"]), "night 2: missing-dark warning")
    check(n2["flat"] == masters["flat-2026-10-18-300"]["id"] and len(n2["warnings"]) == 1,
          "night 2: its own night's flat at 300°, no other warning")



    folder = os.path.join(PROCESSED, "finals", final["id"])
    header, _ = fitsio.read_header(os.path.join(folder, "linear.fits"))
    stack, _ = fitsio.read_float(os.path.join(folder, "linear.fits"))
    print(f"       linear.fits {stack.shape[2]}×{stack.shape[1]}×{stack.shape[0]}, BITPIX {header['BITPIX']}")
    green = stack[1].copy()
    green[green == 0] = np.nan
    swcs = Wcs(header)
    # The stack's plate solve must put catalogue stars on the stars (the checks below map through it).
    ra, dec, g, _ = synthetic.load_stars()
    bright = g < 11.5
    sx, sy = swcs.to_pixel(ra[bright], dec[bright])
    offsets = []
    for x, y in zip(sx, sy):
        cx, cy = int(round(x)), int(round(y))
        if not (10 <= cx < green.shape[1] - 10 and 10 <= cy < green.shape[0] - 10):
            continue
        cut = np.nan_to_num(green[cy - 6 : cy + 7, cx - 6 : cx + 7])
        cut = np.clip(cut - np.median(cut), 0, None)
        if cut.sum() <= 0:
            continue
        yy, xx = np.mgrid[-6:7, -6:7]
        offsets.append(math.hypot((cut * xx).sum() / cut.sum() + cx - x, (cut * yy).sum() / cut.sum() + cy - y))
    offset = float(np.median(offsets))
    check(offset < 1.5, f"the stack's plate solve fits: Gaia stars {offset:.2f} px from the stars ({len(offsets)} stars)")

    print("Calibration in the stack")
    lights = []
    for s in sessions:
        for f in s["detail_frames"]:
            if f["accepted"]:
                h, _ = fitsio.read_header(os.path.join(ARCHIVE, f["archivePath"]))
                lights.append((f, h, 27.0 if s["night"] == "2026-10-18" else 0.0))
    size = int(lights[0][1]["NAXIS1"])
    # Dust: each frame's donuts mapped into the stack; frames whose donuts land together (same
    # night and side of the flip) form one spot, expected dimming if uncalibrated ∝ their share.
    spots: dict[tuple, list] = {}
    for f, h, turn in lights:
        wcs = Wcs(h)
        for k, (x, y, r, depth) in enumerate(dust_in_frame(turn, size)):
            ra, dec = wcs.to_sky(np.array([x]), np.array([y]))
            sx, sy = swcs.to_pixel(ra, dec)
            key = (turn, round(float(f["rotatorDeg"]) / 90) % 4, k)
            spots.setdefault(key, []).append((float(sx[0]), float(sy[0]), r, depth))
    first, first_header, first_turn = lights[0]
    raw_path = os.path.join(ARCHIVE, first["archivePath"])
    raw = green_superpixel(raw_path)
    raw_dust = [ring_ratio(raw, x, y, r) for x, y, r, _ in dust_in_frame(first_turn, size)]
    print(f"       raw frame (no calibration): dust ring/outside {', '.join(f'{v:.3f}' for v in raw_dust)}")
    worst = 0.0
    for key, pts in sorted(spots.items()):
        x, y = np.mean([p[0] for p in pts]), np.mean([p[1] for p in pts])
        if not (100 < x < green.shape[1] - 100 and 100 < y < green.shape[0] - 100):
            continue
        ratio = ring_ratio(green, x, y, pts[0][2])
        share = len(pts) / len(lights)
        expected = 1 - (1 - raw_dust[key[2]]) * share
        worst = max(worst, abs(1 - ratio) / max(1 - expected, 1e-6))
        print(f"       spot {key[2]} of {len(pts):2d} frames at ({x:.0f}, {y:.0f}): ring/outside {ratio:.4f}"
              f" (uncalibrated would be ~{expected:.3f})")
    check(worst < 0.25, f"dust donuts gone: residual at most {worst * 100:.0f} % of the uncalibrated dimming")
    hr = Wcs(lights[0][1])
    raw_v, _ = vignetting_profile(raw, hr, ((size - 1) / 2, (size - 1) / 2))
    centres = []
    for f, h, turn in lights:
        ra, dec = Wcs(h).to_sky(np.array([(size - 1) / 2]), np.array([(size - 1) / 2]))
        sx, sy = swcs.to_pixel(ra, dec)
        centres.append((float(sx[0]), float(sy[0])))
    stack_v, rms = vignetting_profile(green, swcs, tuple(np.mean(centres, axis=0)))
    print(f"       sky lost from 650 to 1300 px off the optical axis: raw frame {raw_v * 100:+.1f} %, "
          f"stack {stack_v * 100:+.1f} % (fit residual RMS {rms * 100:.1f} %)")
    check(abs(stack_v) < 0.2 * abs(raw_v), "vignetting gone (falloff under a fifth of the raw frame's)")

    print("Stars")
    fwhm, elong, n = star_shapes(np.nan_to_num(stack[1]))
    print(f"       {n} bright stars: median FWHM {fwhm:.2f} px, elongation {elong:.3f}")
    check(elong < 0.12 and fwhm < 3.6, "round, sharp stars (frames of both nights and both sides of the flip aligned)")
    # The satellite in frame 5 of night 1: along its line, against parallel lines 8 px away.
    f5 = next((f, h) for f, h, _ in lights if f["number"] == 5 and "2026-10-17" in f["archivePath"])
    t = np.linspace(0.05, 0.95, 400) * size
    line_x = t
    line_y = 0.3 * size + (t - 0.1 * size) * 0.34 / 0.94
    on, off = [], []
    for dy in (0, -8, 8):
        ra, dec = Wcs(f5[1]).to_sky(line_x, line_y + dy)
        sx, sy = swcs.to_pixel(ra, dec)
        ok = (sx > 5) & (sx < green.shape[1] - 5) & (sy > 5) & (sy < green.shape[0] - 5)
        vals = green[np.round(sy[ok]).astype(int), np.round(sx[ok]).astype(int)]
        (on if dy == 0 else off).append(np.nanmedian(vals))
    trail = on[0] / np.mean(off) - 1
    print(f"       satellite trail of frame 5 in the stack: {trail * 100:+.2f} % against beside it "
          "(about twice the sky in its frame: ~+10 % if one frame of 21 went in unrejected)")
    check(abs(trail) < 0.01, "satellite trail rejected")

    print("Download")
    url = API + "/downloads/" + urllib.parse.quote("C 9") + ".tar?include=rejected"
    with urllib.request.urlopen(url, timeout=600) as r:
        announced = int(r.headers["content-length"])
        body = r.read()
    check(len(body) == announced, f"tar: {len(body) / 1e9:.2f} GB, as announced")
    members = tarfile.open(fileobj=io.BytesIO(body)).getmembers()
    names = [m.name for m in members]
    count = lambda part: sum(1 for n in names if f"/{part}/" in n)  # noqa: E731
    print(f"       {len(names)} members: lights {count('lights')}, rejected {count('rejected')}, "
          f"calibration {count('calibration')}, masters {count('masters')}, final {count('final')}")
    check(count("lights") == 21 and count("rejected") == 1, "21 accepted lights, 1 rejected")
    check(count("masters") == 4, "masters: bias, dark and the two flats matched")
    check(sum(1 for n in names if "/calibration/bias-" in n) == 20 and sum(1 for n in names if "/calibration/dark-" in n) == 12
          and sum(1 for n in names if "/calibration/flat-" in n) == 24, "raw sets: 20 bias, 12 darks, 2 × 12 flats")
    check(count("final") == 4, "the final's four files")
    tar = tarfile.open(fileobj=io.BytesIO(body))
    light = next(m for m in members if "/lights/2026-10-17/" in m.name)
    data = tar.extractfile(light).read()
    original = open(os.path.join(ARCHIVE, "2026", "2026-10-17", "C 9", os.path.basename(light.name)), "rb").read()
    check(hashlib.sha1(data).digest() == hashlib.sha1(original).digest(), f"{light.name} byte for byte as archived")
    readme = tar.extractfile("C 9/README.txt").read().decode()
    print("       README.txt:\n" + "\n".join("         | " + line for line in readme.splitlines()[:60]))

    with open("/proc/1/status") as f:
        hwm = next(line for line in f if line.startswith("VmHWM"))
    print(f"Memory: processor (Python) {hwm.split(':')[1].strip()}, Siril peak {final['peakMemoryBytes'] / 2**20:.0f} MB")
    print("FAILED: " + "; ".join(failures) if failures else "All checks passed.")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
