"""Render Vagrantfiles, provisioner scripts, hosts file, and README from a topology."""

from __future__ import annotations

import io
import re
import shlex
import zipfile
from dataclasses import dataclass

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape
from labforge_schema import LabConfig, NodeType, OsType, Provider, TopologyNode

from labforge_core.provisioners.cve_lookup import resolve_cve_payload
from labforge_core.provisioners.role_installers import (
    RoleSnippet,
    linux_snippet,
    windows_snippet,
)
from labforge_core.services.compose_generator import build_bundle as build_compose_bundle
from labforge_core.services.provenance import build_manifest
from labforge_core.services.validator import is_windows
from labforge_core.settings import get_settings

# Vagrant boxes per OS — every entry is a publicly-downloadable box on
# Vagrant Cloud (https://app.vagrantup.com/). Anything that doesn't have a
# real public box (macOS, RHEL/subscriptions, appliance OS like pfSense /
# OpenWrt, ICS RTOS like VxWorks / Siemens SIMATIC, IP-camera firmware)
# falls back to ubuntu/jammy64 and the provisioner sets up the appropriate
# emulator (OpenPLC, MediaMTX, dnsmasq+iptables for routers, etc.).
# Use the same Ubuntu LTS for every OS that has no public Vagrant box
# (router/firewall appliances, ICS RTOS, camera firmware, niche distros).
# Pinning to bento/ubuntu-22.04 keeps everything in the same cache
# entry as UBUNTU_2204 — one provider variant per provider, no
# duplicate downloads.
SAFE_FALLBACK_BOX = "bento/ubuntu-22.04"

BOX_MAP: dict[OsType, str] = {
    # ---- Windows: StefanScherer ships eval-licensed boxes for both
    # ``virtualbox`` and ``vmware_desktop`` providers on Win10/11/2019/2022,
    # so we don't have to vendor-switch when the topology changes provider.
    OsType.WINDOWS_10: "StefanScherer/windows_10",
    OsType.WINDOWS_11: "StefanScherer/windows_11",
    OsType.WINDOWS_SERVER_2019: "StefanScherer/windows_2019",
    OsType.WINDOWS_SERVER_2022: "StefanScherer/windows_2022",
    # ---- Mainstream Linux servers. bento/ubuntu-22.04 ships both providers
    # publicly; ubuntu/jammy64 is virtualbox-only on Vagrant Cloud.
    OsType.UBUNTU_2204: "bento/ubuntu-22.04",
    OsType.UBUNTU_2404: "bento/ubuntu-24.04",
    OsType.DEBIAN_12: "debian/bookworm64",
    OsType.CENTOS_STREAM_9: "generic/centos9s",
    OsType.RHEL_9: "generic/centos9s",  # RHEL needs a subscription; CentOS Stream 9 is the upstream
    OsType.FEDORA_40: SAFE_FALLBACK_BOX,  # fedora cloud images aren't proper Vagrant boxes
    OsType.OPENSUSE_TUMBLEWEED: SAFE_FALLBACK_BOX,
    OsType.ARCH_ROLLING: "archlinux/archlinux",
    OsType.ALPINE_LATEST: "generic/alpine318",
    OsType.FREEBSD_14: "generic/freebsd14",
    # ---- macOS: no public Vagrant box exists (Apple licensing); use the fallback
    OsType.MACOS_SONOMA: SAFE_FALLBACK_BOX,
    OsType.MACOS_SEQUOIA: SAFE_FALLBACK_BOX,
    # ---- Offensive / privacy
    # The official kalilinux/rolling box is ~3 GB and isn't always in the
    # local cache; bootstrap an Ubuntu base instead and let the role
    # installers (nmap, metasploit, impacket, etc.) add the offensive
    # toolchain on top. Same VM, faster first build.
    OsType.KALI_ROLLING: "bento/ubuntu-22.04",
    OsType.PARROT_SECURITY: "bento/ubuntu-22.04",
    OsType.BLACKARCH_ROLLING: "archlinux/archlinux",
    OsType.TAILS_6: "debian/bookworm64",
    OsType.WHONIX_17: "debian/bookworm64",
    # ---- Router / firewall appliance OS — emulated on Ubuntu
    OsType.OPENWRT_23: SAFE_FALLBACK_BOX,
    OsType.VYOS_1_4: SAFE_FALLBACK_BOX,
    OsType.ROUTEROS_7: SAFE_FALLBACK_BOX,
    OsType.CISCO_IOS_XE: SAFE_FALLBACK_BOX,
    OsType.JUNIPER_JUNOS_22: SAFE_FALLBACK_BOX,
    OsType.PFSENSE_2_7: SAFE_FALLBACK_BOX,
    OsType.OPNSENSE_24: SAFE_FALLBACK_BOX,
    OsType.FORTIOS_7: SAFE_FALLBACK_BOX,
    OsType.PANOS_11: SAFE_FALLBACK_BOX,
    OsType.SOPHOS_XG_19: SAFE_FALLBACK_BOX,
    # ---- ICS / embedded — emulated on Ubuntu via OpenPLC etc.
    OsType.VXWORKS_7: SAFE_FALLBACK_BOX,
    OsType.SIEMENS_SIMATIC: SAFE_FALLBACK_BOX,
    OsType.SCHNEIDER_MODICON: SAFE_FALLBACK_BOX,
    OsType.RASPBIAN_12: "debian/bookworm64",
    OsType.QNX_NEUTRINO: SAFE_FALLBACK_BOX,
    # ---- Camera firmware — emulated on Ubuntu via MediaMTX
    OsType.IP_CAMERA_FIRMWARE: SAFE_FALLBACK_BOX,
}

