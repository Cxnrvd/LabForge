"""Provenance manifest tests."""

from __future__ import annotations

import json

from labforge_core.services.provenance import build_manifest, topology_hash


def test_topology_hash_is_stable(minimal_topology):
    h1 = topology_hash(minimal_topology)
    h2 = topology_hash(minimal_topology)
    assert h1 == h2
    assert len(h1) == 64


def test_topology_hash_changes_with_data(minimal_topology, two_node_topology):
    assert topology_hash(minimal_topology) != topology_hash(two_node_topology)


def test_manifest_records_files(minimal_topology):
    files = {"Vagrantfile": "x" * 100, "topology.json": "{}"}
    manifest = json.loads(build_manifest(minimal_topology, file_contents=files))
    names = {entry["name"] for entry in manifest["files"]}
    assert names == {"Vagrantfile", "topology.json"}
    for entry in manifest["files"]:
        assert len(entry["sha256"]) == 64


def test_manifest_records_target(minimal_topology):
    manifest = json.loads(
        build_manifest(minimal_topology, file_contents={}, target="docker-compose")
    )
    assert manifest["generator"]["target"] == "docker-compose"
