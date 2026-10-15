"""Other web pages must not be able to drive the API through the browser."""

from __future__ import annotations

import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from labforge_core.api.browser_guard import BrowserGuardMiddleware, hostname


@pytest.fixture
def client():
    app = FastAPI()

    @app.post("/act")
    def act():
        return {"ok": True}

    @app.get("/read")
    def read():
        return {"ok": True}

    @app.websocket("/ws")
    async def ws(socket: WebSocket):
        await socket.accept()
        await socket.send_json({"hello": 1})
        await socket.close()

    app.add_middleware(
        BrowserGuardMiddleware,
        allowed_hosts=["127.0.0.1", "localhost", "testserver"],
        allowed_origins=["http://127.0.0.1:3000"],
    )
    return TestClient(app)


def test_hostname_parsing():
    assert hostname("127.0.0.1:8010") == "127.0.0.1"
    assert hostname("[::1]:8010") == "::1"
    assert hostname("Localhost") == "localhost"


def test_curl_style_requests_without_origin_work(client):
    assert client.post("/act").status_code == 200


def test_post_from_another_site_is_refused(client):
    r = client.post("/act", headers={"Origin": "https://evil.example"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "origin_not_allowed"


def test_post_from_the_web_app_or_any_loopback_port_is_allowed(client):
    assert client.post("/act", headers={"Origin": "http://127.0.0.1:3000"}).status_code == 200
    assert client.post("/act", headers={"Origin": "http://localhost:3123"}).status_code == 200


def test_reading_is_not_blocked_by_origin(client):
    # CORS already stops the other page from reading the answer.
    assert client.get("/read", headers={"Origin": "https://evil.example"}).status_code == 200


def test_dns_rebinding_host_is_refused(client):
    r = client.get("/read", headers={"Host": "attacker.example:8010"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "host_not_allowed"


def test_websocket_from_another_site_is_closed(client):
    with pytest.raises(WebSocketDisconnect), client.websocket_connect("/ws", headers={"Origin": "https://evil.example"}):
        pass
    with client.websocket_connect("/ws", headers={"Origin": "http://127.0.0.1:3000"}) as ok:
        assert ok.receive_json() == {"hello": 1}
