"""The streamed tar: announced length, valid archive, members byte for byte."""

import io
import os
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import downloads  # noqa: E402
import imaging  # noqa: E402
import numpy as np  # noqa: E402


class TarTest(unittest.TestCase):
    def test_stream(self):
        with tempfile.TemporaryDirectory() as d:
            paths = []
            for i, size in enumerate((0, 1, 511, 512, 513, 3 * 2**20 + 7)):
                p = os.path.join(d, f"f{i}.fit")
                with open(p, "wb") as f:
                    f.write(os.urandom(size))
                paths.append(p)
            long = "C 9/lights/2026-10-17/" + "Light_" + "x" * 150 + "_ä.fit"  # pax header for the name
            members = [downloads.Member("C 9/README.txt", data="hello\n".encode())]
            members += [downloads.Member(f"C 9/lights/{os.path.basename(p)}", p) for p in paths]
            members.append(downloads.Member(long, paths[2]))
            tar = downloads.Tar(members)
            body = b"".join(tar.chunks())
            self.assertEqual(len(body), tar.length)
            self.assertEqual(len(body) % tarfile.RECORDSIZE, 0)
            t = tarfile.open(fileobj=io.BytesIO(body))
            names = t.getnames()
            self.assertEqual(names[0], "C 9/README.txt")
            self.assertIn(long, names)
            for p in paths:
                with open(p, "rb") as f:
                    self.assertEqual(t.extractfile(f"C 9/lights/{os.path.basename(p)}").read(), f.read())


class CoverageTest(unittest.TestCase):
    def test_rectangle_inside_rotated_frames(self):
        n = 400
        yy, xx = np.mgrid[0:n, 0:n]
        square = (abs(xx - 200) < 120) & (abs(yy - 200) < 120)
        c, s = np.cos(0.47), np.sin(0.47)
        u, v = c * (xx - 200) + s * (yy - 200), -s * (xx - 200) + c * (yy - 200)
        rotated = (abs(u) < 120) & (abs(v) < 120)
        x0, y0, x1, y1 = imaging.covered_rectangle(square | rotated)
        inside = (square | rotated)[y0:y1, x0:x1]
        self.assertGreater(inside.mean(), 0.999)
        self.assertGreater((x1 - x0) * (y1 - y0), 0.8 * 240 * 240)  # about the axis-aligned square


if __name__ == "__main__":
    unittest.main()
