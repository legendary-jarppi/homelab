"""Timelapse steps, keys and placement (python -m unittest discover -s tests)."""

import copy
import os
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import fits  # noqa: E402
import timelapse  # noqa: E402

WCS = {"crpix": [1504.5, 1504.5], "crval": [84.0, 62.0], "cd": [[-0.000323, 0.0], [0.0, 0.000323]]}
FLIP = [[-1.0, 0.0, 1503.0], [0.0, -1.0, 1503.0]]


def frame(n: int, angle: float = 93.0, transform=None, accepted: bool = True, wcs=None) -> dict:
    f = {"rel": f"2026/x/T/Light_{n:04d}.fit", "id": f"{n:016x}", "number": n, "state": "done",
         "info": {"at": 1000.0 + 300 * n, "exposureS": 300.0, "rotatorDeg": angle},
         "bg": [500.0, 520.0, 480.0], "manual": None, "auto": [accepted, None if accepted else "clouds"]}
    if transform is not None:
        f["transform"] = transform
    if wcs is not None:
        f["wcs"] = wcs
    return f


def session(frames: list[dict]) -> dict:
    return {"id": "s", "frames": frames, "reference": frames[0]["rel"], "refShape": [1504, 1504],
            "refWcs": WCS, "refScale": 2.0}


def decide(f: dict) -> dict:
    accepted = timelapse_accepted(f)
    return {"accepted": accepted, "rejectReason": None if accepted else "clouds", "rotatorDeg": f["info"]["rotatorDeg"]}


def timelapse_accepted(f: dict) -> bool:
    if f.get("manual") is not None:
        return bool(f["manual"]) and bool(f.get("transform"))
    return bool(f["auto"][0])


EYE = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]


class PlanTest(unittest.TestCase):
    def frames(self) -> list[dict]:
        return [frame(1, transform=EYE), frame(2, transform=[[1, 0, 3.2], [0, 1, -1.5]]),
                frame(3, transform=EYE, accepted=False), frame(4, 273.0, transform=FLIP)]

    def test_new_frame_keeps_earlier_steps(self):
        before = timelapse.plan(session(self.frames()), decide, timelapse_accepted)
        after = timelapse.plan(session(self.frames() + [frame(5, 273.0, transform=FLIP)]), decide, timelapse_accepted)
        self.assertEqual([x["key"] for x in before["frames"]], [x["key"] for x in after["frames"]][:4])
        self.assertEqual([x["key"] for x in before["stack"]], [x["key"] for x in after["stack"]][:3])
        self.assertEqual(len(after["stack"]), 4)
        self.assertNotEqual(before["keys"], after["keys"])

    def test_manual_decision(self):
        frames = self.frames()
        before = timelapse.plan(session(frames), decide, timelapse_accepted)
        changed = copy.deepcopy(frames)
        changed[1]["manual"] = False  # frame 2 out of the stack by hand
        after = timelapse.plan(session(changed), decide, timelapse_accepted)
        # Frames: same pictures, only the marks (and so the WebP's captions) change.
        self.assertEqual([x["key"] for x in before["frames"]], [x["key"] for x in after["frames"]])
        self.assertFalse(after["frames"][1]["accepted"])
        self.assertNotEqual(before["keys"]["frames"], after["keys"]["frames"])
        # Stack: the step before the change stays, every one after it is another picture.
        self.assertEqual(before["stack"][0]["key"], after["stack"][0]["key"])
        self.assertEqual([x["number"] for x in after["stack"]], [1, 4])
        self.assertNotIn(after["stack"][1]["key"], {x["key"] for x in before["stack"]})
        self.assertEqual(after["stack"][1]["frames"], 2)
        self.assertEqual(after["stack"][1]["integrationS"], 600)

    def test_reference_change_renews_everything(self):
        frames = self.frames()
        before = timelapse.plan(session(frames), decide, timelapse_accepted)
        s = session(frames)
        s["reference"] = frames[1]["rel"]
        after = timelapse.plan(s, decide, timelapse_accepted)
        self.assertFalse({x["key"] for x in before["frames"]} & {x["key"] for x in after["frames"]})

    def test_unaligned_frames_placed(self):
        frames = self.frames() + [frame(5, 273.0), frame(6, 93.0)]
        p = timelapse.plan(session(frames), decide, timelapse_accepted)
        by_number = {x["number"]: x for x in p["frames"]}
        # Without a plate solve: like the nearest aligned frame on the same side of the meridian.
        self.assertEqual(by_number[5]["placement"], "neighbour")
        self.assertEqual(by_number[5]["matrix"], FLIP)
        self.assertEqual(by_number[6]["matrix"], EYE)  # frame 4 is nearer in time but after the flip
        self.assertFalse(by_number[5]["cached"])
        self.assertNotIn(5, [x["number"] for x in p["stack"]])

    def test_plate_solve_placement(self):
        shifted = dict(WCS, crpix=[WCS["crpix"][0] + 10, WCS["crpix"][1]])  # 10 camera px = 5 plane px
        p = timelapse.plan(session(self.frames() + [frame(5, wcs=shifted)]), decide, timelapse_accepted)
        step = p["frames"][-1]
        self.assertEqual(step["placement"], "plateSolve")
        np.testing.assert_allclose(np.array(step["matrix"]), [[1, 0, -5], [0, 1, 0]], atol=1e-3)

    def test_no_reference(self):
        s = session(self.frames())
        s["reference"] = None
        self.assertIsNone(timelapse.plan(s, decide, timelapse_accepted))

    def test_many_frames_spaced(self):
        frames = [frame(1, transform=EYE)] + [frame(n, transform=EYE) for n in range(2, 700)]
        p = timelapse.plan(session(frames), decide, timelapse_accepted)
        self.assertLessEqual(len(p["frames"]), timelapse.MAX_STEPS)
        self.assertEqual((p["frames"][0]["number"], p["frames"][-1]["number"]), (1, 699))
        shown = [x for x in p["stack"] if x["shown"]]
        self.assertLessEqual(len(shown), timelapse.MAX_STEPS)
        self.assertEqual(len(p["stack"]), 699)  # every frame still goes into the running mean
        self.assertTrue(p["stack"][-1]["shown"])


