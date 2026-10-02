"""Check where LabForge stores things and what a build would still download. Read only.

Run from anywhere with the API's Python environment:

    cd apps/api && uv run python ../../scripts/verify_storage.py [template-id]

It prints the workspace disk, Docker's data disk, a dry run of the images and boxes the template
needs right now, and the result of the workspace settings endpoint called with a fresh test folder.
The endpoint demo uses a throwaway config folder and database, so your saved workspace choice is
never touched. Nothing is pulled, built or moved.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

# Keep the endpoint demo away from the real saved setting. Must be set before the services import.
_REAL_CONFIG_DIR = os.environ.get("LABFORGE_CONFIG_DIR")
_DEMO_CONFIG = tempfile.mkdtemp(prefix="lf-verify-config-")

from labforge_core.services import hostmetrics, images, preflight, workspace  # noqa: E402
from labforge_core.services.template_loader import get_template  # noqa: E402


def gb(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.1f} GB"


def section(title: str) -> None:
    print(f"\n== {title} ==")


def main() -> int:
    template_id = sys.argv[1] if len(sys.argv) > 1 else "ransomware-intrusion-lab"

    # Read the real saved choice, not the demo one.
    if _REAL_CONFIG_DIR is not None:
        os.environ["LABFORGE_CONFIG_DIR"] = _REAL_CONFIG_DIR
    else:
        os.environ.pop("LABFORGE_CONFIG_DIR", None)

    repo = workspace.repo_root()
    ws = workspace.status()
    storage = hostmetrics.storage()
    disk = hostmetrics.sample()["disk"]

    section("Workspace (where lab folders go)")
    print(f"repo root            : {repo or 'not a source checkout'}")
    print(f"workspace folder     : {ws['path']}   (set by: {ws['source']})")
    print(f"state                : {ws['state']}" + (f"  - {ws['error']}" if ws["error"] else ""))
    print(f"disk measured at     : {storage['workspace']['measured_path']}  (drive {storage['workspace']['drive']})")
    print(f"home page disk path  : {disk['path']}")
    print(f"free / total         : {gb(storage['workspace']['free_gb'])} / {gb(storage['workspace']['total_gb'])}")
    print(f"writable             : {ws['writable']}")

    section("Docker (where images and Windows disks go)")
    root_dir = preflight.docker_root_dir()
    dd = storage["docker"]
    print(f"docker info DockerRootDir : {root_dir or 'Docker is not answering'}")
    guess = "" if root_dir else "  (a guess, Docker is not answering)"
    print(f"data folder on this host  : {dd.get('path') or 'unknown'}  (drive {dd.get('drive')}){guess}")
    print(f"free / total              : {gb(dd.get('free_gb'))} / {gb(dd.get('total_gb'))}")
    print(f"same drive as workspace   : {storage['same_drive']}")
    if not storage["same_drive"] and dd.get("path"):
        print("note: image downloads fill the Docker drive, lab folders fill the workspace drive. Watch both.")

    section(f"Dry run: what a build of '{template_id}' would download now")
    topology = get_template(template_id)
    plan = images.plan(topology)
    if not plan["engine"]:
        print("Docker is not running, so local images cannot be checked. Start Docker and run this again.")
    for req in plan["requirements"]:
        print(f"[{req['status']:8}] {req['kind']:12} {req['label']}  (used by {', '.join(req['nodes'])})")
    print(f"already here : {len(plan['present_ids'])}  {plan['present_ids']}")
    print(f"to fetch     : {len(plan['missing_ids'])}  {plan['missing_ids']}")
    print(f"download     : about {plan['download_mb']} MB, nothing else is pulled")

    section("Settings endpoint with a fresh test folder (demo config, your setting is untouched)")
    os.environ["LABFORGE_CONFIG_DIR"] = _DEMO_CONFIG
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlmodel import Session, SQLModel, create_engine
    from sqlmodel.pool import StaticPool

    from labforge_core.api.routers import settings as settings_router
    from labforge_core.models import get_session

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    app = FastAPI()
    app.include_router(settings_router.router, prefix="/api/v1")
    with Session(engine) as db, tempfile.TemporaryDirectory(prefix="lf-verify-ws-") as folder:
        app.dependency_overrides[get_session] = lambda: db
        client = TestClient(app)
        print(f"test folder: {folder}")
        for label, call in (
            ("POST /settings/workspace/validate", lambda: client.post("/api/v1/settings/workspace/validate", json={"path": folder})),
            ("PUT  /settings/workspace         ", lambda: client.put("/api/v1/settings/workspace", json={"path": folder})),
            ("GET  /settings/workspace         ", lambda: client.get("/api/v1/settings/workspace")),
            ("PUT  missing folder              ", lambda: client.put("/api/v1/settings/workspace", json={"path": str(Path(folder) / "nope")})),
        ):
            r = call()
            print(f"\n{label} -> {r.status_code}\n{json.dumps(r.json(), indent=2)}")
        print(f"\nroot() in this process after the PUT: {workspace.root()}  (no restart needed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
