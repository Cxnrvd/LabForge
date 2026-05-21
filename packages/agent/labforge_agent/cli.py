"""LabForge agent CLI — `labforge` entrypoint."""

from __future__ import annotations

import json
import re
import shutil
import zipfile
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt
from rich.table import Table

import httpx

from labforge_schema import LabConfig

from labforge_agent import daemon
from labforge_agent.api_client import (
    AgentApiError,
    fetch_template,
    generate_zip,
    list_templates,
)
from labforge_agent.config import AgentConfig, DEFAULT_CONFIG_PATH
from labforge_agent.runtime import (
    VagrantNotFound,
    assert_vagrant_available,
    capture_vagrant,
    run_vagrant,
)

app = typer.Typer(help="LabForge — provision cyber labs from a topology JSON.", no_args_is_help=True)
templates_app = typer.Typer(help="Browse and pull templates.", no_args_is_help=True)
app.add_typer(templates_app, name="templates")
console = Console()


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-") or "lab"


def _print_banner() -> None:
    console.print(
        Panel.fit(
            "[bold cyan]LabForge[/] — diagram-driven cyber labs",
            border_style="cyan",
        )
    )


@app.command()
def init(
    provider: str = typer.Option("virtualbox", help="virtualbox | vmware | libvirt"),
    workspace: Optional[Path] = typer.Option(None, help="Where labs are extracted"),
    api_base: str = typer.Option("http://127.0.0.1:8000", help="LabForge API base URL"),
    token: Optional[str] = typer.Option(
        None, help="Bearer token for the API; matches LABFORGE_AGENT_TOKEN on the server."
    ),
) -> None:
    """Create ~/.labforge/config.yaml with sensible defaults."""
    _print_banner()
    cfg = AgentConfig.load()
    cfg.provider = provider
    cfg.api_base = api_base
    if workspace is not None:
        cfg.workspace_root = workspace
    if token is not None:
        cfg.api_token = token or None
    cfg.workspace_root.mkdir(parents=True, exist_ok=True)
    cfg.save()
    console.print(f"[green]✓[/] Wrote config to [bold]{DEFAULT_CONFIG_PATH}[/]")
    console.print(f"  provider       : {cfg.provider}")
    console.print(f"  workspace_root : {cfg.workspace_root}")
    console.print(f"  api_base       : {cfg.api_base}")
    console.print(f"  api_token      : {'set' if cfg.api_token else 'unset'}")


@app.command()
def run(
    topology_path: Path = typer.Argument(..., exists=True, readable=True),
    name: Optional[str] = typer.Option(None, help="Override workspace name"),
    skip_provision: bool = typer.Option(
        False, "--skip-provision", help="Generate files but do not run `vagrant up`"
    ),
) -> None:
    """Generate a Vagrant workspace from a topology JSON, then bring it up."""
    _print_banner()
    cfg = AgentConfig.load()
    try:
        topology = LabConfig.model_validate(json.loads(topology_path.read_text("utf-8")))
    except Exception as exc:
        console.print(f"[red]✗[/] Invalid topology JSON: {exc}")
        raise typer.Exit(code=1) from exc

    workspace_name = name or _slug(topology.name)
    workspace = cfg.workspace_for(workspace_name)
    if workspace.exists() and any(workspace.iterdir()):
        choice = Prompt.ask(
            f"Workspace [yellow]{workspace}[/] is not empty. Overwrite?",
            choices=["y", "n"],
            default="n",
        )
        if choice == "n":
            console.print("Aborted.")
            raise typer.Exit(code=1)
        shutil.rmtree(workspace)

    workspace.mkdir(parents=True, exist_ok=True)
    zip_target = workspace / "lab.zip"
    console.print(f"[cyan]→[/] Generating provisioning bundle via {cfg.api_base}")
    try:
        generate_zip(cfg.api_base, topology, zip_target, token=cfg.api_token)
    except AgentApiError as exc:
        console.print(f"[red]✗[/] {exc}")
        raise typer.Exit(code=1) from exc

    with zipfile.ZipFile(zip_target) as zf:
        zf.extractall(workspace)
    zip_target.unlink()
    console.print(f"[green]✓[/] Extracted lab to [bold]{workspace}[/]")

    if skip_provision:
        console.print("Skipping `vagrant up` (--skip-provision).")
        return

    try:
        assert_vagrant_available()
    except VagrantNotFound as exc:
        console.print(f"[yellow]⚠[/] {exc}. Files are ready in {workspace}.")
        raise typer.Exit(code=1) from exc

    # Register the lab with the API so the dashboard's Active Labs section
    # picks it up; capture the id for heartbeats.
    lab_id: Optional[int] = None
    try:
        resp = httpx.post(
            f"{cfg.api_base}/api/v1/labs",
            json={
                "topology_slug": _slug(topology.name),
                "name": topology.name,
                "provider": topology.provider.value,
                "workspace_path": str(workspace),
            },
            timeout=5,
            headers=(
                {"Authorization": f"Bearer {cfg.api_token}"} if cfg.api_token else {}
            ),
        )
        if resp.status_code in (200, 201):
            lab_id = int(resp.json().get("id") or 0) or None
            console.print(f"[green]✓[/] Lab registered with API (id={lab_id}).")
        else:
            console.print(f"[yellow]⚠[/] API registration returned {resp.status_code}; continuing without heartbeats.")
    except httpx.HTTPError as exc:
        console.print(f"[yellow]⚠[/] Could not reach API at {cfg.api_base}: {exc}. Continuing without heartbeats.")

    console.print("[cyan]→[/] Running [bold]vagrant up[/]…")
    rc = run_vagrant(["up"], cwd=workspace, check=False)
    if rc != 0:
        console.print(f"[red]✗[/] vagrant up failed (exit {rc}).")
        raise typer.Exit(code=rc)
    console.print(f"[green]✓[/] Lab [bold]{topology.name}[/] is online.")

    if lab_id:
        pid = daemon.spawn_detached(
            lab_id=lab_id,
            workspace=workspace,
            api_base=cfg.api_base,
            api_token=cfg.api_token,
        )
        console.print(
            f"[green]✓[/] Heartbeat daemon running (PID {pid}); dashboard will see live status."
        )


