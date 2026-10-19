"""The telescope service's API (http://telescope:8080): sessions, their frames with the accept
decisions and where each frame is in the archive. The processor never reads the service's volumes."""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request

import fitsio
import library


class ServiceError(Exception):
    pass


class Service:
    def __init__(self, url: str, archive: str):
        self.url = url.rstrip("/")
        self.archive = os.path.realpath(archive)

    def _get(self, path: str):
        try:
            with urllib.request.urlopen(f"{self.url}{path}", timeout=60) as r:
                return json.load(r)
        except (OSError, ValueError) as e:
            raise ServiceError(f"telescope service {path}: {e}") from e

    def sessions(self) -> list[dict]:
        return self._get("/api/sessions")

    def session(self, sid: str) -> dict:
        return self._get(f"/api/sessions/{urllib.parse.quote(sid)}")

    def target_sessions(self, target: str, nights: list[str] | None = None) -> list[dict]:
        """Every session of an ASIAIR target (oldest first), optionally only some nights."""
        out = [s for s in self.sessions() if s["target"] == target and (not nights or s["night"] in nights)]
        return sorted(out, key=lambda s: s["firstFrameAt"])

    def archive_path(self, rel: str | None) -> str | None:
        """The absolute path of an `archivePath`, only inside the archive."""
        if not rel:
            return None
        path = os.path.realpath(os.path.join(self.archive, rel))
        if not path.startswith(self.archive + os.sep) or not os.path.isfile(path):
            return None
        return path

    def frames(self, target: str, nights: list[str] | None = None) -> tuple[list[dict], list[dict]]:
        """The sessions and every judged frame of them that is in the archive:
        [{…service frame, session, night, path}]."""
        sessions = self.target_sessions(target, nights)
        frames = []
        for s in sessions:
            detail = self.session(s["id"])
            for f in detail.get("frames", []):
                path = self.archive_path(f.get("archivePath"))
                if path is None:
                    continue
                frames.append({**f, "session": s["id"], "night": s["night"], "path": path})
        return sessions, frames


def light_info(frame: dict) -> dict | None:
    """A light frame's calibration-relevant header fields (read from the archive)."""
    try:
        parsed = fitsio.read_header(frame["path"])
    except OSError:
        return None
    if parsed is None:
        return None
    header = parsed[0]
    fields = library.frame_fields(header)
    if fields["exposureS"] is None:
        fields["exposureS"] = frame.get("exposureS")
    return {**fields, "rel": frame["archivePath"], "path": frame["path"], "night": frame["night"], "id": frame["id"],
            "session": frame["session"], "ra": fitsio.angle(header.get("RA"), hours=True),
            "dec": fitsio.angle(header.get("DEC")), "focalMm": fitsio.number(header, "FOCALLEN"),
            "pixelUm": fitsio.number(header, "XPIXSZ")}
