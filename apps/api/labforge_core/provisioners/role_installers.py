"""Per-role install snippets.

Each entry is a self-contained, idempotent shell or PowerShell block. The
generator strips ``@version`` suffixes before lookup, so e.g.
``wazuh@4.9.0`` maps to the ``wazuh`` snippet.

Snippets are inlined into the provisioner script for each node — they
assume the script already has ``set -euo pipefail`` for bash, and
``$ErrorActionPreference = 'Continue'`` for PowerShell (so a single failing
step doesn't abort the whole provisioner).

When a role has no entry here the generator emits a labelled stub comment
so the user knows where to hand-finish.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RoleSnippet:
    role_id: str
    description: str
    script: str
    platform: str  # "linux" | "windows"


# ---------------------------------------------------------------- LINUX

# Apt sanity preamble — every Linux install block should be safe to run on a
# minty Ubuntu/Debian box without a network race.
_APT_PREAMBLE = (
    "export DEBIAN_FRONTEND=noninteractive\n"
    "apt-get update -y >/dev/null 2>&1 || true\n"
)


def _bash(role_id: str, description: str, script: str) -> RoleSnippet:
    return RoleSnippet(
        role_id=role_id,
        description=description,
        platform="linux",
        script=script,
    )


def _pwsh(role_id: str, description: str, script: str) -> RoleSnippet:
    return RoleSnippet(
        role_id=role_id,
        description=description,
        platform="windows",
        script=script,
    )


LINUX_INSTALLERS: dict[str, RoleSnippet] = {
    # =========================================================== SIEM / Logs
    "wazuh": _bash(
        "wazuh",
        "Wazuh agent — auto-registers with manager via WAZUH_MANAGER env",
        _APT_PREAMBLE + r"""
apt-get install -y curl gnupg lsb-release apt-transport-https
curl -s https://packages.wazuh.com/key/GPG-KEY-WAZUH | gpg --no-default-keyring --keyring gnupg-ring:/usr/share/keyrings/wazuh.gpg --import
chmod 644 /usr/share/keyrings/wazuh.gpg
echo "deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main" > /etc/apt/sources.list.d/wazuh.list
apt-get update -y
WAZUH_MANAGER='{{ endpoints.wazuh_manager_ip | default("127.0.0.1") }}' \
  apt-get install -y wazuh-agent
systemctl daemon-reload
systemctl enable --now wazuh-agent || true
""",
    ),
    "wazuh-manager": _bash(
        "wazuh-manager",
        "Wazuh single-node manager (manager + indexer + dashboard via the official quickstart script)",
        _APT_PREAMBLE + r"""
apt-get install -y curl
curl -sO https://packages.wazuh.com/4.9/wazuh-install.sh
bash ./wazuh-install.sh -a -i || echo "[!] Wazuh installer reported non-zero; check /var/log/wazuh-install.log"
""",
    ),
    "splunk": _bash(
        "splunk",
        "Splunk Universal Forwarder",
        _APT_PREAMBLE + r"""
apt-get install -y wget
SPLUNK_DEB="/tmp/splunkforwarder.deb"
wget -qO "$SPLUNK_DEB" \
  "https://download.splunk.com/products/universalforwarder/releases/9.3.0/linux/splunkforwarder-9.3.0-51ccf43db5bd-linux-2.6-amd64.deb" || true
dpkg -i "$SPLUNK_DEB" 2>/dev/null || apt-get install -fy
/opt/splunkforwarder/bin/splunk start --accept-license --answer-yes --no-prompt --seed-passwd 'Splunk!Lab2025' || true
/opt/splunkforwarder/bin/splunk enable boot-start -user root --accept-license --answer-yes --no-prompt || true
""",
    ),
    "elastic": _bash(
        "elastic",
        "Elastic Agent (managed by Fleet, no enrollment by default)",
        _APT_PREAMBLE + r"""
