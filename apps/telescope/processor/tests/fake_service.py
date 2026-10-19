"""A stand-in for the telescope service's API, answering from the sessions JSON that synthetic.py
writes (the list fields, and per session the frames with `archivePath` and decisions).

    python tests/fake_service.py <sessions.json> [port]     (default 8080)
"""

from __future__ import annotations

import json
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def main() -> None:
    with open(sys.argv[1]) as f:
        sessions = json.load(f)
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8080
    listed = [{k: v for k, v in s.items() if k not in ("detail_frames", "site", "pending", "camera", "focalLengthMm")}
              for s in sessions]
    details = {s["id"]: {**{k: v for k, v in s.items() if k != "detail_frames"}, "frames": s["detail_frames"]}
               for s in sessions}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            path = urllib.parse.unquote(self.path.split("?", 1)[0])
            if path == "/api/sessions":
                body = listed
            elif path.startswith("/api/sessions/") and path[14:] in details:
                body = details[path[14:]]
            else:
                self.send_response(404)
                self.end_headers()
                return
            data = json.dumps(body).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, format: str, *args) -> None:  # noqa: A002
            pass

    ThreadingHTTPServer(("", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
