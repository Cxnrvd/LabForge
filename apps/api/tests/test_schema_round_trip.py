"""All bundled templates must round-trip through the canonical schema."""

from __future__ import annotations

import json

import pytest

from labforge_schema import LabConfig


def test_template_roundtrip(all_template_paths):
    assert all_template_paths, "no templates discovered"
    for path in all_template_paths:
        with path.open() as fh:
            data = json.load(fh)
        parsed = LabConfig.model_validate(data)
        again = LabConfig.model_validate_json(parsed.model_dump_json())
        assert len(again.nodes) == len(parsed.nodes), path.name
        assert len(again.edges) == len(parsed.edges), path.name
        assert len(again.zones) == len(parsed.zones), path.name


def test_schema_rejects_unknown_field():
    from labforge_schema import LabConfig as LC
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        LC.model_validate(
            {
                "name": "x",
                "network_cidr": "192.168.56.0/24",
                "nodes": [],
                "rogue_field": "should_fail",
            }
        )


def test_attack_tag_validates_technique_format():
    from labforge_schema import AttackTactic, AttackTag
    from pydantic import ValidationError

    AttackTag(tactic=AttackTactic.INITIAL_ACCESS, technique="T1190")
    AttackTag(tactic=AttackTactic.INITIAL_ACCESS, technique="T1190.001")
    with pytest.raises(ValidationError):
        AttackTag(tactic=AttackTactic.IMPACT, technique="bad")