class StretchTest(unittest.TestCase):
    def test_fixed_stretch_grades_brighter_sky(self):
        rng = np.random.default_rng(1)
        sky = rng.normal(2800, 12, 200_000).astype(np.float32)
        sky[:200] = 40000  # stars
        params = timelapse.fixed_params(sky)

        def shown(v: float) -> float:
            return float(fits.apply_stretch(np.array([v], np.float32), params)[0])

        self.assertAlmostEqual(shown(float(np.median(sky))), timelapse.BACKGROUND_TARGET, places=2)
        # A sky 1.5× and 3× brighter: brighter, distinguishable, not yet white.
        self.assertLess(shown(2800), shown(4200) - 0.1)
        self.assertLess(shown(4200), shown(8400) - 0.05)
        self.assertLess(shown(8400), 0.97)


class WebpTest(unittest.TestCase):
    def test_animation_from_step_pictures(self):
        with tempfile.TemporaryDirectory() as folder:
            paths = []
            for i in range(4):
                paths.append(os.path.join(folder, f"{i}.jpg"))
                Image.new("RGB", (160, 120), (i * 60, 20, 20)).save(paths[-1])
            captions = [("T  #1", None), ("T  #2", "rejected: clouds"), ("T  #3", None), ("T  #4", None)]
            out = os.path.join(folder, "a.webp")
            first = timelapse.Captioned(paths[:1], captions[:1]).picture(0)
            first.save(out, format="WEBP", save_all=True, append_images=[timelapse.Captioned(paths[1:], captions[1:])],
                       duration=timelapse.WEBP_FRAME_MS, loop=0, quality=timelapse.WEBP_QUALITY)
            with Image.open(out) as im:
                self.assertEqual(im.n_frames, 4)
                im.seek(3)
                self.assertGreater(im.convert("RGB").getpixel((80, 20))[0], 150)


if __name__ == "__main__":
    unittest.main()
