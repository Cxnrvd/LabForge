"""log-replay: generate a scenario's synthetic logs and load them into the lab SIEM.

Commands
--------
serve   (default) generate if needed, load Elasticsearch, create the Kibana
        data view and saved searches, then stay alive so the container reports
        healthy and ``docker compose exec`` can re-run the loader.
load    same as serve but exits when done. ``--reset`` regenerates the data
        relative to now and reloads it from scratch.

Only the standard library is used so the image stays small.
"""

from __future__ import annotations

import importlib
import json
import os
import signal
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ES_URL = os.environ.get("ES_URL", "http://elastic:9200").rstrip("/")
KIBANA_URL = os.environ.get("KIBANA_URL", "http://kibana:5601").rstrip("/")
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
SCENARIO = os.environ.get("SCENARIO", "ransomware-intrusion")
if SCENARIO in ("", "default"):
    SCENARIO = "ransomware-intrusion"
READY_FILE = Path("/tmp/labforge-ready")

# Scenario id -> (module, index name, data view id, data view title)
SCENARIOS = {
    "ransomware-intrusion": ("scenarios.ransomware_intrusion", "labforge-ransomware", "labforge-ransomware", "Harborline telemetry"),
}


def log(message: str) -> None:
    print(f"[log-replay] {message}", flush=True)


def http(method: str, url: str, body: bytes | None = None, headers: dict[str, str] | None = None, timeout: float = 120):
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
        return 0, str(exc).encode()


def wait_for(label: str, check, timeout: float = 900, interval: float = 3) -> None:
    deadline = time.monotonic() + timeout
    last = ""
    while time.monotonic() < deadline:
        ok, detail = check()
        if ok:
            log(f"{label} is ready")
            return
        if detail != last:
            log(f"waiting for {label}: {detail}")
            last = detail
        time.sleep(interval)
    raise SystemExit(f"timed out waiting for {label}: {last}")


def es_ready():
    status, body = http("GET", f"{ES_URL}/_cluster/health?wait_for_status=yellow&timeout=5s")
    return status == 200, f"HTTP {status}"


def kibana_ready():
    status, body = http("GET", f"{KIBANA_URL}/api/status")
    if status != 200:
        return False, f"HTTP {status}"
    try:
        level = json.loads(body)["status"]["overall"]["level"]
    except (ValueError, KeyError):
        return False, "unparseable status"
    return level == "available", f"status {level}"


JSON = {"Content-Type": "application/json"}
KBN = {"Content-Type": "application/json", "kbn-xsrf": "labforge"}

KEYWORD_TEXT = {"type": "text", "fields": {"keyword": {"type": "keyword", "ignore_above": 4096}}}
MAPPINGS = {
    "dynamic_templates": [
        {"strings_as_keywords": {"match_mapping_type": "string", "mapping": {"type": "keyword", "ignore_above": 4096}}}
    ],
    "properties": {
        "@timestamp": {"type": "date"},
        "source": {"properties": {"ip": {"type": "ip"}}},
        "destination": {"properties": {"ip": {"type": "ip"}, "port": {"type": "integer"}}},
        "vpn": {"properties": {"assigned_ip": {"type": "ip"}}},
        "network": {"properties": {"bytes": {"type": "long"}}},
        "process": {
            "properties": {
                "command_line": KEYWORD_TEXT,
                "parent": {"properties": {"command_line": KEYWORD_TEXT}},
            }
        },
        "message": {"type": "text"},
    },
}


def generate(module_name: str, force: bool) -> dict[str, str]:
    meta_path = DATA_DIR / "meta.json"
    events_path = DATA_DIR / "events.ndjson"
    if not force and meta_path.exists() and events_path.exists():
        meta = json.loads(meta_path.read_text())
        if meta.get("scenario") == SCENARIO:
            log(f"using existing data in {DATA_DIR} ({meta['documents']} documents)")
            return meta
    module = importlib.import_module(module_name)
    log(f"generating '{SCENARIO}' (synthetic data, deterministic)")
    docs, truth, meta = module.generate(datetime.now(timezone.utc))
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with events_path.open("w", encoding="utf-8") as fh:
        for doc in docs:
            fh.write(json.dumps(doc, separators=(",", ":")) + "\n")
    (DATA_DIR / "answer-key.json").write_text(json.dumps(truth), encoding="utf-8")
    (DATA_DIR / "answer-key.md").write_text(module.answer_key_markdown(truth, meta), encoding="utf-8")
    (DATA_DIR / "hunts.json").write_text(json.dumps(module.HUNTS, indent=2), encoding="utf-8")
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    log(f"wrote {meta['documents']} documents to {events_path}")
    return meta


def count_docs(index: str) -> int:
    status, body = http("GET", f"{ES_URL}/{index}/_count")
    if status != 200:
        return -1
    return int(json.loads(body)["count"])


