"""Generator behavioural + snapshot tests."""

from __future__ import annotations

import io
import json
import zipfile

import pytest

from labforge_core.services.generator import generate_zip


def test_generate_minimal_zip_contains_expected_files(minimal_topology):
    data = generate_zip(minimal_topology)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = set(zf.namelist())
    assert "Vagrantfile" in names
    assert "topology.json" in names
    assert "manifest.json" in names
    assert any(n.startswith("provision/") for n in names)


def test_generate_includes_manifest_with_topology_hash(minimal_topology):
    data = generate_zip(minimal_topology)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        manifest = json.loads(zf.read("manifest.json"))
    assert manifest["manifest_version"] == 1
    assert manifest["topology"]["node_count"] == 1
    assert len(manifest["topology"]["sha256"]) == 64
    file_names = {entry["name"] for entry in manifest["files"]}
    assert "Vagrantfile" in file_names
    assert "topology.json" in file_names


def test_manifest_is_stable_across_runs(minimal_topology):
    """Topology hash must be identical regardless of generation timing."""
    data1 = generate_zip(minimal_topology)
    data2 = generate_zip(minimal_topology)
    with zipfile.ZipFile(io.BytesIO(data1)) as zf:
        m1 = json.loads(zf.read("manifest.json"))
    with zipfile.ZipFile(io.BytesIO(data2)) as zf:
        m2 = json.loads(zf.read("manifest.json"))
    assert m1["topology"]["sha256"] == m2["topology"]["sha256"]


def test_compose_target_emits_compose_yaml(two_node_topology):
    data = generate_zip(two_node_topology, target="docker-compose")
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = set(zf.namelist())
        compose_yaml = zf.read("docker-compose.yml").decode()
    assert "docker-compose.yml" in names
    assert "topology.json" in names
    assert "manifest.json" in names
    assert "labforge-srv" in compose_yaml or "srv" in compose_yaml


def test_compose_manifest_records_target(two_node_topology):
    data = generate_zip(two_node_topology, target="docker-compose")
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        manifest = json.loads(zf.read("manifest.json"))
    assert manifest["generator"]["target"] == "docker-compose"


def test_unknown_target_raises(minimal_topology):
    with pytest.raises(ValueError):
        generate_zip(minimal_topology, target="nonsense")


def test_each_template_generates(all_template_paths, load_template):
    """Every shipped template must render a valid Vagrant bundle."""
    assert all_template_paths, "no templates discovered"
    for path in all_template_paths:
        topology = load_template(path)
        data = generate_zip(topology)
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = set(zf.namelist())
        assert "Vagrantfile" in names, f"{path.name} missing Vagrantfile"
        assert "manifest.json" in names, f"{path.name} missing manifest"
