"""Canonical LabForge topology schema in Pydantic v2.

This module mirrors `packages/schema/src/index.ts`. Any change here must be
reflected in the TypeScript module and vice versa.
"""

from __future__ import annotations

import re
import uuid
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class NodeType(str, Enum):
    WORKSTATION = "workstation"
    SERVER = "server"
    DOMAIN_CONTROLLER = "domain_controller"
    ROUTER = "router"
    FIREWALL = "firewall"
    ATTACKER = "attacker"
    TARGET = "target"
    DATABASE = "database"
    ICS_PLC = "ics_plc"
    ICS_HMI = "ics_hmi"
    CAMERA = "camera"
    INTERNET = "internet"


class OsType(str, Enum):
    WINDOWS_10 = "windows_10"
    WINDOWS_11 = "windows_11"
    WINDOWS_SERVER_2019 = "windows_server_2019"
    WINDOWS_SERVER_2022 = "windows_server_2022"
    UBUNTU_2204 = "ubuntu_2204"
    UBUNTU_2404 = "ubuntu_2404"
    DEBIAN_12 = "debian_12"
    CENTOS_STREAM_9 = "centos_stream_9"
    RHEL_9 = "rhel_9"
    FEDORA_40 = "fedora_40"
    OPENSUSE_TUMBLEWEED = "opensuse_tumbleweed"
    ARCH_ROLLING = "arch_rolling"
    ALPINE_LATEST = "alpine_latest"
    FREEBSD_14 = "freebsd_14"
    MACOS_SONOMA = "macos_sonoma"
    MACOS_SEQUOIA = "macos_sequoia"
    KALI_ROLLING = "kali_rolling"
    PARROT_SECURITY = "parrot_security"
    BLACKARCH_ROLLING = "blackarch_rolling"
    TAILS_6 = "tails_6"
    WHONIX_17 = "whonix_17"
    OPENWRT_23 = "openwrt_23"
    VYOS_1_4 = "vyos_1_4"
    ROUTEROS_7 = "routeros_7"
    CISCO_IOS_XE = "cisco_ios_xe"
    JUNIPER_JUNOS_22 = "juniper_junos_22"
    PFSENSE_2_7 = "pfsense_2_7"
    OPNSENSE_24 = "opnsense_24"
    FORTIOS_7 = "fortios_7"
    PANOS_11 = "panos_11"
    SOPHOS_XG_19 = "sophos_xg_19"
    VXWORKS_7 = "vxworks_7"
    SIEMENS_SIMATIC = "siemens_simatic"
    SCHNEIDER_MODICON = "schneider_modicon"
    RASPBIAN_12 = "raspbian_12"
    QNX_NEUTRINO = "qnx_neutrino"
    IP_CAMERA_FIRMWARE = "ip_camera_firmware"


class Protocol(str, Enum):
    TCP = "tcp"
    UDP = "udp"
    ICMP = "icmp"
    HTTP = "http"
    HTTPS = "https"
    SSH = "ssh"
    RDP = "rdp"
    SMB = "smb"
    LDAP = "ldap"
    KERBEROS = "kerberos"
    MODBUS = "modbus"
    DNP3 = "dnp3"
    OPCUA = "opcua"
    RTSP = "rtsp"
    MQTT = "mqtt"
    CUSTOM = "custom"


class Provider(str, Enum):
    VIRTUALBOX = "virtualbox"
    VMWARE = "vmware"
    LIBVIRT = "libvirt"
    # Container runtime: the lab is rendered to a docker-compose project and
    # started with ``docker compose up`` instead of ``vagrant up``.
    DOCKER = "docker"


class AttackTactic(str, Enum):
    """MITRE ATT&CK tactic identifiers (the 14 enterprise tactics).

    Used to colour and filter the canvas by attack phase. Optional —
    legacy topologies without tags are still valid.
    """

    RECONNAISSANCE = "reconnaissance"
    RESOURCE_DEVELOPMENT = "resource_development"
    INITIAL_ACCESS = "initial_access"
    EXECUTION = "execution"
    PERSISTENCE = "persistence"
    PRIVILEGE_ESCALATION = "privilege_escalation"
    DEFENSE_EVASION = "defense_evasion"
    CREDENTIAL_ACCESS = "credential_access"
    DISCOVERY = "discovery"
    LATERAL_MOVEMENT = "lateral_movement"
    COLLECTION = "collection"
    COMMAND_AND_CONTROL = "command_and_control"
    EXFILTRATION = "exfiltration"
    IMPACT = "impact"