apt-get install -y curl
ELASTIC_VER="8.15.0"
cd /tmp && curl -sLO "https://artifacts.elastic.co/downloads/beats/elastic-agent/elastic-agent-${ELASTIC_VER}-linux-x86_64.tar.gz"
tar -xzf "elastic-agent-${ELASTIC_VER}-linux-x86_64.tar.gz"
cd "elastic-agent-${ELASTIC_VER}-linux-x86_64"
./elastic-agent install --non-interactive || true
""",
    ),
    "kibana": _bash(
        "kibana",
        "Kibana (installed under the Elastic apt repo)",
        _APT_PREAMBLE + r"""
apt-get install -y curl gnupg apt-transport-https
curl -fsSL https://artifacts.elastic.co/GPG-KEY-elasticsearch | gpg --dearmor -o /usr/share/keyrings/elastic.gpg
echo "deb [signed-by=/usr/share/keyrings/elastic.gpg] https://artifacts.elastic.co/packages/8.x/apt stable main" > /etc/apt/sources.list.d/elastic-8.x.list
apt-get update -y
apt-get install -y kibana
systemctl enable --now kibana || true
""",
    ),
    "grafana": _bash(
        "grafana",
        "Grafana OSS",
        _APT_PREAMBLE + r"""
apt-get install -y apt-transport-https software-properties-common wget
mkdir -p /etc/apt/keyrings/
wget -qO- https://apt.grafana.com/gpg.key | gpg --dearmor -o /etc/apt/keyrings/grafana.gpg
echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" > /etc/apt/sources.list.d/grafana.list
apt-get update -y
apt-get install -y grafana
systemctl enable --now grafana-server
""",
    ),
    "prometheus": _bash(
        "prometheus",
        "Prometheus (binary + minimal config)",
        _APT_PREAMBLE + r"""
apt-get install -y prometheus
systemctl enable --now prometheus
""",
    ),

    # =================================================================== Web
    "apache": _bash(
        "apache",
        "Apache HTTPD with default site",
        _APT_PREAMBLE + "apt-get install -y apache2\nsystemctl enable --now apache2\n",
    ),
    "nginx": _bash(
        "nginx",
        "nginx with default site",
        _APT_PREAMBLE + "apt-get install -y nginx\nsystemctl enable --now nginx\n",
    ),

    # ============================================================ Databases
    "mysql": _bash(
        "mysql",
        "MySQL Server with default credentials from the topology",
        _APT_PREAMBLE + r"""
apt-get install -y mysql-server
systemctl enable --now mysql
# Password is shell-quoted via bash_q so the bash double-quoted string can
# never be broken out of. SQL quotes remain inside the -e arg; the schema
# regex separately rejects raw single quotes from the password field.
LF_PW={{ node.config.credentials.password | bash_q }}
mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '$LF_PW';" 2>/dev/null || true
unset LF_PW
""",
    ),
    "postgresql": _bash(
        "postgresql",
        "PostgreSQL with the topology's password",
        _APT_PREAMBLE + r"""
apt-get install -y postgresql
systemctl enable --now postgresql
# bash_q neutralises any shell metacharacter; SQL quotes stay so the
# password lands inside a Postgres string literal as intended.
LF_PW={{ node.config.credentials.password | bash_q }}
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD '$LF_PW';" 2>/dev/null || true
unset LF_PW
""",
    ),
    "mongodb": _bash(
        "mongodb",
        "MongoDB Community 7.0 from the official Mongo apt repo",
        _APT_PREAMBLE + r"""
apt-get install -y curl gnupg
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-7.0.list
apt-get update -y
apt-get install -y mongodb-org
systemctl enable --now mongod
""",
    ),
    "redis": _bash(
        "redis",
        "Redis server",
        _APT_PREAMBLE + "apt-get install -y redis-server\nsystemctl enable --now redis-server\n",
    ),

    # ============================================================ Containers
    "docker": _bash(
        "docker",
        "Docker Engine + buildx + compose plugin",
        _APT_PREAMBLE + r"""
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker vagrant || true
systemctl enable --now docker
""",
    ),

    # =================================================================== IDS
    "snort": _bash(
        "snort",
        "Snort 2 (community ruleset)",
        _APT_PREAMBLE + "apt-get install -y snort\nsystemctl enable --now snort || true\n",
    ),
    "suricata": _bash(
        "suricata",
        "Suricata IDS",
        _APT_PREAMBLE + "apt-get install -y suricata\nsystemctl enable --now suricata || true\n",
    ),
    "zeek": _bash(
        "zeek",
        "Zeek network analysis framework",
        _APT_PREAMBLE + r"""
