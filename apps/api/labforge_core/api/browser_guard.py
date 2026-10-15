"""Keep other web pages from driving this API through the user's browser.

* Host check: the ``Host`` header must be a name we expect. This stops DNS rebinding, where a
  hostile page re-points its own domain at 127.0.0.1 and then talks to the API as same-origin.
* Origin check: a state-changing request (POST, PATCH, DELETE) or a WebSocket from a browser page
  must come from the web app (a configured origin or a loopback address). Without it any website
  could POST ``/labs/1/halt`` to the user's machine, because a body-less POST is a CORS "simple
  request" that the browser sends without asking first.

Requests without an Origin header (curl, the agent CLI, the Next.js proxy) are not affected.
"""

from __future__ import annotations

import json
import re

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
_LOOPBACK_ORIGIN = re.compile(r"^https?://(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$")


def hostname(value: str) -> str:
    """``127.0.0.1:8010`` -> ``127.0.0.1``, ``[::1]:8010`` -> ``::1``."""
    value = value.strip().lower()
    if value.startswith("["):
        return value[1:].split("]", 1)[0]
    return value.rsplit(":", 1)[0] if value.count(":") == 1 else value


class BrowserGuardMiddleware:
    def __init__(self, app, *, allowed_hosts: list[str], allowed_origins: list[str]) -> None:
        self.app = app
        self.allowed_hosts = {h.lower() for h in allowed_hosts}
        self.allowed_origins = {o.rstrip("/").lower() for o in allowed_origins}

    def _origin_ok(self, origin: str) -> bool:
        origin = origin.rstrip("/").lower()
        return origin in self.allowed_origins or bool(_LOOPBACK_ORIGIN.match(origin))

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        host = headers.get("host")
        reject: tuple[int, str, str] | None = None
        if host and "*" not in self.allowed_hosts and hostname(host) not in self.allowed_hosts:
            reject = (400, "host_not_allowed", f"Host {host!r} is not allowed")
        else:
            origin = headers.get("origin")
            unsafe = scope["type"] == "websocket" or scope["method"] not in _SAFE_METHODS
            if origin and unsafe and not self._origin_ok(origin):
                reject = (403, "origin_not_allowed", f"Origin {origin!r} is not allowed")
        if reject is None:
            await self.app(scope, receive, send)
            return

        status_code, code, message = reject
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        body = json.dumps({"detail": {"detail": message, "code": code}}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": status_code,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