class Severity(str, Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    NONE = "NONE"


class ZoneShape(str, Enum):
    RECTANGLE = "rectangle"
    ELLIPSE = "ellipse"
    TRIANGLE = "triangle"
    CLOUD = "cloud"


_IPV4_RE = re.compile(
    r"^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$"
)
_CVE_RE = re.compile(r"^CVE-\d{4}-\d{4,7}$", re.IGNORECASE)
_CIDR_RE = re.compile(
    r"^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)"
    r"/(?:3[0-2]|[12]?\d)$"
)
_HOSTNAME_RE = re.compile(r"^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$")
_TECHNIQUE_RE = re.compile(r"^T\d{4}(\.\d{3})?$")
# Defence-in-depth alongside the bash_q / ps_q escaping in the generator:
# reject the shell metacharacters that would otherwise let a password
# break out of a bash double-quoted string, a PowerShell SecureString
# argument, or a SQL string literal nested inside one of those.
_PASSWORD_RE = re.compile(r"^[^\"'`$;\\\r\n]+$")
# topology.name lands in Vagrantfile string literals, generated
# filenames, slugs, and lab labels. Restrict to printable ASCII minus
# quoting and Ruby-interpolation metas so the value is safe across
# every downstream consumer.
_TOPOLOGY_NAME_RE = re.compile(r"^[A-Za-z0-9 \-_.,!?():]+$")
# Defence-in-depth alongside the bash_q / ps_q escaping in the generator, same reasoning as
# _PASSWORD_RE: a role string reaches a provisioner script's shell/PowerShell text (both the
# bare role name and the free-text "@version" suffix, e.g. "siemens-simatic@TIA Portal V19") and
# must not be able to break out of the double-quoted lines it's spliced into. Version suffixes in
# the bundled templates use spaces (vendor/product names), so those stay allowed; shell and
# PowerShell metacharacters do not.
_ROLE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*(@[A-Za-z0-9][A-Za-z0-9._ -]*)?$")


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128, pattern=r"""^[^"'`$;\\\r\n]+$""")

    @field_validator("password")
    @classmethod
    def _validate_password(cls, v: str) -> str:
        if not _PASSWORD_RE.match(v):
            raise ValueError(
                "Password must not contain shell metacharacters: \" ' ` $ ; \\ or newlines"
            )
        return v


