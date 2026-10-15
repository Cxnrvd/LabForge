"""Talk to the LabForge HTTP API (templates + generate)."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import httpx

from labforge_schema import LabConfig


class AgentApiError(RuntimeError):
    pass


def _headers(token: Optional[str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"} if token else {}


def list_templates(base_url: str, token: Optional[str] = None) -> list[dict]:
    try:
        response = httpx.get(
            f"{base_url}/api/v1/templates",
            timeout=10.0,
            headers=_headers(token),
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise AgentApiError(f"Failed to list templates: {exc}") from exc
    return response.json()


def fetch_template(base_url: str, template_id: str, token: Optional[str] = None) -> LabConfig:
    try:
        response = httpx.get(
            f"{base_url}/api/v1/templates/{template_id}",
            timeout=10.0,
            headers=_headers(token),
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise AgentApiError(f"Failed to fetch template {template_id}: {exc}") from exc
    return LabConfig.model_validate(response.json())


def generate_zip(
    base_url: str,
    topology: LabConfig,
    target: Path,
    token: Optional[str] = None,
) -> Path:
    payload = {
        "topology": topology.model_dump(mode="json"),
        "include_readme": True,
        "include_hosts_file": True,
    }
    try:
        response = httpx.post(
            f"{base_url}/api/v1/generate",
            json=payload,
            timeout=60.0,
            headers=_headers(token),
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise AgentApiError(f"Failed to generate lab: {exc}") from exc
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(response.content)
    return target