echo 'deb http://download.opensuse.org/repositories/security:/zeek/xUbuntu_22.04/ /' > /etc/apt/sources.list.d/zeek.list
curl -fsSL https://download.opensuse.org/repositories/security:zeek/xUbuntu_22.04/Release.key | gpg --dearmor > /etc/apt/trusted.gpg.d/zeek.gpg
apt-get update -y && apt-get install -y zeek
""",
    ),
    "wireshark": _bash(
        "wireshark",
        "Wireshark CLI (tshark + dumpcap)",
        _APT_PREAMBLE + "DEBIAN_FRONTEND=noninteractive apt-get install -y tshark\n",
    ),

    # ================================================================= Samba
    "samba": _bash(
        "samba",
        "Samba file server (no shares pre-configured)",
        _APT_PREAMBLE + "apt-get install -y samba\nsystemctl enable --now smbd\n",
    ),

    # =================================================================== ICS
    "openplc": _bash(
        "openplc",
        "OpenPLC v3 runtime + WebUI (port 8080, user openplc:openplc)",
        _APT_PREAMBLE + r"""
apt-get install -y git build-essential automake bison flex libssl-dev cmake python3-pip
if [ ! -d /opt/openplc ]; then
  git clone --depth 1 https://github.com/thiagoralves/OpenPLC_v3.git /opt/openplc
  cd /opt/openplc && yes | ./install.sh linux >/var/log/openplc-install.log 2>&1 || true
fi
# OpenPLC's install.sh ships its own systemd unit at /lib/systemd/system/openplc.service
# with the right WorkingDirectory / pip-installed Python env. Earlier versions of this
# snippet hand-rolled a unit that pointed at the wrong CWD and restart-looped on
# missing imports; trust upstream's unit and just ensure it's enabled.
systemctl daemon-reload
systemctl enable --now openplc || true
""",
    ),
    "rapidscada": _bash(
        "rapidscada",
        "Rapid SCADA (Linux) — installed under /opt/scada, web on :10008",
        _APT_PREAMBLE + r"""
apt-get install -y wget unzip default-jre
if [ ! -d /opt/scada ]; then
  cd /tmp && wget -q https://github.com/RapidScada/scada/releases/download/v6.1.0/scada-6.1.0-linux.zip
  unzip -q scada-6.1.0-linux.zip -d /opt/ || true
  ln -sf /opt/scada-6.1.0-linux /opt/scada || true
fi
""",
    ),
    "modbus-tcp": _bash(
        "modbus-tcp",
        "pymodbus + diagslave CLI helpers for testing Modbus",
        _APT_PREAMBLE + r"""
apt-get install -y python3-pip
pip3 install --break-system-packages pymodbus 'pyserial' 2>/dev/null || pip3 install pymodbus pyserial
""",
    ),
    "mqtt": _bash(
        "mqtt",
        "Mosquitto MQTT broker on port 1883",
        _APT_PREAMBLE + "apt-get install -y mosquitto mosquitto-clients\nsystemctl enable --now mosquitto\n",
    ),

    # ================================================================ Camera
    "mediamtx": _bash(
        "mediamtx",
        "MediaMTX RTSP/RTMP/WebRTC server on :8554",
        _APT_PREAMBLE + r"""
