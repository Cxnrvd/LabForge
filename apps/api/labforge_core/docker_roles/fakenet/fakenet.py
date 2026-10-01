"""fakenet: a tiny stand-in for the internet, for dynamic malware analysis.

* DNS (UDP/53): every A query is answered with this container's own address, so
  a sample that resolves its "C2 domain" ends up talking to us. Other record
  types get an empty NOERROR answer.
* HTTP (TCP/80): every request gets a 200 and a small JSON body.

Each DNS query and HTTP request is logged as one JSON line on stdout, so
``docker compose logs -f fakenet`` shows the callbacks as they happen.
Standard library only.
"""

from __future__ import annotations

import json
import os
import signal
import socket
import struct
import sys
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

READY = "/tmp/fakenet-ready"
LOG_FILE = "/var/log/fakenet.jsonl"
_lock = threading.Lock()


def own_ip() -> str:
    override = os.environ.get("FAKENET_IP")
    if override:
        return override
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # No packet is sent; this just asks the kernel which address it would use.
        sock.connect(("192.0.2.1", 9))
        return sock.getsockname()[0]
    except OSError:
        return socket.gethostbyname(socket.gethostname())
    finally:
        sock.close()


def emit(kind: str, **fields: object) -> None:
    record = {"ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z", "kind": kind, **fields}
    line = json.dumps(record, separators=(",", ":"))
    with _lock:
        print(line, flush=True)
        try:
            with open(LOG_FILE, "a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError:
            pass


# ---------------------------------------------------------------- DNS


def parse_question(packet: bytes) -> tuple[str, int, int, int] | None:
    """Return (name, qtype, qclass, end_offset) of the first question."""
    if len(packet) < 17:
        return None
    pos = 12
    labels = []
    while True:
        if pos >= len(packet):
            return None
        length = packet[pos]
        if length == 0:
            pos += 1
            break
        if length & 0xC0:  # compression pointers are not expected in questions
            return None
        labels.append(packet[pos + 1 : pos + 1 + length].decode("ascii", "replace"))
        pos += 1 + length
    if pos + 4 > len(packet):
        return None
    qtype, qclass = struct.unpack("!HH", packet[pos : pos + 4])
    return ".".join(labels), qtype, qclass, pos + 4


def build_response(packet: bytes, ip: str) -> tuple[bytes, str, int] | None:
    parsed = parse_question(packet)
    if parsed is None:
        return None
    name, qtype, qclass, end = parsed
    txid = packet[:2]
    question = packet[12:end]
    if qtype == 1 and qclass == 1:  # A
        header = txid + struct.pack("!HHHHH", 0x8180, 1, 1, 0, 0)
        answer = b"\xc0\x0c" + struct.pack("!HHIH", 1, 1, 30, 4) + socket.inet_aton(ip)
        return header + question + answer, name, qtype
    header = txid + struct.pack("!HHHHH", 0x8180, 1, 0, 0, 0)
    return header + question, name, qtype


def dns_server(ip: str, ready: threading.Event) -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("0.0.0.0", 53))
    ready.set()
    while True:
        data, addr = sock.recvfrom(1500)
        built = build_response(data, ip)
        if built is None:
            continue
        reply, name, qtype = built
        emit("dns", client=addr[0], query=name, qtype={1: "A", 28: "AAAA", 15: "MX", 16: "TXT"}.get(qtype, str(qtype)),
             answer=ip if qtype == 1 else None)
        sock.sendto(reply, addr)


# --------------------------------------------------------------- HTTP


class Handler(BaseHTTPRequestHandler):
    server_version = "fakenet"

    def _handle(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        emit(
            "http",
            client=self.client_address[0],
            method=self.command,
            host=self.headers.get("Host"),
            path=self.path,
            user_agent=self.headers.get("User-Agent"),
            body=body.decode("utf-8", "replace")[:500] or None,
        )
        payload = json.dumps({"status": "ok", "task": "sleep", "interval": 60}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_GET = do_POST = do_PUT = do_HEAD = _handle

    def log_message(self, *args: object) -> None:  # we log structured lines ourselves
        return


def main() -> None:
    ip = own_ip()
    ready = threading.Event()
    threading.Thread(target=dns_server, args=(ip, ready), daemon=True).start()
    ready.wait(5)
    http = ThreadingHTTPServer(("0.0.0.0", 80), Handler)
    http.daemon_threads = True
    emit("start", ip=ip, services=["dns/53", "http/80"])
    open(READY, "w").write("ready\n")
    signal.signal(signal.SIGTERM, lambda *_: (http.shutdown(), sys.exit(0)))
    http.serve_forever()


if __name__ == "__main__":
    main()
