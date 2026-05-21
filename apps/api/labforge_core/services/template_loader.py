"""Load topology templates from disk."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from labforge_schema import LabConfig

from labforge_core.settings import get_settings


class TemplateNotFound(Exception):
    def __init__(self, template_id: str) -> None:
        super().__init__(f"Template not found: {template_id}")
        self.template_id = template_id


@lru_cache(maxsize=1)
def _template_index() -> dict[str, Path]:
    settings = get_settings()
    root = settings.templates_dir
    if not root.exists():
        return {}
    # Skip AppleDouble resource-fork files (._*) that macOS sometimes
    # leaves in shared folders — they aren't real JSON.
    return {
        p.stem: p
        for p in sorted(root.glob("*.json"))
        if not p.name.startswith("._")
    }


def list_templates() -> list[LabConfig]:
    return [_load(path) for path in _template_index().values()]


def get_template(template_id: str) -> LabConfig:
    index = _template_index()
    if template_id not in index:
        raise TemplateNotFound(template_id)
    return _load(index[template_id])


def _load(path: Path) -> LabConfig:
    with path.open("r", encoding="utf-8") as fh:
        return LabConfig.model_validate(json.load(fh))