apt-get install -y wget tar
MTX_VER="v1.9.3"
cd /tmp && wget -q "https://github.com/bluenviron/mediamtx/releases/download/${MTX_VER}/mediamtx_${MTX_VER}_linux_amd64.tar.gz"
tar -xzf mediamtx_${MTX_VER}_linux_amd64.tar.gz
install -m 0755 mediamtx /usr/local/bin/mediamtx
[ -f /etc/mediamtx.yml ] || install -m 0644 mediamtx.yml /etc/mediamtx.yml
cat > /etc/systemd/system/mediamtx.service <<'UNIT'
[Unit]
Description=MediaMTX
After=network.target
[Service]
ExecStart=/usr/local/bin/mediamtx /etc/mediamtx.yml
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now mediamtx
""",
    ),
    "motion": _bash(
        "motion",
        "Linux motion-detection CCTV daemon",
        _APT_PREAMBLE + "apt-get install -y motion\nsystemctl enable --now motion || true\n",
    ),
    "rtsp-server": _bash(
        "rtsp-server",
        "Alias — defers to MediaMTX",
        "# rtsp-server: see the mediamtx role for the actual server.\n",
    ),

    # ============================================================== AI / ML
    "ollama": _bash(
        "ollama",
        "Ollama local LLM runner (also pulls a small default model)",
        _APT_PREAMBLE + r"""
apt-get install -y curl
curl -fsSL https://ollama.com/install.sh | sh
systemctl enable --now ollama
# Pull a tiny model so the lab works without manual steps. The user can swap
# in larger models with `ollama pull llama3.1:70b` etc.
(sleep 10 && ollama pull llama3.2:3b) &
""",
    ),
    "langchain": _bash(
        "langchain",
        "LangChain + Python tooling in a venv at /opt/langchain",
        _APT_PREAMBLE + r"""
apt-get install -y python3 python3-venv python3-pip
python3 -m venv /opt/langchain
/opt/langchain/bin/pip install --upgrade pip
/opt/langchain/bin/pip install langchain langchain-community langchain-openai langchain-anthropic
""",
    ),
    "huggingface": _bash(
        "huggingface",
        "Hugging Face hub + transformers + datasets",
        _APT_PREAMBLE + r"""
apt-get install -y python3 python3-pip
pip3 install --break-system-packages huggingface_hub transformers datasets 2>/dev/null || pip3 install huggingface_hub transformers datasets
""",
    ),
    "pytorch": _bash(
        "pytorch",
        "PyTorch CPU build",
        _APT_PREAMBLE + r"""
apt-get install -y python3 python3-pip
pip3 install --break-system-packages torch --index-url https://download.pytorch.org/whl/cpu 2>/dev/null \
  || pip3 install torch --index-url https://download.pytorch.org/whl/cpu
""",
    ),
    "openai": _bash(
        "openai",
        "OpenAI Python SDK + env file scaffold",
        _APT_PREAMBLE + r"""
apt-get install -y python3 python3-pip
pip3 install --break-system-packages openai 2>/dev/null || pip3 install openai
echo "# Drop your key here: OPENAI_API_KEY=sk-..." > /etc/labforge/openai.env
""",
    ),
    "anthropic": _bash(
        "anthropic",
        "Anthropic Python SDK + env file scaffold",
        _APT_PREAMBLE + r"""
apt-get install -y python3 python3-pip
pip3 install --break-system-packages anthropic 2>/dev/null || pip3 install anthropic
mkdir -p /etc/labforge
echo "# Drop your key here: ANTHROPIC_API_KEY=sk-ant-..." > /etc/labforge/anthropic.env
""",
    ),
    "ai-jailbreak-detector": _bash(
        "ai-jailbreak-detector",
        "garak LLM red-team probe suite",
        _APT_PREAMBLE + r"""
apt-get install -y python3 python3-pip
pip3 install --break-system-packages garak 2>/dev/null || pip3 install garak
""",
    ),
    "vllm": _bash(
        "vllm",
        "vLLM inference engine",
        _APT_PREAMBLE + r"""
apt-get install -y python3 python3-pip
pip3 install --break-system-packages vllm 2>/dev/null || pip3 install vllm
""",
    ),

    # ============================================================ Offensive
    "metasploit": _bash(
        "metasploit",
        "Metasploit Framework (already on Kali; installs on plain Linux otherwise)",
        _APT_PREAMBLE + r"""
if ! command -v msfconsole >/dev/null; then
  apt-get install -y curl
  curl -sSL https://raw.githubusercontent.com/rapid7/metasploit-omnibus/master/config/templates/metasploit-framework-wrappers/msfupdate.erb > /tmp/msfinstall
  chmod +x /tmp/msfinstall && /tmp/msfinstall || true