def load_elasticsearch(index: str, meta: dict[str, str], force: bool) -> None:
    template = {
        "index_patterns": [index],
        "template": {"settings": {"number_of_shards": 1, "number_of_replicas": 0}, "mappings": MAPPINGS},
    }
    status, body = http("PUT", f"{ES_URL}/_index_template/{index}", json.dumps(template).encode(), JSON)
    if status >= 300:
        raise SystemExit(f"index template failed: HTTP {status} {body[:300]!r}")

    expected = int(meta["documents"])
    if not force and count_docs(index) == expected:
        log(f"index {index} already holds {expected} documents; nothing to load")
        return
    http("DELETE", f"{ES_URL}/{index}")
    log(f"loading {expected} documents into {index}")

    batch: list[str] = []
    sent = 0

    def flush() -> None:
        nonlocal batch, sent
        if not batch:
            return
        payload = ("\n".join(batch) + "\n").encode()
        status, body = http("POST", f"{ES_URL}/_bulk", payload, {"Content-Type": "application/x-ndjson"}, timeout=300)
        if status != 200 or json.loads(body).get("errors"):
            raise SystemExit(f"bulk load failed: HTTP {status} {body[:500]!r}")
        sent += len(batch) // 2
        batch = []

    with (DATA_DIR / "events.ndjson").open(encoding="utf-8") as fh:
        for line in fh:
            doc = json.loads(line)
            batch.append(json.dumps({"index": {"_index": index, "_id": doc["event"]["id"]}}))
            batch.append(line.rstrip("\n"))
            if len(batch) >= 8000:
                flush()
                log(f"  {sent}/{expected}")
    flush()
    http("POST", f"{ES_URL}/{index}/_refresh")
    final = count_docs(index)
    if final != expected:
        raise SystemExit(f"expected {expected} documents in {index}, found {final}")
    log(f"loaded {final} documents")


def kibana_post(path: str, payload: dict, method: str = "POST"):
    return http(method, f"{KIBANA_URL}{path}", json.dumps(payload).encode(), KBN)


def load_kibana(index: str, view_id: str, view_title: str, hunts: list[dict]) -> None:
    status, body = kibana_post(
        "/api/data_views/data_view",
        {"override": True, "data_view": {"id": view_id, "title": index, "name": view_title, "timeFieldName": "@timestamp"}},
    )
    if status >= 300:
        raise SystemExit(f"data view failed: HTTP {status} {body[:300]!r}")
    kibana_post("/api/data_views/default", {"data_view_id": view_id, "force": True})
    kibana_post(
        "/api/kibana/settings",
        {"changes": {"timepicker:timeDefaults": json.dumps({"from": "now-7d", "to": "now"}), "defaultIndex": view_id}},
    )
    for hunt in hunts:
        source = {
            "query": {"query": hunt["kql"], "language": "kuery"},
            "filter": [],
            "indexRefName": "kibanaSavedObjectMeta.searchSourceJSON.index",
        }
        payload = {
            "attributes": {
                "title": hunt["title"],
                "description": hunt["description"],
                "columns": hunt["columns"],
                "sort": [["@timestamp", "asc"]],
                "kibanaSavedObjectMeta": {"searchSourceJSON": json.dumps(source)},
            },
            "references": [
                {"name": "kibanaSavedObjectMeta.searchSourceJSON.index", "type": "index-pattern", "id": view_id}
            ],
        }
        status, body = kibana_post(f"/api/saved_objects/search/{hunt['id']}?overwrite=true", payload)
        if status >= 300:
            raise SystemExit(f"saved search {hunt['id']} failed: HTTP {status} {body[:300]!r}")
    log(f"Kibana ready: data view '{view_title}' and {len(hunts)} saved searches")


def run(force: bool) -> None:
    if SCENARIO not in SCENARIOS:
        raise SystemExit(f"unknown scenario '{SCENARIO}'. Available: {', '.join(SCENARIOS)}")
    module_name, index, view_id, view_title = SCENARIOS[SCENARIO]
    wait_for("Elasticsearch", es_ready)
    meta = generate(module_name, force)
    load_elasticsearch(index, meta, force)
    wait_for("Kibana", kibana_ready)
    hunts = json.loads((DATA_DIR / "hunts.json").read_text())
    load_kibana(index, view_id, view_title, hunts)
    READY_FILE.write_text("ready\n")
    log("READY. Open Kibana, Discover, and pick the 'Harborline telemetry' data view.")
    log(f"Answer key (presenter only): {DATA_DIR}/answer-key.md")


def main() -> None:
    args = sys.argv[1:]
    command = args[0] if args else "serve"
    force = "--reset" in args
    if force:
        READY_FILE.unlink(missing_ok=True)
    run(force)
    if command == "load":
        return
    stop = {"now": False}

    def _stop(_signum, _frame):
        stop["now"] = True

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    while not stop["now"]:
        time.sleep(1)


if __name__ == "__main__":
    main()