class Position(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: float
    y: float


class Size(BaseModel):
    model_config = ConfigDict(extra="forbid")
    width: float = Field(ge=40)
    height: float = Field(ge=40)


class NodeConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    os: OsType
    ip: str = Field(pattern=r"^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$")
    hostname: str = Field(min_length=1, max_length=63, pattern=r"^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$")
    cves: list[str] = Field(default_factory=list)
    roles: list[str] = Field(default_factory=list)
    memory_mb: int = Field(default=2048, ge=256, le=65536)
    cpus: int = Field(default=2, ge=1, le=32)
    credentials: Credentials
    vlan: Optional[int] = Field(default=None, ge=1, le=4094)
    gateway: Optional[str] = None
    # Optional Docker image hint used by the docker-compose generator.
    # When set, the compose target runs the node as a container instead
    # of a VM (where the OS/role mix allows it).
    compose_image: Optional[str] = Field(default=None, max_length=256)
    # Optional host USB device to pass through to this VM (VirtualBox only).
    # Four hex digits each, as reported by the host adapter-listing endpoint
    # or `lsusb`/Device Manager. Both must be set together to take effect —
    # see docker_roles.py / generator.py for the "what this does and doesn't
    # do" note; this field only identifies the device, it carries no
    # attack tooling or network configuration of its own.
    usb_vendor_id: Optional[str] = Field(default=None, pattern=r"^[0-9a-fA-F]{4}$")
    usb_product_id: Optional[str] = Field(default=None, pattern=r"^[0-9a-fA-F]{4}$")

    @field_validator("ip")
    @classmethod
    def _validate_ip(cls, v: str) -> str:
        if not _IPV4_RE.match(v):
            raise ValueError(f"Invalid IPv4 address: {v}")
        return v

    @field_validator("gateway")
    @classmethod
    def _validate_gateway(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not _IPV4_RE.match(v):
            raise ValueError(f"Invalid IPv4 gateway: {v}")
        return v

    @field_validator("hostname")
    @classmethod
    def _validate_hostname(cls, v: str) -> str:
        if not _HOSTNAME_RE.match(v):
            raise ValueError(f"Invalid hostname: {v}")
        return v

    @field_validator("cves")
    @classmethod
    def _validate_cves(cls, v: list[str]) -> list[str]:
        normalized: list[str] = []
        for cve in v:
            if not _CVE_RE.match(cve):
                raise ValueError(f"Invalid CVE id (expected CVE-YYYY-NNNN): {cve}")
            normalized.append(cve.upper())
        return normalized

    @field_validator("roles")
    @classmethod
    def _validate_roles(cls, v: list[str]) -> list[str]:
        for role in v:
            if not _ROLE_RE.match(role):
                raise ValueError(
                    f"Invalid role {role!r}: use letters, digits, '.', '_', '-', and an "
                    "optional '@version' (spaces allowed in the version only)"
                )
        return v


class AttackTag(BaseModel):
    """A single MITRE ATT&CK annotation on a node or edge.

    ``tactic`` is required; ``technique`` is optional and must match the
    ``T1234`` / ``T1234.001`` pattern when present. ``note`` is a free-form
    human comment used in tooltips and the lab report.
    """

    model_config = ConfigDict(extra="forbid")
    tactic: AttackTactic
    technique: Optional[str] = Field(default=None, max_length=16)
    note: Optional[str] = Field(default=None, max_length=256)

    @field_validator("technique")
    @classmethod
    def _validate_technique(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not _TECHNIQUE_RE.match(v):
            raise ValueError(
                f"Technique must look like T1234 or T1234.001 (got {v!r})"
            )
        return v


class TopologyNode(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1)
    type: NodeType
    label: str = Field(min_length=1, max_length=64)
    position: Position
    config: NodeConfig
    attack_tags: list[AttackTag] = Field(default_factory=list)


class TopologyEdge(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1)
    source: str = Field(min_length=1)
    target: str = Field(min_length=1)
    protocol: Protocol = Protocol.TCP
    port: Optional[int] = Field(default=None, ge=1, le=65535)
    label: Optional[str] = Field(default=None, max_length=64)
    attack_tags: list[AttackTag] = Field(default_factory=list)


class Zone(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1)
    label: str = Field(default="", max_length=64)
    shape: ZoneShape
    position: Position
    size: Size
    color: str = Field(default="#fbbf24", min_length=1)
    opacity: float = Field(default=0.15, ge=0.0, le=1.0)


class LabConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9 \-_.,!?():]+$")
    description: str = Field(default="", max_length=2048)
    network_cidr: str = Field(pattern=r"^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\/(3[0-2]|[12]?\d)$")
    provider: Provider = Provider.VIRTUALBOX
    # Upper bound is a safety net for the generator (memory, build time);
    # 500 nodes is well past anything a single host can actually `vagrant up`.
    nodes: list[TopologyNode] = Field(min_length=1, max_length=500)
    edges: list[TopologyEdge] = Field(default_factory=list)
    zones: list[Zone] = Field(default_factory=list)
    version: str = "1.0"

    @field_validator("network_cidr")
    @classmethod
    def _validate_cidr(cls, v: str) -> str:
        if not _CIDR_RE.match(v):
            raise ValueError(f"Invalid CIDR: {v}")
        return v

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        if not _TOPOLOGY_NAME_RE.match(v):
            raise ValueError(
                "Name must be ASCII-safe (letters, digits, spaces, and -_.,!?():)"
            )
        return v


TopologySchema = LabConfig


class ValidationIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")
    node_id: Optional[str] = None
    edge_id: Optional[str] = None
    field: Optional[str] = None
    message: str
    severity: str = "error"


class ValidationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    valid: bool
    issues: list[ValidationIssue] = Field(default_factory=list)


class CVEEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    description: str
    severity: Severity
    cvss_score: Optional[float] = None
    published: Optional[str] = None
    affected_products: list[str] = Field(default_factory=list)
    references: list[str] = Field(default_factory=list)


DEFAULT_OS_PER_NODE_TYPE: dict[NodeType, OsType] = {
    NodeType.WORKSTATION: OsType.WINDOWS_10,
    NodeType.SERVER: OsType.UBUNTU_2204,
    NodeType.DOMAIN_CONTROLLER: OsType.WINDOWS_SERVER_2019,
    NodeType.ROUTER: OsType.OPENWRT_23,
    NodeType.FIREWALL: OsType.PFSENSE_2_7,
    NodeType.ATTACKER: OsType.KALI_ROLLING,
    NodeType.TARGET: OsType.UBUNTU_2204,
    NodeType.DATABASE: OsType.UBUNTU_2204,
    NodeType.ICS_PLC: OsType.SIEMENS_SIMATIC,
    NodeType.ICS_HMI: OsType.WINDOWS_10,
    NodeType.CAMERA: OsType.IP_CAMERA_FIRMWARE,
    NodeType.INTERNET: OsType.UBUNTU_2204,
}

NODE_TYPE_LABELS: dict[NodeType, str] = {
    NodeType.WORKSTATION: "Workstation",
    NodeType.SERVER: "Server",
    NodeType.DOMAIN_CONTROLLER: "Domain Controller",
    NodeType.ROUTER: "Router",
    NodeType.FIREWALL: "Firewall",
    NodeType.ATTACKER: "Attacker",
    NodeType.TARGET: "Target",
    NodeType.DATABASE: "Database",
    NodeType.ICS_PLC: "PLC",
    NodeType.ICS_HMI: "HMI / SCADA",
    NodeType.CAMERA: "IP Camera",
    NodeType.INTERNET: "Internet",
}

OS_LABELS: dict[OsType, str] = {
    OsType.WINDOWS_10: "Windows 10",
    OsType.WINDOWS_11: "Windows 11",
    OsType.WINDOWS_SERVER_2019: "Windows Server 2019",
    OsType.WINDOWS_SERVER_2022: "Windows Server 2022",
    OsType.UBUNTU_2204: "Ubuntu 22.04 LTS",
    OsType.UBUNTU_2404: "Ubuntu 24.04 LTS",
    OsType.DEBIAN_12: "Debian 12",
    OsType.CENTOS_STREAM_9: "CentOS Stream 9",
    OsType.RHEL_9: "Red Hat Enterprise Linux 9",
    OsType.FEDORA_40: "Fedora 40",
    OsType.OPENSUSE_TUMBLEWEED: "openSUSE Tumbleweed",
    OsType.ARCH_ROLLING: "Arch Linux",
    OsType.ALPINE_LATEST: "Alpine Linux",
    OsType.FREEBSD_14: "FreeBSD 14",
    OsType.MACOS_SONOMA: "macOS 14 Sonoma",
    OsType.MACOS_SEQUOIA: "macOS 15 Sequoia",
    OsType.KALI_ROLLING: "Kali Linux Rolling",
    OsType.PARROT_SECURITY: "Parrot Security OS",
    OsType.BLACKARCH_ROLLING: "BlackArch Linux",
    OsType.TAILS_6: "Tails 6",
    OsType.WHONIX_17: "Whonix 17",
    OsType.OPENWRT_23: "OpenWrt 23.05",
    OsType.VYOS_1_4: "VyOS 1.4",
    OsType.ROUTEROS_7: "MikroTik RouterOS 7",
    OsType.CISCO_IOS_XE: "Cisco IOS-XE",
    OsType.JUNIPER_JUNOS_22: "Juniper Junos 22",
    OsType.PFSENSE_2_7: "pfSense 2.7 CE",
    OsType.OPNSENSE_24: "OPNsense 24",
    OsType.FORTIOS_7: "Fortinet FortiOS 7",
    OsType.PANOS_11: "Palo Alto PAN-OS 11",
    OsType.SOPHOS_XG_19: "Sophos XG 19",
    OsType.VXWORKS_7: "VxWorks 7",
    OsType.SIEMENS_SIMATIC: "Siemens SIMATIC (S7)",
    OsType.SCHNEIDER_MODICON: "Schneider Modicon",
    OsType.RASPBIAN_12: "Raspberry Pi OS 12",
    OsType.QNX_NEUTRINO: "QNX Neutrino RTOS",
    OsType.IP_CAMERA_FIRMWARE: "IP Camera Firmware",
}