fi
""",
    ),
    "impacket": _bash(
        "impacket",
        "Python Impacket toolkit",
        _APT_PREAMBLE + r"""
apt-get install -y python3-pip
pip3 install --break-system-packages impacket 2>/dev/null || pip3 install impacket
""",
    ),
    "bloodhound": _bash(
        "bloodhound",
        "BloodHound CE (community edition) via Docker compose",
        _APT_PREAMBLE + r"""
apt-get install -y curl ca-certificates
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
mkdir -p /opt/bloodhound && cd /opt/bloodhound
curl -fsSL https://github.com/SpecterOps/bloodhound/raw/main/examples/docker-compose/docker-compose.yml -o docker-compose.yml || true
docker compose up -d 2>/dev/null || true
""",
    ),
    "crackmapexec": _bash(
        "crackmapexec",
        "NetExec (CrackMapExec fork)",
        _APT_PREAMBLE + r"""
apt-get install -y pipx
pipx ensurepath
pipx install netexec || pipx install crackmapexec || true
""",
    ),
    "nmap": _bash(
        "nmap",
        "nmap network scanner",
        _APT_PREAMBLE + "apt-get install -y nmap\n",
    ),
    "burpsuite": _bash(
        "burpsuite",
        "Burp Suite Community (already on Kali)",
        "# burpsuite ships on Kali by default. On non-Kali use: snap install burpsuite\n",
    ),

    # ============================================================ Networking
    "iptables": _bash(
        "iptables",
        "iptables-persistent for saving NAT/forwarding rules",
        _APT_PREAMBLE + r"""
echo iptables-persistent iptables-persistent/autosave_v4 boolean true | debconf-set-selections
echo iptables-persistent iptables-persistent/autosave_v6 boolean true | debconf-set-selections
apt-get install -y iptables-persistent
""",
    ),
    "frr": _bash(
        "frr",
        "FRRouting (OSPF, BGP, RIP, IS-IS)",
        _APT_PREAMBLE + "apt-get install -y frr\nsystemctl enable --now frr || true\n",
    ),
    "openwrt": _bash(
        "openwrt",
        "Simulated router: enable IP forwarding + dnsmasq",
        _APT_PREAMBLE + r"""
apt-get install -y dnsmasq iptables-persistent
sysctl -w net.ipv4.ip_forward=1
grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
systemctl enable --now dnsmasq || true
""",
    ),
    "pfsense": _bash(
        "pfsense",
        "pfSense stand-in: nftables + dnsmasq (real pfSense has no Vagrant box)",
        _APT_PREAMBLE + r"""
apt-get install -y nftables dnsmasq iptables-persistent
sysctl -w net.ipv4.ip_forward=1
grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
systemctl enable --now nftables || true
""",
    ),
    "opnsense": _bash(
        "opnsense",
        "OPNsense stand-in: nftables + dnsmasq",
        _APT_PREAMBLE + r"""
apt-get install -y nftables dnsmasq iptables-persistent
sysctl -w net.ipv4.ip_forward=1
grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
systemctl enable --now nftables || true
""",
    ),

    # ============================================================ Auth / IAM
    "keycloak": _bash(
        "keycloak",
        "Keycloak via the official quickstart Docker compose",
        _APT_PREAMBLE + r"""
apt-get install -y openjdk-17-jre-headless curl
KC_VER="25.0.4"
cd /opt && curl -sLO "https://github.com/keycloak/keycloak/releases/download/${KC_VER}/keycloak-${KC_VER}.zip"
apt-get install -y unzip
unzip -q "keycloak-${KC_VER}.zip" || true
ln -sf "/opt/keycloak-${KC_VER}" /opt/keycloak
""",
    ),
    "vault": _bash(
        "vault",
        "HashiCorp Vault (single-node dev mode)",
        _APT_PREAMBLE + r"""