@app.command()
def status(
    name: Optional[str] = typer.Argument(None, help="Workspace name (omit to list all)"),
) -> None:
    """Show `vagrant status` for one lab or summarise every workspace."""
    cfg = AgentConfig.load()
    if name is None:
        if not cfg.workspace_root.exists():
            console.print("No workspaces yet — run [bold]labforge run <topology.json>[/].")
            return
        table = Table(title="Workspaces", show_lines=False)
        table.add_column("Name", style="cyan")
        table.add_column("Path")
        table.add_column("Has Vagrantfile")
        for child in sorted(cfg.workspace_root.iterdir()):
            if child.is_dir():
                table.add_row(
                    child.name,
                    str(child),
                    "[green]yes[/]" if (child / "Vagrantfile").exists() else "[red]no[/]",
                )
        console.print(table)
        return

    workspace = cfg.workspace_for(name)
    if not (workspace / "Vagrantfile").exists():
        console.print(f"[red]✗[/] No workspace named [bold]{name}[/] at {workspace}")
        raise typer.Exit(code=1)
    output = capture_vagrant(["status"], cwd=workspace)
    console.print(Panel(output.strip() or "(no output)", title=f"vagrant status — {name}"))


@app.command()
def destroy(
    name: str = typer.Argument(..., help="Workspace name"),
    keep_files: bool = typer.Option(
        False, "--keep-files", help="Run `vagrant destroy` but keep the workspace dir."
    ),
    yes: bool = typer.Option(False, "-y", "--yes", help="Skip confirmation prompt."),
) -> None:
    """Tear down a provisioned lab."""
    cfg = AgentConfig.load()
    workspace = cfg.workspace_for(name)
    if not workspace.exists():
        console.print(f"[red]✗[/] No workspace named [bold]{name}[/] at {workspace}")
        raise typer.Exit(code=1)

    if not yes:
        choice = Prompt.ask(
            f"Destroy lab [bold]{name}[/] at {workspace}?",
            choices=["y", "n"],
            default="n",
        )
        if choice == "n":
            console.print("Aborted.")
            return

    # Stop the heartbeat daemon first so it doesn't post stale data while
    # vagrant tears things down.
    daemon.request_stop(workspace)

    rc = run_vagrant(["destroy", "-f"], cwd=workspace, check=False)
    if rc != 0:
        console.print(f"[yellow]⚠[/] vagrant destroy exited {rc} — continuing")
    if not keep_files:
        shutil.rmtree(workspace)
        console.print(f"[green]✓[/] Removed {workspace}")
    else:
        console.print(f"[green]✓[/] Lab destroyed; files kept in {workspace}")


@templates_app.command("list")
def templates_list() -> None:
    """List templates available from the LabForge API."""
    cfg = AgentConfig.load()
    try:
        rows = list_templates(cfg.api_base, token=cfg.api_token)
    except AgentApiError as exc:
        console.print(f"[red]✗[/] {exc}")
        raise typer.Exit(code=1) from exc
    table = Table(title="LabForge templates", show_lines=False)
    table.add_column("ID", style="cyan")
    table.add_column("Name")
    table.add_column("Nodes", justify="right")
    table.add_column("Edges", justify="right")
    table.add_column("Description")
    for row in rows:
        table.add_row(
            row["id"],
            row["name"],
            str(row["node_count"]),
            str(row["edge_count"]),
            row["description"][:80],
        )
    console.print(table)


@templates_app.command("pull")
def templates_pull(
    template_id: str = typer.Argument(...),
    output: Path = typer.Option(Path("topology.json"), help="Where to write the JSON."),
) -> None:
    """Download a template as a topology.json you can edit or `labforge run`."""
    cfg = AgentConfig.load()
    try:
        topology = fetch_template(cfg.api_base, template_id, token=cfg.api_token)
    except AgentApiError as exc:
        console.print(f"[red]✗[/] {exc}")
        raise typer.Exit(code=1) from exc
    output.write_text(topology.model_dump_json(indent=2), encoding="utf-8")
    console.print(f"[green]✓[/] Wrote {output}")


@app.command("daemon", help="Heartbeat loop — posts lab status to the API every interval.")
def daemon_cmd(
    lab_id: int = typer.Option(..., help="Lab id assigned by POST /api/v1/labs"),
    workspace: Path = typer.Option(..., exists=True, file_okay=False, dir_okay=True),
    api_base: str = typer.Option("http://127.0.0.1:8000"),
    interval: int = typer.Option(10, help="Seconds between heartbeats"),
    one_shot: bool = typer.Option(False, "--one-shot", help="Send one heartbeat then exit"),
) -> None:
    import os as _os

    api_token = _os.environ.get("LABFORGE_API_TOKEN") or AgentConfig.load().api_token
    rc = daemon.run(
        lab_id=lab_id,
        workspace=workspace,
        api_base=api_base,
        interval=interval,
        one_shot=one_shot,
        api_token=api_token,
    )
    raise typer.Exit(code=rc)


if __name__ == "__main__":
    app()
