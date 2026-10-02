"""Container presets for the docker runtime.

A *role* in a LabForge topology (``elastic``, ``kibana``, ``mysql`` ...) maps
to a ``DockerRole`` here: the image to run, the environment variables that
image needs to start, a healthcheck so ``docker compose up --wait`` knows when
the service is actually ready, and how it wires to other nodes in the lab.

Two kinds of role live here:

* **Stock roles** use a pinned public image (``mysql:8.0.40`` ...).
* **Custom roles** ship a Dockerfile under ``labforge_core/docker_roles/<dir>``
  that is copied into the lab workspace and built on first ``up``. These carry
  the scenario content for the bundled labs (log replay, analyst tooling,
  malware analysis, fake internet).

Only roles flagged ``verified=True`` are exercised by the integration tests.
Everything else is best effort and the generator says so in its warnings
instead of failing silently.

Template values
---------------
String values in ``environment`` / ``command`` / ``volumes`` may use:

``{username}`` ``{password}`` ``{hostname}`` ``{ip}``
    The node's own settings.
``{version}``
    The part after ``@`` in a role such as ``log-replay@ransomware-intrusion``.
``{peer:<role>}``
    Hostname of the first node in the topology that has ``<role>``.
``{peer_ip:<role>}``
    IP address of that node.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field


@dataclass(frozen=True)
class DockerRole:
    role_id: str
    image: str | None = None
    # Directory under ``labforge_core/docker_roles`` holding a Dockerfile.
    build_dir: str | None = None
    command: tuple[str, ...] | None = None
    environment: Mapping[str, str] = field(default_factory=dict)
    # Container ports. Published to 127.0.0.1 when the build asks for it.
    ports: tuple[int, ...] = ()
    healthcheck: Mapping[str, object] | None = None
    volumes: tuple[str, ...] = ()
    # Roles that must be healthy before this one starts.
    depends_on: tuple[str, ...] = ()
    cap_add: tuple[str, ...] = ()
    security_opt: tuple[str, ...] = ()
    tty: bool = False
    # Put the whole lab network offline (no route to the internet).
    isolate_network: bool = False
    # Use the node that has this role as the container's DNS resolver.
    dns_from: str | None = None
    verified: bool = False
    note: str = ""


def _hc(test: str, *, interval: int = 5, retries: int = 30, start: int = 10) -> dict[str, object]:
    return {
        "test": ["CMD-SHELL", test],
        "interval": f"{interval}s",
        "timeout": "5s",
        "retries": retries,
        "start_period": f"{start}s",
    }


# Pin Elastic stack versions together; Kibana refuses to talk to a different
# major/minor of Elasticsearch.
ELASTIC_VERSION = "8.15.3"

_ROLES: tuple[DockerRole, ...] = (
    # ------------------------------------------------------------ stock roles
    DockerRole("apache", image="httpd:2.4.62", ports=(80,)),
    DockerRole("nginx", image="nginx:1.27.2", ports=(80,)),
    DockerRole(
        "mysql",
        image="mysql:8.0.40",
        ports=(3306,),
        environment={"MYSQL_ROOT_PASSWORD": "{password}"},
        healthcheck=_hc('mysqladmin ping -h 127.0.0.1 -uroot -p"$$MYSQL_ROOT_PASSWORD" --silent',
                        interval=5, retries=40, start=20),
    ),
    DockerRole(
        "postgresql",
        image="postgres:16.4",
        ports=(5432,),
        environment={
            "POSTGRES_USER": "{username}",
            "POSTGRES_PASSWORD": "{password}",
            "POSTGRES_DB": "lab",
        },
        healthcheck=_hc('pg_isready -U "$$POSTGRES_USER" -d lab'),
    ),
    DockerRole(
        "mongodb",
        image="mongo:7.0.14",
        ports=(27017,),
        environment={
            "MONGO_INITDB_ROOT_USERNAME": "{username}",
            "MONGO_INITDB_ROOT_PASSWORD": "{password}",
        },
    ),
    DockerRole(
        "redis",
        image="redis:7.4.1",
        ports=(6379,),
        command=("redis-server", "--requirepass", "{password}"),
    ),
    DockerRole(
        "grafana",
        image="grafana/grafana:11.2.0",
        ports=(3000,),
        environment={
            "GF_SECURITY_ADMIN_USER": "{username}",
            "GF_SECURITY_ADMIN_PASSWORD": "{password}",
        },
    ),
    DockerRole("prometheus", image="prom/prometheus:v2.54.1", ports=(9090,)),
    DockerRole(
        "keycloak",
        image="quay.io/keycloak/keycloak:25.0",
        ports=(8080,),
        command=("start-dev",),
        environment={"KEYCLOAK_ADMIN": "{username}", "KEYCLOAK_ADMIN_PASSWORD": "{password}"},
    ),
    DockerRole(
        "vault",
        image="hashicorp/vault:1.18",
        ports=(8200,),
        command=("server", "-dev"),
        environment={
            "VAULT_DEV_ROOT_TOKEN_ID": "{password}",
            "VAULT_DEV_LISTEN_ADDRESS": "0.0.0.0:8200",
        },
        cap_add=("IPC_LOCK",),
    ),
    DockerRole(
        "mqtt",
        image="eclipse-mosquitto:2.0.20",
        ports=(1883, 9001),
        command=(
            "sh",
            "-c",
            "printf 'listener 1883 0.0.0.0\\nallow_anonymous true\\n' > /tmp/m.conf "
            "&& exec mosquitto -c /tmp/m.conf",
        ),
    ),
    DockerRole("ollama", image="ollama/ollama:0.3.14", ports=(11434,)),
    DockerRole("mediamtx", image="bluenviron/mediamtx:1.9.3", ports=(8554, 8889)),
    DockerRole("openplc", image="openplc/openplc_v3:latest", ports=(8080, 502),
               note="Image tag is not pinned upstream."),
    DockerRole("suricata", image="jasonish/suricata:7.0.7",
               note="Needs host networking or an interface mirror to see lab traffic."),
    DockerRole("wazuh-manager", image="wazuh/wazuh-manager:4.9.0",
               note="Needs a Wazuh indexer and dashboard to be useful; not wired up."),
    DockerRole("bloodhound", image="specterops/bloodhound:latest", ports=(8080,),
               note="Needs Postgres and Neo4j; not wired up."),
    DockerRole("metasploit", image="metasploitframework/metasploit-framework:latest", tty=True),
    # ------------------------------------------------------- Elastic stack
    DockerRole(
        "elastic",
        image=f"docker.elastic.co/elasticsearch/elasticsearch:{ELASTIC_VERSION}",
        ports=(9200,),
        environment={
            "discovery.type": "single-node",
            # Lab convenience: no TLS or login in front of the demo cluster.
            "xpack.security.enabled": "false",
            "xpack.ml.enabled": "false",
            "ES_JAVA_OPTS": "-Xms768m -Xmx768m",
            # A nearly full laptop disk must not flip the lab's indices read-only.
            "cluster.routing.allocation.disk.threshold_enabled": "false",
            "action.destructive_requires_name": "false",
        },
        healthcheck=_hc(
            "curl -fs 'http://localhost:9200/_cluster/health?wait_for_status=yellow&timeout=3s' "
            ">/dev/null",
            interval=5, retries=60, start=20,
        ),
        volumes=("elastic-data:/usr/share/elasticsearch/data",),
        verified=True,
    ),
    DockerRole(
        "kibana",
        image=f"docker.elastic.co/kibana/kibana:{ELASTIC_VERSION}",
        ports=(5601,),
        environment={
            "ELASTICSEARCH_HOSTS": "http://{peer:elastic}:9200",
            "TELEMETRY_OPTIN": "false",
            "TELEMETRY_ALLOWCHANGINGOPTINSTATUS": "false",
            "NEWSFEED_ENABLED": "false",
            "XPACK_SECURITY_SHOWINSECURECLUSTERWARNING": "false",
            "XPACK_ENCRYPTEDSAVEDOBJECTS_ENCRYPTIONKEY": "labforge-lab-only-encryption-key-0001",
            "XPACK_REPORTING_ENCRYPTIONKEY": "labforge-lab-only-reporting-key-00001",
            "XPACK_SECURITY_ENCRYPTIONKEY": "labforge-lab-only-security-key-000001",
        },
        healthcheck=_hc(
            "curl -fs http://localhost:5601/api/status | grep -q '\"level\":\"available\"'",
            interval=10, retries=60, start=40,
        ),
        depends_on=("elastic",),
        verified=True,
    ),
    # --------------------------------------------------------- custom roles
    DockerRole(
        "log-replay",
        build_dir="log-replay",
        environment={
            "ES_URL": "http://{peer:elastic}:9200",
            "KIBANA_URL": "http://{peer:kibana}:5601",
            "SCENARIO": "{version}",
            "DATA_DIR": "/data",
        },
        volumes=("scenario-data:/data",),
        healthcheck=_hc("test -f /tmp/labforge-ready", interval=5, retries=120, start=15),
        depends_on=("elastic", "kibana"),
        verified=True,
        note="Generates the scenario's synthetic logs and loads them into Elasticsearch/Kibana.",
    ),
    DockerRole(
        "analyst-workstation",
        build_dir="analyst-workstation",
        command=("sleep", "infinity"),
        environment={"ES_URL": "http://{peer:elastic}:9200", "KIBANA_URL": "http://{peer:kibana}:5601"},
        volumes=("scenario-data:/data:ro",),
        depends_on=("log-replay",),
        tty=True,
        verified=True,
        note="Terminal tooling (jq, ripgrep, python) with the raw logs mounted read-only at /data.",
    ),
    DockerRole(
        "malware-analysis",
        build_dir="malware-analysis",
        command=("sleep", "infinity"),
        cap_add=("SYS_PTRACE", "NET_RAW"),
        security_opt=("no-new-privileges:true",),
        isolate_network=True,
        dns_from="fakenet",
        tty=True,
        verified=True,
        note="Static and dynamic triage toolkit with benign, purpose-built samples in /samples.",
    ),
    DockerRole(
        "log4shell-target",
        build_dir="log4shell-target",
        ports=(8080,),
        verified=False,
        note=(
            "Builds a real CVE-2021-44228 target (Log4j 2.14.1 on a pre-8u191 JDK so remote JNDI "
            "class loading still works). First build compiles from source and takes a minute."
        ),
    ),
    DockerRole(
        "fakenet",
        build_dir="fakenet",
        isolate_network=True,
        healthcheck=_hc("test -f /tmp/fakenet-ready", interval=3, retries=20, start=2),
        verified=True,
        note="Fake internet: answers every DNS query with its own address and logs HTTP requests.",
    ),
)

DOCKER_ROLES: dict[str, DockerRole] = {r.role_id: r for r in _ROLES}

# Bare OS container used when a node has no role with an image. These images
# exit immediately without a long-running command, so the generator adds one.
OS_FALLBACK_IMAGE: dict[str, str] = {
    "ubuntu_2204": "ubuntu:22.04",
    "ubuntu_2404": "ubuntu:24.04",
    "debian_12": "debian:bookworm-slim",
    "alpine_latest": "alpine:3.20",
    "kali_rolling": "kalilinux/kali-rolling:latest",
}


def parse_role(role: str) -> tuple[str, str | None]:
    """Split ``name@version`` into its parts."""
    name, _, version = role.partition("@")
    return name.strip(), (version.strip() or None)


def lookup(role: str) -> tuple[DockerRole | None, str | None]:
    name, version = parse_role(role)
    return DOCKER_ROLES.get(name), version


_PLACEHOLDER = re.compile(r"\{(username|password|hostname|ip|version|peer:[a-z0-9-]+|peer_ip:[a-z0-9-]+)\}")


def render_template(value: str, values: Mapping[str, str]) -> str:
    """Substitute ``{...}`` placeholders; anything unknown is left alone."""

    def repl(match: re.Match[str]) -> str:
        key = match.group(1)
        return values.get(key, match.group(0))

    return _PLACEHOLDER.sub(repl, value)