apt-get install -y gpg
wget -qO- https://apt.releases.hashicorp.com/gpg | gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" > /etc/apt/sources.list.d/hashicorp.list
apt-get update -y && apt-get install -y vault
""",
    ),

    # ===================================================== ICS vendor labels
    # These are mostly *documentation* roles — actual vendor firmware can't
    # be auto-installed. The OpenPLC role above does the heavy lifting.
    "siemens-simatic": _bash(
        "siemens-simatic",
        "Marker — actual SIMATIC firmware can't be auto-provisioned (use OpenPLC).",
        '# siemens-simatic: see role "openplc" for an open-source S7 stand-in.\n',
    ),
    "schneider-modicon": _bash(
        "schneider-modicon",
        "Marker — use OpenPLC for the Modicon stand-in.",
        '# schneider-modicon: see role "openplc" for the simulator.\n',
    ),
    "rockwell-allenbradley": _bash(
        "rockwell-allenbradley",
        "Marker — use OpenPLC for a generic AB-style stand-in.",
        '# rockwell-allenbradley: see role "openplc" for the simulator.\n',
    ),

    # ============================================================== Markers
    "external": _bash("external", "Marker for external/internet node", "# external: nothing to install.\n"),
    "domain-joined": _bash(
        "domain-joined",
        "Marker — domain join is done in the Windows provisioner.",
        '# domain-joined: only meaningful on Windows; see provision_windows.ps1.j2.\n',
    ),
    "AD-Domain-Services": _bash(
        "AD-Domain-Services",
        "Marker — handled by the Windows DC provisioner.",
        '# AD-Domain-Services: handled in the Windows provisioner for the DC node.\n',
    ),
    "DNS": _bash(
        "DNS",
        "Bind9 caching DNS resolver",
        _APT_PREAMBLE + "apt-get install -y bind9\nsystemctl enable --now named\n",
    ),
}


# ---------------------------------------------------------------- WINDOWS

WINDOWS_INSTALLERS: dict[str, RoleSnippet] = {
    "sysmon": _pwsh(
        "sysmon",
        "Sysmon with the SwiftOnSecurity config",
        r"""
$tools = "C:\Tools\Sysmon"
if (-not (Test-Path "$tools\Sysmon64.exe")) {
    New-Item -ItemType Directory -Path $tools -Force | Out-Null
    Invoke-WebRequest -Uri "https://download.sysinternals.com/files/Sysmon.zip" -OutFile "$env:TEMP\Sysmon.zip"
    Expand-Archive -Path "$env:TEMP\Sysmon.zip" -DestinationPath $tools -Force
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/SwiftOnSecurity/sysmon-config/master/sysmonconfig-export.xml" -OutFile "$tools\config.xml"
    & "$tools\Sysmon64.exe" -accepteula -i "$tools\config.xml"
}
""",
    ),
    "winlogbeat": _pwsh(
        "winlogbeat",
        "Winlogbeat (Elastic) installed under C:\\Program Files\\Winlogbeat",
        r"""
$dest = "C:\Program Files"
if (-not (Test-Path "$dest\Winlogbeat")) {
    Invoke-WebRequest -Uri "https://artifacts.elastic.co/downloads/beats/winlogbeat/winlogbeat-8.15.0-windows-x86_64.zip" -OutFile "$env:TEMP\winlogbeat.zip"
    Expand-Archive -Path "$env:TEMP\winlogbeat.zip" -DestinationPath $dest -Force
    Rename-Item -Path "$dest\winlogbeat-8.15.0-windows-x86_64" -NewName "Winlogbeat" -ErrorAction SilentlyContinue
}
""",
    ),
    "powershell-transcripts": _pwsh(
        "powershell-transcripts",
        "Force PowerShell transcript logging to C:\\PSLogs",
        r"""
$tx = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\Transcription"
New-Item -Path $tx -Force | Out-Null
Set-ItemProperty -Path $tx -Name EnableTranscripting -Value 1
Set-ItemProperty -Path $tx -Name OutputDirectory -Value "C:\PSLogs"
New-Item -Path "C:\PSLogs" -ItemType Directory -Force | Out-Null
""",
    ),
    "splunk": _pwsh(
        "splunk",
        "Splunk Universal Forwarder (Windows)",
        r"""