# Whether a given OsType has a "real" Vagrant box (used to flag emulated
# nodes in the generated README).
_REAL_BOX_OSES = {
    OsType.WINDOWS_10, OsType.WINDOWS_11,
    OsType.WINDOWS_SERVER_2019, OsType.WINDOWS_SERVER_2022,
    OsType.UBUNTU_2204, OsType.UBUNTU_2404,
    OsType.DEBIAN_12, OsType.CENTOS_STREAM_9,
    OsType.ALPINE_LATEST, OsType.FREEBSD_14,
    OsType.KALI_ROLLING, OsType.ARCH_ROLLING,
    OsType.RASPBIAN_12,
}


def is_emulated_os(os: OsType) -> bool:
    return os not in _REAL_BOX_OSES


# Vagrant provider names differ from our LabConfig enum: the official
# Vagrant VMware plugin registers itself as ``vmware_desktop`` on
# Windows/Linux (and ``vmware_fusion`` on macOS, which we don't target),
# not ``vmware``. The Vagrantfile and the ``--provider`` CLI flag must
# both use the registered plugin name or Vagrant errors with "Provider
# 'vmware' could not be found". Keep this mapping in one place so the
# generator and the build runner can't drift.
_VAGRANT_PROVIDER_NAMES: dict[Provider, str] = {
    Provider.VIRTUALBOX: "virtualbox",
    Provider.VMWARE: "vmware_desktop",
    Provider.LIBVIRT: "libvirt",
}


def vagrant_provider_name(provider: Provider) -> str:
    return _VAGRANT_PROVIDER_NAMES.get(provider, provider.value)


@dataclass(frozen=True)
class GeneratedArtifacts:
    vagrantfile: str
    provisioner_scripts: dict[str, str]
    hosts_file: str
    readme: str


def _safe_slug(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip()).strip("-")
    return slug.lower() or "node"


def bash_q(value: object) -> str:
    """Render ``value`` as a POSIX-shell-safe quoted token.

    Use this filter on EVERY template interpolation that lands inside a
    bash command, even when the source field is regex-validated — the
    schema can be relaxed later, and tojson-style universal escaping is
    cheaper than auditing each callsite again.
    """
    return shlex.quote("" if value is None else str(value))


def ps_q(value: object) -> str:
    """Render ``value`` as a single-quoted PowerShell string literal.

    PowerShell single quotes are inert except for the single-quote
    character itself, which is escaped by doubling. Use this for any
    string interpolated into a PowerShell command — including SecureString
    payloads, hostnames, and IPs surfaced by the topology.
    """
    s = "" if value is None else str(value)
    return "'" + s.replace("'", "''") + "'"


