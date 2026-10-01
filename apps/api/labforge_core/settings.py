"""Runtime configuration loaded from environment."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LABFORGE_", env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./labforge.db"
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    nvd_api_base: str = "https://services.nvd.nist.gov/rest/json/cves/2.0"
    nvd_api_key: str | None = None
    nvd_timeout_seconds: float = 10.0

    # Shared bearer token. When unset, write endpoints accept all callers
    # (preserves the open-by-default dev experience). When set, the agent and
    # the web client must send `Authorization: Bearer <token>` on writes.
    agent_token: str | None = None

    templates_dir: Path = Path(__file__).parents[3] / "packages" / "schema" / "templates"
    jinja_dir: Path = Path(__file__).parent / "templates"
    provisioner_scripts_dir: Path = Path(__file__).parent / "provisioners" / "scripts"

    # Where the API extracts lab bundles and runs `vagrant up` for the
    # in-app Build Lab flow. Same default as the agent CLI so workspaces
    # show up consistently regardless of who triggered the build.
    workspace_root: Path = Path.home() / ".labforge" / "workspaces"

    # Vagrant box handling. ``box_overrides`` maps an OS id to a box name, e.g.
    # LABFORGE_BOX_OVERRIDES='{"windows_10": "myorg/win10-lab"}'. With
    # ``verify_boxes`` on, a build checks the box exists for the provider
    # (already downloaded, or listed on Vagrant Cloud) before it starts.
    box_overrides: dict[str, str] = {}
    verify_boxes: bool = True


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