$msi = "$env:TEMP\splunkforwarder.msi"
if (-not (Test-Path "C:\Program Files\SplunkUniversalForwarder")) {
    Invoke-WebRequest -Uri "https://download.splunk.com/products/universalforwarder/releases/9.3.0/windows/splunkforwarder-9.3.0-51ccf43db5bd-x64-release.msi" -OutFile $msi
    Start-Process msiexec.exe -Wait -ArgumentList "/i $msi AGREETOLICENSE=Yes /quiet"
}
""",
    ),
    "wazuh": _pwsh(
        "wazuh",
        "Wazuh agent (Windows)",
        r"""
$msi = "$env:TEMP\wazuh-agent.msi"
if (-not (Get-Service -Name WazuhSvc -ErrorAction SilentlyContinue)) {
    Invoke-WebRequest -Uri "https://packages.wazuh.com/4.x/windows/wazuh-agent-4.9.0-1.msi" -OutFile $msi
    $managerIp = {{ endpoints.wazuh_manager_ip | default('127.0.0.1') | ps_q }}
    Start-Process msiexec.exe -Wait -ArgumentList "/i $msi /q WAZUH_MANAGER=`"$managerIp`""
    Start-Service WazuhSvc
}
""",
    ),
    "rapidscada": _pwsh(
        "rapidscada",
        "Rapid SCADA (Windows installer)",
        r"""
$zip = "$env:TEMP\rapidscada.zip"
if (-not (Test-Path "C:\SCADA")) {
    Invoke-WebRequest -Uri "https://github.com/RapidScada/scada/releases/download/v6.1.0/scada-6.1.0-windows.zip" -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath "C:\" -Force
}
""",
    ),
    "modbus-master": _pwsh(
        "modbus-master",
        "pymodbus on Windows (requires Python; installs via Chocolatey if absent)",
        r"""
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
        Set-ExecutionPolicy Bypass -Scope Process -Force
        iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    }
    choco install -y python311
}
python -m pip install pymodbus
""",
    ),
    "rdp": _pwsh(
        "rdp",
        "Enable Remote Desktop + firewall rule",
        r"""
Set-ItemProperty -Path "HKLM:\System\CurrentControlSet\Control\Terminal Server" -Name "fDenyTSConnections" -Value 0
Enable-NetFirewallRule -DisplayGroup "Remote Desktop"
""",
    ),
    "office": _pwsh(
        "office",
        "Marker — Office isn't auto-installable due to licensing",
        '# office: install manually if needed.' + "\n",
    ),
    "domain-joined": _pwsh(
        "domain-joined",
        "Marker — actual domain join is the DC's job",
        '# domain-joined: run `Add-Computer -DomainName labforge.local -Restart` after the DC is up.' + "\n",
    ),
    "AD-Domain-Services": _pwsh(
        "AD-Domain-Services",
        "AD DS + DNS + first-forest promotion",
        r"""
$features = Get-WindowsFeature AD-Domain-Services, DNS
if (-not ($features | Where-Object Installed)) {
    Install-WindowsFeature AD-Domain-Services, DNS -IncludeManagementTools
}
$existing = (Get-CimInstance Win32_ComputerSystem).Domain
if ($existing -ne "labforge.local") {
    $dsrm = ConvertTo-SecureString {{ node.config.credentials.password | ps_q }} -AsPlainText -Force
    Import-Module ADDSDeployment
    Install-ADDSForest `
        -DomainName "labforge.local" `
        -DomainNetbiosName "LABFORGE" `
        -InstallDns `
        -SafeModeAdministratorPassword $dsrm `
        -Force `
        -NoRebootOnCompletion
}
""",
    ),
    "DNS": _pwsh(
        "DNS",
        "Marker (DNS comes with AD-Domain-Services)",
        '# DNS: bundled with AD DS install.' + "\n",
    ),
}


def linux_snippet(role_id: str) -> RoleSnippet | None:
    return LINUX_INSTALLERS.get(role_id)


def windows_snippet(role_id: str) -> RoleSnippet | None:
    return WINDOWS_INSTALLERS.get(role_id)


__all__ = [
    "RoleSnippet",
    "LINUX_INSTALLERS",
    "WINDOWS_INSTALLERS",
    "linux_snippet",
    "windows_snippet",
]
