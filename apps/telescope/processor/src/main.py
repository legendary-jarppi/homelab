"""Telescope processor: the calibration library (D2) and final stacks with Siril (D3) from the
telescope's FITS archive (mounted read only), and downloads of everything for processing by hand.
Frames and their accept decisions come from the telescope service's API. Cluster-internal:
    GET  /api/library                           calibration sets and masters
    GET  /api/library/match?target=<name>       masters for a target's lights, with warnings
    GET  /api/finals, /api/finals/<id>          final stacks (newest first; one with its log tail)
    POST /api/finals                            {"target": "<ASIAIR target>", "nights"?: [...]} → 202
    PUT  /api/finals/<id>                       {"published"?, "title"?, "note"?} → the final
    GET  /api/images/final/<id>                 the processed image for the viewer: size, plate solve, histogram
    GET  /api/images/final/<id>/star?x=&y=      a star measured on the linear stack (display pixels)
    GET  /downloads/<target>.tar?nights=&include=rejected   lights, calibration, masters, final, README
    GET  /masters/<id>.fits, /finals/<id>/<file>
    GET  /metrics, /healthz
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import shutil
import signal
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from zoneinfo import ZoneInfo

import downloads
import library as lib
import siril
from finals import Finals
from library import Library
from service import Service, ServiceError, light_info

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s", datefmt="%Y-%m-%dT%H:%M:%S")
log = logging.getLogger("processor")


def env_number(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


def parse_hours(raw: str) -> tuple[int, int]:
    start, _, end = raw.partition("-")
    return int(start), int(end)


PORT = int(env_number("PORT", 8080))
ARCHIVE_DIR = os.environ.get("ARCHIVE_DIR", "/archive")
DATA_DIR = os.environ.get("DATA_DIR", "/processed")
TELESCOPE_URL = os.environ.get("TELESCOPE_URL", "http://telescope:8080")
TZ = ZoneInfo(os.environ.get("ASIAIR_TZ", "Europe/Helsinki"))
AUTO = os.environ.get("AUTO", "on") != "off"
AUTO_HOURS = parse_hours(os.environ.get("AUTO_HOURS", "8-18"))
AUTO_QUIET_S = env_number("AUTO_QUIET_H", 1) * 3600
AUTO_CHECK_S = env_number("AUTO_CHECK_MIN", 10) * 60
LIBRARY_SCAN_S = env_number("LIBRARY_SCAN_MIN", 10) * 60
SETTLE_S = env_number("SETTLE_MIN", 10) * 60
FINALS_KEEP = int(env_number("FINALS_KEEP", 3))
WORK_MAX_BYTES = int(env_number("WORK_MAX_GB", 40) * 1e9)

TARGET = re.compile(r"^[^/\0]{1,128}$")
NIGHT = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FINAL = re.compile(r"^/api/finals/([a-z0-9-]{1,128})$")
IMAGE = re.compile(r"^/api/images/final/([a-z0-9-]{1,128})(/star)?$")
FINAL_FILE = re.compile(r"^/finals/([a-z0-9-]{1,128})/([a-z.-]{1,32})$")
MASTER = re.compile(r"^/masters/([a-z0-9.-]{1,160})\.fits$")
DOWNLOAD = re.compile(r"^/downloads/(.+)\.tar$")
KINDS = {".fits": "application/fits", ".tif": "image/tiff", ".jpg": "image/jpeg", ".txt": "text/plain; charset=utf-8"}


def match_json(target: str, service: Service, library: Library) -> dict:
    _, frames = service.frames(target)
    lights = [x for x in (light_info(f) for f in frames if f.get("accepted")) if x]
    match, _ = lib.match(lights, library.masters_list())
    return match


def metrics(library: Library, finals: Finals) -> str:
    lines = [
        "# HELP telescope_processor_queue_length Final stacks waiting.",
        "# TYPE telescope_processor_queue_length gauge",
        f"telescope_processor_queue_length {finals.queue_length()}",
        "# HELP telescope_processor_job_running 1 while a final stack runs.",
        "# TYPE telescope_processor_job_running gauge",
        f"telescope_processor_job_running {1 if finals.running else 0}",
        "# HELP telescope_processor_finals Final stacks kept, by status.",
        "# TYPE telescope_processor_finals gauge",
    ]
    lines += [f'telescope_processor_finals{{status="{k}"}} {v}' for k, v in finals.counts().items()]
    masters = library.masters_list()
    lines += ["# HELP telescope_processor_masters Calibration masters, by type.", "# TYPE telescope_processor_masters gauge"]
    lines += [f'telescope_processor_masters{{type="{t}"}} {sum(1 for m in masters if m["type"] == t)}' for t in ("bias", "dark", "flat")]
    sets = library.json()
    lines += ["# HELP telescope_processor_calibration_sets Calibration sets in the archive, by type.",
              "# TYPE telescope_processor_calibration_sets gauge"]
    lines += [f'telescope_processor_calibration_sets{{type="{t}"}} {sum(1 for s in sets["sets"] if s["type"] == t)}'
              for t in ("bias", "dark", "flat")]
    lines += ["# HELP telescope_processor_masters_pending Masters waiting to be built.",
              "# TYPE telescope_processor_masters_pending gauge", f"telescope_processor_masters_pending {len(sets['pending'])}"]
    lines += ["# HELP telescope_processor_last_job_duration_seconds Duration of the last job, by kind.",
              "# TYPE telescope_processor_last_job_duration_seconds gauge"]
    last = dict(finals.last)
    lines += [f'telescope_processor_last_job_duration_seconds{{kind="{k}"}} {v["durationS"]:.1f}' for k, v in last.items()]
    lines += ["# HELP telescope_processor_last_job_success 1 if the last job of a kind succeeded.",
              "# TYPE telescope_processor_last_job_success gauge"]
    lines += [f'telescope_processor_last_job_success{{kind="{k}"}} {1 if v["ok"] else 0}' for k, v in last.items()]
    lines += ["# HELP telescope_processor_last_job_timestamp_seconds When the last job of a kind ended.",
              "# TYPE telescope_processor_last_job_timestamp_seconds gauge"]
    lines += [f'telescope_processor_last_job_timestamp_seconds{{kind="{k}"}} {v["at"]:.0f}' for k, v in last.items()]
    usage = shutil.disk_usage(DATA_DIR)
    lines += ["# HELP telescope_processor_disk_free_bytes Free space on the processed volume.",
              "# TYPE telescope_processor_disk_free_bytes gauge", f"telescope_processor_disk_free_bytes {usage.free}"]
    return "\n".join(lines) + "\n"


def serve(library: Library, finals: Finals, service: Service) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def send(self, status: int, kind: str, body: bytes, cache: str = "no-store") -> None:
            self.send_response(status)
            self.send_header("content-type", kind)
            self.send_header("content-length", str(len(body)))
            self.send_header("cache-control", cache)
            self.end_headers()
            self.wfile.write(body)

        def json(self, status: int, value) -> None:
            self.send(status, "application/json", json.dumps(value).encode())

        def text(self, status: int, message: str) -> None:
            self.send(status, "text/plain; charset=utf-8", (message + "\n").encode())

        def file(self, path: str | None, download: str | None = None, cache: str = "no-cache") -> None:
            if path is None or not os.path.isfile(path):
                return self.text(404, "not found")
            size = os.path.getsize(path)
            self.send_response(200)
            self.send_header("content-type", KINDS.get(os.path.splitext(path)[1], "application/octet-stream"))
            self.send_header("content-length", str(size))
            self.send_header("cache-control", cache)
            if download:
                self.send_header("content-disposition", disposition(download))
            self.end_headers()
            with open(path, "rb") as f:
                shutil.copyfileobj(f, self.wfile, downloads.CHUNK)

        def do_GET(self) -> None:  # noqa: N802 - http.server's naming
            url = urllib.parse.urlsplit(self.path)
            path, query = url.path, urllib.parse.parse_qs(url.query)
            try:
                if path == "/api/library":
                    return self.json(200, library.json())
                if path == "/api/library/match":
                    target = (query.get("target") or [""])[0]
                    if not TARGET.match(target):
                        return self.text(400, "expected ?target=<ASIAIR target name>")
                    return self.json(200, match_json(target, service, library))
                if path == "/api/finals":
                    return self.json(200, finals.list())
                if m := FINAL.match(path):
                    final = finals.get(m[1])
                    return self.json(200, final) if final else self.text(404, "not found")
                if m := IMAGE.match(path):
                    return self.image(m[1], bool(m[2]), query)
                if m := FINAL_FILE.match(path):
                    name = m[2]
                    final = finals.get(m[1])
                    download = f"{final['target']} {final['id']} {name}" if final else None
                    # Finals' files never change once written: cacheable. full.jpg is the viewer's
                    # image (inline); the others download with readable names.
                    return self.file(finals.file_path(m[1], name), download if name not in ("log.txt", "full.jpg") else None,
                                     "no-cache" if name == "log.txt" else "public, max-age=31536000, immutable")
                if m := MASTER.match(path):
                    if m[1] not in {x["id"] for x in library.masters_list()}:
                        return self.text(404, "not found")
                    return self.file(library.master_path(m[1]), f"{m[1]}.fits", "public, max-age=31536000, immutable")
                if m := DOWNLOAD.match(path):
                    return self.download(urllib.parse.unquote(m[1]), query)
                if path == "/metrics":
                    return self.send(200, "text/plain; version=0.0.4", metrics(library, finals).encode())
                if path == "/healthz":
                    return self.text(200, "ok")
                self.text(404, "not found")
            except ServiceError as e:
                self.text(502, str(e))
            except (BrokenPipeError, ConnectionResetError):
                pass

        def download(self, target: str, query: dict) -> None:
            if not TARGET.match(target):
                return self.text(400, "bad target")
            nights = [n for n in ",".join(query.get("nights", [])).split(",") if n]
            if any(not NIGHT.match(n) for n in nights):
                return self.text(400, "nights: comma-separated YYYY-MM-DD")
            include = ",".join(query.get("include", [])).split(",")
            try:
                tar = downloads.build(target, nights or None, "rejected" in include, service, library, finals, TZ)
            except LookupError as e:
                return self.text(404, str(e))
            self.send_response(200)
            self.send_header("content-type", "application/x-tar")
            self.send_header("content-length", str(tar.length))
            self.send_header("cache-control", "no-store")
            name = downloads.safe(target) + (f" {nights[0]}..{nights[-1]}" if nights else "") + ".tar"
            self.send_header("content-disposition", disposition(name))
            self.end_headers()
            started, sent = time.time(), 0
            for chunk in tar.chunks():
                self.wfile.write(chunk)
                sent += len(chunk)
            log.info("download %s: %d files, %.1f GB in %.0f s", name, len(tar.members), sent / 1e9, time.time() - started)

        def image(self, fid: str, star: bool, query: dict) -> None:
            if not star:
                image = finals.image(fid)
                return self.json(200, image) if image else self.text(404, "not found")
            try:
                x, y = float((query.get("x") or [""])[0]), float((query.get("y") or [""])[0])
            except ValueError:
                return self.text(400, "expected ?x=<display px>&y=<display px>")
            if not (math.isfinite(x) and math.isfinite(y)):
                return self.text(400, "expected ?x=<display px>&y=<display px>")
            if finals.image(fid) is None:
                return self.text(404, "not found")
            try:
                measured = finals.star(fid, x, y)
            except (OSError, ValueError):
                measured = None
            if measured is None:
                return self.text(409, "no linear data kept for this final (an older version): not measurable")
            self.json(200, measured)

        def do_PUT(self) -> None:  # noqa: N802
            m = FINAL.match(self.path.split("?", 1)[0])
            if not m:
                return self.text(404, "not found")
            try:
                length = int(self.headers.get("content-length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}") if length <= 16384 else None
            except ValueError:
                body = None
            if not isinstance(body, dict):
                return self.text(400, 'expected {"published"?: bool, "title"?: string|null, "note"?: string|null}')
            try:
                self.json(200, finals.update(m[1], body))
            except KeyError:
                self.text(404, "not found")
            except ValueError as e:
                self.text(400, str(e))
            except PermissionError as e:
                self.text(409, str(e))

        def do_POST(self) -> None:  # noqa: N802
            path = self.path.split("?", 1)[0]
            if path != "/api/finals":
                return self.text(404, "not found")
            try:
                length = int(self.headers.get("content-length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}") if length <= 4096 else None
            except ValueError:
                body = None
            if not isinstance(body, dict) or not isinstance(body.get("target"), str) or not TARGET.match(body["target"]):
                return self.text(400, 'expected {"target": "<ASIAIR target name>", "nights"?: ["YYYY-MM-DD", …]}')
            nights = body.get("nights")
            if nights is not None and (not isinstance(nights, list) or not all(isinstance(n, str) and NIGHT.match(n) for n in nights)):
                return self.text(400, "nights: a list of YYYY-MM-DD")
            try:
                final = finals.create(body["target"], nights or None, automatic=False)
            except LookupError as e:
                return self.text(404, str(e))
            except ServiceError as e:
                return self.text(502, str(e))
            self.json(202, final)

        def log_message(self, format: str, *args) -> None:  # noqa: A002 - quiet access log
            pass

    server = ThreadingHTTPServer(("", PORT), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def disposition(name: str) -> str:
    ascii_name = name.encode("ascii", "replace").decode().replace('"', "'")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{urllib.parse.quote(name)}"


def scheduler(finals: Finals) -> None:
    while True:
        try:
            finals.automatic(AUTO_HOURS, AUTO_QUIET_S)
        except Exception:  # noqa: BLE001 - keep scheduling whatever one round hit
            log.exception("automatic finals")
        time.sleep(AUTO_CHECK_S)


def main() -> None:
    signal.signal(signal.SIGTERM, lambda *_: os._exit(0))
    library = Library(ARCHIVE_DIR, DATA_DIR, SETTLE_S)
    service = Service(TELESCOPE_URL, ARCHIVE_DIR)
    finals = Finals(DATA_DIR, library, service, TZ, FINALS_KEEP, WORK_MAX_BYTES, LIBRARY_SCAN_S)
    library.scan()
    serve(library, finals, service)
    log.info("telescope processor: Siril %s (memory %g GB, %d threads), archive %s, service %s, automatic finals %s, "
             "%d calibration sets, %d masters, listening on :%d", siril.version(), siril.MEM_GB, siril.THREADS,
             ARCHIVE_DIR, TELESCOPE_URL, f"{AUTO_HOURS[0]}-{AUTO_HOURS[1]} h" if AUTO else "off",
             len(library.sets), len(library.masters), PORT)
    if AUTO:
        threading.Thread(target=scheduler, args=(finals,), daemon=True).start()
    finals.worker()


if __name__ == "__main__":
    main()