def _jinja_env() -> Environment:
    settings = get_settings()
    env = Environment(
        loader=FileSystemLoader(str(settings.jinja_dir)),
        autoescape=select_autoescape(default=False),
        undefined=StrictUndefined,
        keep_trailing_newline=True,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters["bash_q"] = bash_q
    env.filters["ps_q"] = ps_q
    return env


def _parse_role(role: str) -> tuple[str, str | None]:
    """Split a role string like ``wazuh@4.9.0`` into ``("wazuh", "4.9.0")``."""
    if "@" in role:
        bare, version = role.split("@", 1)
        return bare, version
    return role, None


def _compute_endpoints(topology: LabConfig) -> dict[str, str]:
    """Discover well-known service IPs from the topology so role installers
    can wire agents up automatically (Wazuh agent → Wazuh manager, etc.)."""
    endpoints: dict[str, str] = {}
    role_to_endpoint = {
        "wazuh-manager": "wazuh_manager_ip",
        "wazuh": "wazuh_manager_ip",  # the first node carrying wazuh wins
        "splunk-enterprise": "splunk_indexer_ip",
        "splunk-uf-receiver": "splunk_indexer_ip",
        "elasticstack": "elastic_ip",
        "elastic": "elastic_ip",
        "kibana": "kibana_ip",
        "grafana": "grafana_ip",
        "ollama": "ollama_ip",
        "mongodb": "mongodb_ip",
        "openplc": "openplc_ip",
        "mediamtx": "mediamtx_ip",
    }
    for node in topology.nodes:
        if node.type == NodeType.INTERNET:
            continue
        for role in node.config.roles:
            bare, _ = _parse_role(role)
            key = role_to_endpoint.get(bare)
            if key and key not in endpoints:
                endpoints[key] = node.config.ip
    return endpoints


def _render_role_block(
    env: Environment,
    role: str,
    *,
    node: TopologyNode,
    topology: LabConfig,
    endpoints: dict[str, str],
    is_windows_node: bool,
) -> dict[str, str]:
    """Render the install snippet for a single role into a label + body."""
    bare, version = _parse_role(role)
    snippet: RoleSnippet | None = (
        windows_snippet(bare) if is_windows_node else linux_snippet(bare)
    )
    label_version = f" ({version})" if version else ""
    if snippet is None:
        body = (
            f"# Role '{bare}'{label_version}: no curated installer.\n"
            f"# Edit this block to provision it. See "
            f"apps/api/labforge_core/provisioners/role_installers.py to add one.\n"
        )
        return {
            "label": bare,
            "version": version or "",
            "description": "no curated installer",
            "body": body,
        }
    rendered = env.from_string(snippet.script).render(
        node=node,
        topology=topology,
        endpoints=endpoints,
        version=version,
    )
    return {
        "label": snippet.role_id + label_version,
        "version": version or "",
        "description": snippet.description,
        "body": rendered,
    }


def _render_node(
    env: Environment,
    node: TopologyNode,
    *,
    topology: LabConfig,
    endpoints: dict[str, str],
) -> tuple[str, str]:
    """Return (script_filename, script_contents) for a node."""
    cve_blocks = [resolve_cve_payload(cve) for cve in node.config.cves]
    extension = "ps1" if is_windows(node) else "sh"
    filename = f"provision_{_safe_slug(node.config.hostname)}.{extension}"
    template_name = (
        "provision_windows.ps1.j2" if is_windows(node) else "provision_linux.sh.j2"
    )
    install_blocks = [
        _render_role_block(
            env,
            role,
            node=node,
            topology=topology,
            endpoints=endpoints,
            is_windows_node=is_windows(node),
        )
        for role in node.config.roles
    ]
    contents = env.get_template(template_name).render(
        node=node,
        is_dc=node.type == NodeType.DOMAIN_CONTROLLER,
        cve_blocks=cve_blocks,
        install_blocks=install_blocks,
        endpoints=endpoints,
    )
    return filename, contents


def _is_provisionable(node: TopologyNode) -> bool:
    """Skip nodes that represent abstract external endpoints (e.g. internet)."""
    return node.type != NodeType.INTERNET


def generate_artifacts(
    topology: LabConfig,
    *,
    include_readme: bool = True,
    include_hosts_file: bool = True,
) -> GeneratedArtifacts:
    if topology.provider is Provider.DOCKER:
        raise ValueError(
            "topology.provider is 'docker': use the docker-compose target, not the Vagrant generator"
        )
    env = _jinja_env()

    provisionable_nodes = [n for n in topology.nodes if _is_provisionable(n)]
    external_nodes = [n for n in topology.nodes if not _is_provisionable(n)]
    endpoints = _compute_endpoints(topology)

    provisioners: dict[str, tuple[str, TopologyNode]] = {}
    for node in provisionable_nodes:
        filename, contents = _render_node(env, node, topology=topology, endpoints=endpoints)
        provisioners[node.id] = (filename, node)
        provisioners[f"__contents__:{filename}"] = (contents, node)  # type: ignore[assignment]

    vagrant_nodes = []
    for node in provisionable_nodes:
        filename = provisioners[node.id][0]
        vagrant_nodes.append(
            {
                "id": node.id,
                "hostname": node.config.hostname,
                "box": BOX_MAP.get(node.config.os, SAFE_FALLBACK_BOX),
                "is_windows": is_windows(node),
                "is_emulated": is_emulated_os(node.config.os),
                "os_label": node.config.os.value,
                "ip": node.config.ip,
                "memory_mb": node.config.memory_mb,
                "cpus": node.config.cpus,
                "provision_script": f"provision/{filename}",
                "node_type": node.type.value,
            }
        )

    vagrantfile = env.get_template("Vagrantfile.j2").render(
        topology=topology,
        vagrant_nodes=vagrant_nodes,
        external_nodes=external_nodes,
        vagrant_provider=vagrant_provider_name(topology.provider),
    )

    hosts_file = ""
    if include_hosts_file:
        hosts_file = "\n".join(
            f"{n.config.ip}\t{n.config.hostname}"
            for n in provisionable_nodes
        ) + "\n"

    readme = ""
    if include_readme:
        readme = env.get_template("README.md.j2").render(
            topology=topology,
            vagrant_nodes=vagrant_nodes,
            box_map=BOX_MAP,
            external_nodes=external_nodes,
        )

    flat_scripts: dict[str, str] = {}
    for key, value in provisioners.items():
        if key.startswith("__contents__:"):
            filename = key.split(":", 1)[1]
            flat_scripts[filename] = value[0]  # type: ignore[index]

    return GeneratedArtifacts(
        vagrantfile=vagrantfile,
        provisioner_scripts=flat_scripts,
        hosts_file=hosts_file,
        readme=readme,
    )


def generate_zip(
    topology: LabConfig,
    *,
    include_readme: bool = True,
    include_hosts_file: bool = True,
    target: str = "vagrant",
    publish: str = "loopback",
    project: str | None = None,
) -> bytes:
    """Build the downloadable zip for either target.

    ``target='vagrant'`` (default) — Vagrantfile + per-node provisioner
    scripts. ``target='docker-compose'`` — docker-compose.yml + env/ +
    fallback notes for nodes that need a real VM.

    Both targets ship the same ``topology.json`` source-of-truth and a
    ``manifest.json`` with sha256 digests + tool/schema versions so the
    bundle is reproducibly identifiable.
    """
    file_contents: dict[str, str | bytes] = {}

    if target == "vagrant":
        artifacts = generate_artifacts(
            topology,
            include_readme=include_readme,
            include_hosts_file=include_hosts_file,
        )
        file_contents["Vagrantfile"] = artifacts.vagrantfile
        for filename, body in artifacts.provisioner_scripts.items():
            file_contents[f"provision/{filename}"] = body
        if artifacts.hosts_file:
            file_contents["hosts"] = artifacts.hosts_file
        if artifacts.readme:
            file_contents["README.md"] = artifacts.readme
    elif target == "docker-compose":
        files, _artifacts = build_compose_bundle(
            topology,
            publish=publish,
            project=project,
            include_readme=include_readme,
            include_hosts_file=include_hosts_file,
        )
        file_contents.update(files)
    else:
        raise ValueError(f"Unknown target: {target!r}")

    file_contents["topology.json"] = topology.model_dump_json(indent=2)
    manifest = build_manifest(topology, file_contents=file_contents, target=target)
    file_contents["manifest.json"] = manifest

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for filename, body in file_contents.items():
            zf.writestr(filename, body)
    return buf.getvalue()
