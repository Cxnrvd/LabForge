"""Build a provenance manifest for generated lab bundles.

Every zip that leaves ``/api/v1/generate`` (or the Build Lab flow) ships
with a ``manifest.json`` listing:

  * topology hash (sha256 over the canonical JSON form)
  * schema version
  * generator version
  * NVD / role-installer versions
  * generated_at timestamp + tool ("labforge-api 0.1.0")
  * file inventory with per-file sha256

Why this matters: a security audience pulls a lab bundle, runs `vagrant
up`, and wants to know what they're running and whether it's been
tampered with. The manifest is the smallest credible answer.

The signing step (cosign) is left as a future extension — the manifest
is structured so it can be detached-signed without changes here.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Mapping

from labforge_schema import LabConfig

LABFORGE_API_VERSION = "0.1.0"
SCHEMA_VERSION = "1.0"
ROLE_INSTALLER_VERSION = "1.0.0"
CVE_LIBRARY_VERSION = "1.1.0"


def _sha256_str(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def topology_hash(topology: LabConfig) -> str:
    """sha256 over the canonical JSON form (sorted keys, compact)."""
    canonical = json.dumps(
        json.loads(topology.model_dump_json()),
        sort_keys=True,
        separators=(",", ":"),
    )
    return _sha256_str(canonical)


def build_manifest(
    topology: LabConfig,
    *,
    file_contents: Mapping[str, str | bytes],
    target: str = "vagrant",
) -> str:
    """Render a manifest JSON document for the given bundle.

    ``file_contents`` is the same dict that's about to be written into
    the zip — we compute one sha256 per entry so a verifier can compare
    later. Returns the JSON text (caller writes it into the zip).
    """
    files = []
    for name in sorted(file_contents):
        body = file_contents[name]
        digest = _sha256_bytes(body if isinstance(body, bytes) else body.encode("utf-8"))
        size = len(body if isinstance(body, bytes) else body.encode("utf-8"))
        files.append({"name": name, "sha256": digest, "size": size})

    manifest = {
        "manifest_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "generator": {
            "tool": "labforge-api",
            "version": LABFORGE_API_VERSION,
            "target": target,
        },
        "schema_version": SCHEMA_VERSION,
        "role_installer_version": ROLE_INSTALLER_VERSION,
        "cve_library_version": CVE_LIBRARY_VERSION,
        "topology": {
            "id": topology.id,
            "name": topology.name,
            "node_count": len(topology.nodes),
            "edge_count": len(topology.edges),
            "zone_count": len(topology.zones),
            "network_cidr": topology.network_cidr,
            "provider": topology.provider.value,
            "sha256": topology_hash(topology),
        },
        "files": files,
    }
    return json.dumps(manifest, indent=2)
