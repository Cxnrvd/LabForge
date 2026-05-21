"""Agent configuration stored at ~/.labforge/config.yaml."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml

DEFAULT_CONFIG_DIR = Path.home() / ".labforge"
DEFAULT_CONFIG_PATH = DEFAULT_CONFIG_DIR / "config.yaml"
DEFAULT_WORKSPACE = DEFAULT_CONFIG_DIR / "workspaces"


@dataclass
class AgentConfig:
    provider: str = "virtualbox"
    workspace_root: Path = DEFAULT_WORKSPACE
    api_base: str = "http://127.0.0.1:8000"
    api_token: Optional[str] = None

    @classmethod
    def load(cls, path: Path = DEFAULT_CONFIG_PATH) -> "AgentConfig":
        if not path.exists():
            cfg = cls()
        else:
            with path.open("r", encoding="utf-8") as fh:
                data = yaml.safe_load(fh) or {}
            cfg = cls(
                provider=data.get("provider", "virtualbox"),
                workspace_root=Path(data.get("workspace_root", str(DEFAULT_WORKSPACE))),
                api_base=data.get("api_base", "http://127.0.0.1:8000"),
                api_token=data.get("api_token"),
            )
        # Env var overrides the yaml so users don't have to commit the token.
        env_token = os.environ.get("LABFORGE_API_TOKEN")
        if env_token:
            cfg.api_token = env_token
        return cfg

    def save(self, path: Path = DEFAULT_CONFIG_PATH) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "provider": self.provider,
            "workspace_root": str(self.workspace_root),
            "api_base": self.api_base,
        }
        if self.api_token:
            payload["api_token"] = self.api_token
        with path.open("w", encoding="utf-8") as fh:
            yaml.safe_dump(payload, fh, sort_keys=False)

    def workspace_for(self, lab_name: str) -> Path:
        return self.workspace_root / lab_name


def find_workspace_by_name(name: str, root: Optional[Path] = None) -> Optional[Path]:
    base = root or DEFAULT_WORKSPACE
    candidate = base / name
    return candidate if candidate.exists() else None
