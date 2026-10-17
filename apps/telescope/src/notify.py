"""Push notifications through apps/notify (cluster-internal sending API, bearer token from secret
telescope-notify). Without a token nothing is sent; failures are logged, never retried."""

from __future__ import annotations

import json
import logging
import urllib.request

log = logging.getLogger("notify")


class Notifier:
    def __init__(self, url: str, token: str, link: str, topic: str = "telescope"):
        self.url, self.token, self.link, self.topic = url.rstrip("/"), token, link, topic

    def send(self, title: str, body: str) -> None:
        log.info("%s: %s", title, body)
        if not self.token:
            return
        request = urllib.request.Request(
            f"{self.url}/api/send",
            data=json.dumps({"topic": self.topic, "title": title, "body": body, "url": self.link}).encode(),
            headers={"authorization": f"Bearer {self.token}", "content-type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                response.read()
        except Exception as e:  # noqa: BLE001 - best effort, like the dashboard's sender
            log.error("send %r failed: %s", title, e)
