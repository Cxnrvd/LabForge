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

import base64
from dataclasses import dataclass
from pathlib import Path

# Kernel-6.1 port of the AltoBeam out-of-tree driver (gtxaspec/atbm-wifi, pinned
# commit below). Shipped as a patch and embedded base64 so the provisioner needs
# nothing from the LabForge host but the internet to clone the upstream tree.
_ATBM_PATCH_B64 = base64.b64encode(
    (Path(__file__).parent / "assets" / "atbm-kernel-6.1.patch").read_bytes()
).decode("ascii")
_ATBM_COMMIT = "380838e871c793ff4feb19bd584d9508b162b835"


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
# Wazuh's apt repo only ever serves one rolling "4.x" feed (there is no
# per-branch apt repo the way there's a per-branch install-script
# tarball), and it hard-rejects enrollment from any agent newer than its
# manager ("Agent version must be lower or equal to manager version").
# The wazuh-manager role below pins the manager itself to 4.9 via
# packages.wazuh.com/4.9/wazuh-install.sh, so pin the agent package to
# the matching 4.9.2-1 build out of that same rolling repo — confirmed in
# the wild: without this, apt installs whatever's newest (4.14.8 as of
# this writing) and the agent can never enroll against a 4.9.x manager.
WAZUH_MANAGER='{{ endpoints.wazuh_manager_ip | default("127.0.0.1") }}' \
  apt-get install -y wazuh-agent=4.9.2-1

# The default agent config watches classic log FILES (/var/log/syslog,
# /var/log/auth.log, ...) — on a minimal cloud box without rsyslog
# installed, those files may never exist, and anything that only logs via
# the systemd journal (hostapd's `logger_syslog`, sshd's auth events, PAM,
# useradd) is then invisible to Wazuh no matter what rules exist on the
# manager. journald ingestion sidesteps that entirely: it reads the
# journal directly, works with or without rsyslog, and is what actually
# makes the hostapd-specific rules on the manager (and the default
# SSH/PAM/user-management rules Wazuh already ships) see anything at all
# on a box like this. Broad on purpose — unmatched events just sit in the
# index without becoming a visible alert, so this doesn't flood the
# dashboard, it just stops silently dropping everything that isn't a
# classic log file.
#
# The extra syscheck directories are the other half of the same gap for
# the "post-compromise on a WiFi-compromised box" story this lab's docs
# walk through (new SSH keys, new local accounts, log tampering): Wazuh's
# own default FIM coverage on Debian doesn't include /root/.ssh or /home
# by default. realtime=yes is deliberate — the default syscheck scan
# interval is 12 hours, useless for a live demo where the whole point is
# seeing the alert land within seconds of the attacker's command.
CONF=/var/ossec/etc/ossec.conf
if [ -f "$CONF" ] && ! grep -q "log_format>journald" "$CONF"; then
  sed -i '0,/<\/ossec_config>/{s|</ossec_config>|  <localfile>\n    <log_format>journald</log_format>\n    <location>journald</location>\n  </localfile>\n  <syscheck>\n    <directories realtime="yes" report_changes="yes">/root/.ssh,/home</directories>\n    <directories realtime="yes" report_changes="yes">/etc/passwd,/etc/shadow,/etc/ssh,/etc/rsyslog.conf</directories>\n  </syscheck>\n</ossec_config>|}' "$CONF"
fi
systemctl daemon-reload || true
systemctl enable --now wazuh-agent || true
systemctl restart wazuh-agent || true
""",
    ),
    "wazuh-manager": _bash(
        "wazuh-manager",
        "Wazuh single-node manager (manager + indexer + dashboard via the official quickstart script)",
        _APT_PREAMBLE + r"""
apt-get install -y curl
curl -sO https://packages.wazuh.com/4.9/wazuh-install.sh
bash ./wazuh-install.sh -a -i || echo "[!] Wazuh installer reported non-zero; check /var/log/wazuh-install.log"

# The installer generates a random dashboard admin password and only ever
# writes it to wazuh-install-files.tar on this VM — nothing surfaces it
# anywhere a user would see it, so logging in means SSHing in and
# extracting a tarball by hand. Pull it out and print it to the
# provisioning log for visibility, but ALSO drop it in a fixed, well-known
# file: build.log is a one-time, append-only transcript of whatever
# `vagrant up` ran — a VM that's already provisioned skips this whole
# script on every later `up`/resume (Vagrant only re-runs one-time
# provisioners on the VM's very first boot), so if this line scrolled by
# before anyone looked, or the log file itself got rotated/truncated, the
# password is gone for good. The file below is re-readable on demand any
# time the VM is up, by the API's own wazuh-password endpoint — it does
# not depend on log retention at all.
if [ -f /root/wazuh-install-files.tar ] || [ -f ./wazuh-install-files.tar ]; then
  TARFILE=$(ls /root/wazuh-install-files.tar ./wazuh-install-files.tar 2>/dev/null | head -1)
  ADMIN_PASS=$(tar -xzOf "$TARFILE" wazuh-install-files/wazuh-passwords.txt 2>/dev/null \
    | grep -A1 "indexer_username: 'admin'" | grep indexer_password \
    | sed "s/.*: '\\(.*\\)'/\\1/")
  if [ -n "$ADMIN_PASS" ]; then
    echo "[labforge] Wazuh dashboard login: admin / $ADMIN_PASS"
    printf '%s\n' "$ADMIN_PASS" > /var/log/labforge-wazuh-password
    chmod 600 /var/log/labforge-wazuh-password
  else
    echo "[labforge] WARNING: could not extract the Wazuh dashboard admin password from $TARFILE"
  fi
fi

# Out of the box the installer gives you a SIEM with nothing taught to
# recognize this lab's own traffic — hostapd's association/deauth/
# handshake/WPS events would just sit in the index as unclassified
# journald noise, never becoming an alert, which defeats the entire point
# of "run an attack, see it on the dashboard." local_decoder.xml /
# local_rules.xml are Wazuh's own designated override files (never
# touched by upgrades) for exactly this. Rule IDs are in the 100100+
# range, which is the user-reserved block Wazuh's own docs set aside so
# these can never collide with a shipped rule. Exact hostapd log wording
# is standard across versions but was written from documentation, not a
# live capture — if an event type doesn't fire, check `journalctl -u
# hostapd` on ap-target against the <prematch> below and adjust.
mkdir -p /var/ossec/etc/decoders /var/ossec/etc/rules
cat > /var/ossec/etc/decoders/local_decoder.xml <<'EOF'
<decoder name="hostapd">
  <program_name>^hostapd</program_name>
</decoder>

<decoder name="hostapd-assoc">
  <parent>hostapd</parent>
  <prematch>IEEE 802.11: associated</prematch>
  <regex>STA (\S+) IEEE 802.11: associated</regex>
  <order>srcmac</order>
</decoder>

<decoder name="hostapd-disassoc">
  <parent>hostapd</parent>
  <prematch>IEEE 802.11: disassociated</prematch>
  <regex>STA (\S+) IEEE 802.11: disassociated</regex>
  <order>srcmac</order>
</decoder>

<decoder name="hostapd-deauth">
  <parent>hostapd</parent>
  <prematch>MLME-DEAUTHENTICATE|Deauthentication frame</prematch>
  <regex offset="after_prematch">STA (\S+)</regex>
  <order>srcmac</order>
</decoder>

<decoder name="hostapd-handshake">
  <parent>hostapd</parent>
  <prematch>pairwise key handshake completed</prematch>
  <regex>STA (\S+) WPA: pairwise key handshake completed</regex>
  <order>srcmac</order>
</decoder>

<decoder name="hostapd-wps">
  <parent>hostapd</parent>
  <prematch>WPS-PBC-ACTIVE|WPS-SUCCESS|WPS-FAIL|WPS-TIMEOUT</prematch>
</decoder>
EOF

cat > /var/ossec/etc/rules/local_rules.xml <<'EOF'
<group name="labforge_wifi,">
  <rule id="100100" level="3">
    <decoded_as>hostapd</decoded_as>
    <description>LabForge WiFi Lab: hostapd event on the target AP</description>
  </rule>

  <rule id="100101" level="5">
    <if_sid>100100</if_sid>
    <decoded_as>hostapd-assoc</decoded_as>
    <description>LabForge WiFi Lab: client $(srcmac) associated to the AP</description>
    <mitre>
      <id>T1200</id>
    </mitre>
  </rule>

  <rule id="100102" level="7">
    <if_sid>100100</if_sid>
    <decoded_as>hostapd-deauth</decoded_as>
    <description>LabForge WiFi Lab: deauthentication frame against $(srcmac) — a single frame can be a normal disconnect; watch rule 100103 for the repeated pattern that means an active attack</description>
    <mitre>
      <id>T1498</id>
    </mitre>
  </rule>

  <rule id="100103" level="10" frequency="6" timeframe="20">
    <if_matched_sid>100102</if_matched_sid>
    <description>LabForge WiFi Lab: repeated deauthentication frames in a short window — active deauth DoS / forced-reassociation attack against the AP. Mitigation: enable 802.11w (Management Frame Protection) and move off WPA2-only so deauth/disassoc frames can no longer be spoofed unauthenticated.</description>
    <mitre>
      <id>T1498</id>
    </mitre>
  </rule>

  <rule id="100104" level="6">
    <if_sid>100100</if_sid>
    <decoded_as>hostapd-handshake</decoded_as>
    <description>LabForge WiFi Lab: WPA/WPA2 4-way handshake completed for $(srcmac) — handshake traffic captured during this exchange is crackable offline against the real passphrase strength, not this alert itself</description>
    <mitre>
      <id>T1110.002</id>
    </mitre>
  </rule>

  <rule id="100105" level="8">
    <if_sid>100100</if_sid>
    <decoded_as>hostapd-wps</decoded_as>
    <description>LabForge WiFi Lab: WPS negotiation activity observed on the AP — WPS should be disabled entirely on any network handling sensitive traffic, PIN-based or push-button</description>
    <mitre>
      <id>T1110.001</id>
    </mitre>
  </rule>
</group>
EOF
systemctl restart wazuh-manager || echo "[!] wazuh-manager restart failed — check: /var/ossec/logs/ossec.log"
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
    # Camera brand tags (smart-factory). These exist so NVD search on the node (useRoleCves on the
    # frontend) matches real vendor advisories, same as the PLC vendor tags above; mediatx is the
    # role that actually runs a stream. There is no installable "camera firmware" package.
    "hikvision": _bash("hikvision", "Vendor tag for CVE lookup, not an installer", "# hikvision: vendor tag only, nothing to install here.\n"),
    "dahua": _bash("dahua", "Vendor tag for CVE lookup, not an installer", "# dahua: vendor tag only, nothing to install here.\n"),
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
    # This role itself only ever installed wireless diagnostics (driver
    # stack, iw/wireless-tools, usbutils to confirm the device enumerated,
    # rfkill in case the guest boots soft-blocked) — never a dedicated
    # attack-tool install step. That was fine when this ran on top of a
    # bento/ubuntu base, where the attack toolchain (aircrack-ng, wifite,
    # hcxtools, hashcat, Reaver, Wireshark, Metasploit, ...) genuinely wasn't
    # present. KALI_ROLLING nodes now boot the real kalilinux/rolling box
    # (see generator.BOX_MAP), which ships all of that out of the box, so
    # this role's diagnostics-only installs remain correct as a backstop —
    # there's just nothing left for the user to separately install first.
    "wifi-pentest-env": _bash(
        "wifi-pentest-env",
        "Wireless diagnostics (iw, usbutils, rfkill) for a passed-through USB "
        "adapter — on a real kalilinux/rolling node, the attack toolchain is "
        "already part of the box image, not installed by this role.",
        _APT_PREAMBLE + (
            "apt-get install -y iw wireless-tools usbutils rfkill "
            "linux-firmware >/dev/null 2>&1 || true\n"
            "rfkill unblock all || true\n"
            "echo '--- USB devices visible to this VM ---'\n"
            "lsusb || true\n"
            "echo '--- Wireless interfaces visible to this VM ---'\n"
            "iw dev || echo 'No wireless interface detected yet — check the "
            "USB passthrough filter matches your adapter (see README).'\n"
        ),
    ),
    # Driver for the AltoBeam ATBM6012B-X USB dongle (007a:888b) so the hostapd
    # role below has a real nl80211 radio. Only works when the hypervisor can
    # hand the dongle to the guest (VMware yes, VirtualBox no — see
    # docs/labs/altobeam). The Vagrantfile upgrades the kernel and reboots
    # before this runs (headers for the box's stale kernel are gone from the
    # archive), so `uname -r` here already has matching headers. Key build
    # facts: CONFIG_ATBM_BLE + CONFIG_ATBM_BLE_WIFI_PLATFORM select the
    # WiFi+BLE combo firmware this chip needs, and wifi_bt_comb=1 enables it
    # at load time; without both the chip never finishes its startup
    # handshake.
    "atbm-wifi-driver": _bash(
        "atbm-wifi-driver",
        "AltoBeam ATBM6012B-X (007a:888b) nl80211 driver, built for kernel 6.1",
        _APT_PREAMBLE + (
            "apt-get install -y -qq usbutils iw build-essential git bc kmod "
            "\"linux-headers-$(uname -r)\"\n"
            "if ! lsusb 2>/dev/null | grep -qi '007a:888b'; then\n"
            "  echo '[atbm-wifi-driver] no AltoBeam 007a:888b adapter visible to this VM — "
            "pass it through (VMware) and run: vagrant provision ' \n"
            "else\n"
            "  KVER=$(uname -r)\n"
            "  SRC=/usr/src/atbm-wifi\n"
            "  if [ ! -f \"/lib/modules/$KVER/extra/atbm6012bx.ko\" ]; then\n"
            "    echo \"[atbm-wifi-driver] building AltoBeam driver for kernel $KVER\"\n"
            "    rm -rf \"$SRC\"\n"
            "    git clone -q https://github.com/gtxaspec/atbm-wifi \"$SRC\"\n"
            f"    git -C \"$SRC\" checkout -q {_ATBM_COMMIT}\n"
            f"    echo '{_ATBM_PATCH_B64}' | base64 -d > /tmp/atbm-kernel-6.1.patch\n"
            "    git -C \"$SRC\" apply /tmp/atbm-kernel-6.1.patch\n"
            "    cp \"$SRC/configs/atbm6012bx.config\" \"$SRC/.config\"\n"
            "    sed -i 's/^# CONFIG_ATBM_BLE is not set/CONFIG_ATBM_BLE=y\\n"
            "CONFIG_ATBM_BLE_WIFI_PLATFORM=y/' \"$SRC/.config\"\n"
            "    grep -q '^CONFIG_ATBM_BLE_WIFI_PLATFORM=y' \"$SRC/.config\"\n"
            # The top Makefile includes $(PWD)/.config before it defines PWD, so
            # PWD must be passed in or the module name comes out empty.
            "    (cd \"$SRC\" && make modules PWD=\"$SRC\" KDIR=\"/lib/modules/$KVER/build\" "
            ">/var/log/atbm-build.log 2>&1) || { tail -30 /var/log/atbm-build.log; exit 1; }\n"
            "    install -D -m644 \"$SRC/hal_apollo/atbm6012bx.ko\" "
            "\"/lib/modules/$KVER/extra/atbm6012bx.ko\"\n"
            "    depmod -a\n"
            "  fi\n"
            # The driver opens its firmware by absolute path, and request_firmware
            # prepends /lib/firmware — hence the nested copy.
            "  mkdir -p /lib/firmware/lib/firmware\n"
            "  cp \"$SRC/firmware/firmware_usb_wifi_bt_comb.bin\" /lib/firmware/atbm6012bx_fw.bin\n"
            "  cp \"$SRC/firmware/firmware_usb_wifi_bt_comb.bin\" /lib/firmware/lib/firmware/atbm6012bx_fw.bin\n"
            "  echo 'options atbm6012bx wifi_bt_comb=1' > /etc/modprobe.d/atbm.conf\n"
            "  echo atbm6012bx > /etc/modules-load.d/atbm.conf\n"
            "  modprobe cfg80211 || true\n"
            "  lsmod | grep -q '^atbm6012bx' || modprobe atbm6012bx\n"
            "  for i in $(seq 1 40); do\n"
            "    [ -n \"$(ls /sys/class/net | grep -E '^wlan')\" ] && break\n"
            "    sleep 1\n"
            "  done\n"
            "  iw dev || echo '[atbm-wifi-driver] driver loaded but no wireless interface appeared — "
            "check dmesg | grep atbm_log'\n"
            # After later reboots hostapd can start before the dongle has
            # enumerated and the firmware has loaded; wait for wlan0 and re-add
            # the AP address the hostapd role assigns.
            "  mkdir -p /etc/systemd/system/hostapd.service.d\n"
            "  cat > /etc/systemd/system/hostapd.service.d/labforge-atbm.conf <<'EOF'\n"
            "[Service]\n"
            "ExecStartPre=/bin/sh -c 'for i in $(seq 1 60); do [ -e /sys/class/net/wlan0 ] && exit 0; sleep 1; done; exit 0'\n"
            "ExecStartPost=-/bin/sh -c 'ip addr add 10.50.50.1/24 dev wlan0'\n"
            "Restart=on-failure\n"
            "RestartSec=5\n"
            "EOF\n"
            # Scenario switching restarts hostapd back to back; systemd's default
            # 5-starts-in-10s limit would then refuse the sixth ("start-limit-hit").
            "  printf '[Unit]\\nStartLimitIntervalSec=0\\n' > "
            "/etc/systemd/system/hostapd.service.d/labforge-ratelimit.conf\n"
            "  systemctl daemon-reload || true\n"
            "fi\n"
        ),
    ),
    # Turns a passed-through USB wireless adapter into a real access point.
    # Ships a safe default (open SSID, 2.4GHz) so the node boots to something
    # working; the point of this role is that you then edit
    # /etc/hostapd/hostapd.conf yourself to switch between WEP/WPA2/WPA3/WPS
    # for each demo segment and `systemctl restart hostapd`. Logs
    # association/deauth/EAPOL activity to syslog so a wazuh/elastic agent
    # on this same node can ship it upstream — that's the whole point of
    # pairing this role with a SIEM role in the same lab.
    "hostapd": _bash(
        "hostapd",
        "hostapd + dnsmasq turning a passed-through USB adapter into a real AP",
        _APT_PREAMBLE + (
            # usbutils (for lsusb) is NOT in bento/debian-12's base image —
            # verified on a real box. Without it, the Realtek detection
            # below (`lsusb | grep ...`) silently finds nothing (command not
            # found on stderr, grep never matches) and skips straight past
            # the DKMS rebuild this exact chipset needs, with no indication
            # anything was skipped — the user just lands on "no wireless
            # interface found" with none of the guidance that branch exists
            # to give. iw/wireless-tools/rfkill were already being
            # installed; usbutils was the missing one.
            "apt-get install -y hostapd dnsmasq iw wireless-tools rfkill usbutils\n"
            "rfkill unblock all || true\n"
            "systemctl unmask hostapd || true\n"
            "systemctl stop dnsmasq || true\n"
            # Known-bad driver workaround: cheap USB dongles using the Realtek
            # RTL8188EU chipset (USB ID 0bda:0179) ship with Debian's bundled
            # "r8188eu" module, which only exposes legacy Wireless Extensions
            # — modern hostapd requires nl80211, so this chip silently can't
            # run an AP under the stock driver. Swap in the actively
            # maintained aircrack-ng community fork, which supports AP mode
            # over nl80211. Building it needs a kernel/headers upgrade (the
            # box's shipped kernel is usually older than what's in the current
            # apt archive, which only keeps headers for recent point
            # releases), so this builds the module for whichever kernel ends
            # up installed rather than rebooting mid-provision — an
            # uncoordinated reboot here would drop vagrant's SSH session and
            # read as a failed build even though the fix worked. Idempotent:
            # skips straight through once the driver is already built for the
            # currently-installed kernel.\n"
            "if lsusb 2>/dev/null | grep -qi '0bda:0179'; then\n"
            "  apt-get install -y -qq linux-image-amd64 linux-headers-amd64 "
            "build-essential dkms git bc >/dev/null 2>&1 || true\n"
            "  TARGET_KERNEL=$(ls /lib/modules 2>/dev/null | sort -V | tail -1)\n"
            "  if [ -n \"$TARGET_KERNEL\" ] && [ -d \"/lib/modules/$TARGET_KERNEL/build\" ]; then\n"
            "    if ! dkms status 2>/dev/null | grep -q \"8188eu/5.3.9, $TARGET_KERNEL,.*installed\"; then\n"
            "      echo \"[hostapd role] Realtek RTL8188EU (0bda:0179) detected — "
            "the stock driver only supports legacy Wireless Extensions, which "
            "hostapd can't use. Building the aircrack-ng nl80211 driver for "
            "kernel $TARGET_KERNEL...\"\n"
            "      echo 'blacklist r8188eu' > /etc/modprobe.d/blacklist-r8188eu.conf\n"
            "      [ -d /usr/src/rtl8188eus ] || git clone -q "
            "https://github.com/aircrack-ng/rtl8188eus.git /usr/src/rtl8188eus\n"
            # dkms-install.sh registers the module (dkms add) then builds for
            # whatever `uname -r` is RIGHT NOW — not $TARGET_KERNEL. Verified
            # on real hardware: right after installing a new kernel package,
            # the box is still running the OLD one until a reboot, so that
            # implicit build fails ("kernel headers ... cannot be found")
            # for the running kernel, which never got its own headers
            # installed (only the new target kernel's did). The explicit
            # `dkms install -k $TARGET_KERNEL` below is what actually builds
            # against the headers this script just installed; it's the one
            # that matters, and runs regardless of whether the implicit one
            # above failed.\n"
            "      (cd /usr/src/rtl8188eus && bash dkms-install.sh) || true\n"
            "      dkms install -m 8188eu -v 5.3.9 -k \"$TARGET_KERNEL\" --force "
            "2>/dev/null || true\n"
            "    fi\n"
            "    if dkms status 2>/dev/null | grep -q \"8188eu/5.3.9, $TARGET_KERNEL,.*installed\"; then\n"
            "      if [ \"$(uname -r)\" != \"$TARGET_KERNEL\" ]; then\n"
            "        echo \"[hostapd role] Driver ready for kernel $TARGET_KERNEL "
            "(this VM is still running $(uname -r)). Reboot this VM once — "
            "vagrant reload <hostname>, or Halt then Start from the dashboard "
            "— then run: vagrant provision <hostname>. hostapd will then use "
            "the adapter correctly.\"\n"
            "      else\n"
            "        modprobe 8188eu 2>/dev/null || true\n"
            "      fi\n"
            "    else\n"
            "      echo '[hostapd role] Driver build for the Realtek adapter "
            "did not finish — check /var/lib/dkms/8188eu/5.3.9/build/make.log "
            "on this VM. Continuing with whatever driver is already loaded.'\n"
            "    fi\n"
            "  fi\n"
            "fi\n"
            # `iw dev` itself can fail outright, not just succeed with an
            # empty list — nl80211 can be genuinely unavailable (no
            # wireless kernel support at all, as in a plain container,
            # which is exactly how this line's own test caught it). Under
            # this script's `set -e -o pipefail`, an unguarded failure here
            # would abort the whole role before ever reaching the graceful
            # "no interface" message below — `|| true` is what makes that
            # message actually reachable instead of a silent abort.\n"
            "IFACE=$(iw dev 2>/dev/null | awk '$1==\"Interface\"{print $2; exit}') || true\n"
            "if [ -z \"$IFACE\" ]; then\n"
            "  echo 'No wireless interface found yet — pass the USB adapter through "
            "(see README) then re-run: systemctl restart hostapd dnsmasq' \n"
            "  exit 0\n"
            "fi\n"
            # A second AP-mode virtual interface on the same radio, for the
            # OWE-transition scenario — real OWE (unlike SAE's transition
            # mode) needs two separate BSSIDs, one Open and one OWE, pointing
            # at each other. Whether a chipset's driver can run two AP VIFs
            # concurrently varies (check `iw list` → "valid interface
            # combinations"); this is best-effort and logged either way, not
            # assumed. hostapd itself stays single-BSS unless the
            # owe-transition scenario is selected, so this sits idle and
            # harmless the rest of the time.\n"
            "SECOND_IFACE=\"${IFACE}1\"\n"
            "if ! iw dev | grep -q \"$SECOND_IFACE\"; then\n"
            "  iw dev \"$IFACE\" interface add \"$SECOND_IFACE\" type __ap 2>/dev/null && "
            "ip link set \"$SECOND_IFACE\" up 2>/dev/null || true\n"
            "fi\n"
            "if iw dev | grep -q \"$SECOND_IFACE\"; then\n"
            "  echo \"[hostapd role] second AP-mode interface $SECOND_IFACE is up — the "
            "OWE-transition scenario is available\"\n"
            "else\n"
            "  echo '[hostapd role] this adapter/driver only brings up one AP-mode "
            "interface at a time — the OWE-transition scenario will fail with a clear "
            "hostapd error if selected (single-BSS hardware limitation, not a lab bug)'\n"
            "fi\n"
            "cat > /etc/hostapd/hostapd.conf <<EOF\n"
            "interface=$IFACE\n"
            "driver=nl80211\n"
            "ssid=LabForge-Demo-AP\n"
            "hw_mode=g\n"
            "channel=6\n"
            "wpa=2\n"
            "wpa_passphrase=LabForgeDemo123\n"
            "wpa_key_mgmt=WPA-PSK\n"
            "rsn_pairwise=CCMP\n"
            "logger_syslog=-1\n"
            "logger_syslog_level=2\n"
            "EOF\n"
            "sed -i 's|#DAEMON_CONF.*|DAEMON_CONF=\"/etc/hostapd/hostapd.conf\"|' "
            "/etc/default/hostapd || true\n"
            "cat > /etc/dnsmasq.conf <<EOF\n"
            "interface=$IFACE\n"
            "dhcp-range=10.50.50.10,10.50.50.100,12h\n"
            "EOF\n"
            "ip addr add 10.50.50.1/24 dev \"$IFACE\" 2>/dev/null || true\n"
            "systemctl enable --now hostapd || echo '[!] hostapd failed to start — "
            "check journalctl -u hostapd, a common cause is the adapter not "
            "supporting AP mode (iw list | grep -A5 \"Supported interface modes\")'\n"
            "systemctl enable --now dnsmasq || true\n"
            # Rolling capture so a demo segment's traffic (deauth, EAPOL,
            # association) can be downloaded and reviewed afterward, not just
            # watched scroll by in the log. One continuous capture file is
            # simpler and more honest than per-segment files that need
            # the presenter to remember to restart them between segments.
            "apt-get install -y -qq tcpdump >/dev/null 2>&1 || true\n"
            "mkdir -p /var/log/labforge\n"
            "cat > /etc/systemd/system/labforge-wifi-capture.service <<EOF\n"
            "[Unit]\n"
            "Description=LabForge rolling capture of the hostapd interface\n"
            "After=hostapd.service\n"
            "[Service]\n"
            "ExecStart=/usr/bin/tcpdump -i $IFACE -w /var/log/labforge/capture.pcap "
            "-U -Z root\n"
            "Restart=on-failure\n"
            "[Install]\n"
            "WantedBy=multi-user.target\n"
            "EOF\n"
            "systemctl daemon-reload || true\n"
            "systemctl enable --now labforge-wifi-capture || true\n"
        ),
    ),
    # A second wireless adapter passed through to its own VM, configured as a
    # plain station that associates to the hostapd role's default AP
    # (LabForge-Demo-AP / LabForgeDemo123). Exists so a deauth/handshake-
    # capture demo always has a real client to bite, without needing an
    # audience member to connect their phone first. Needs its own USB
    # adapter — if none is attached it says so and stops, same pattern as
    # every other USB-passthrough role here, rather than silently doing
    # nothing.
    "wifi-client": _bash(
        "wifi-client",
        "wpa_supplicant station that auto-associates to the hostapd role's demo AP",
        _APT_PREAMBLE + (
            "apt-get install -y wpasupplicant iw wireless-tools rfkill isc-dhcp-client\n"
            "rfkill unblock all || true\n"
            # See the hostapd role's matching comment: `iw dev` can fail
            # outright (nl80211 unavailable), and without `|| true` that
            # would abort this role under `set -e -o pipefail` before the
            # graceful message below ever runs.\n"
            "IFACE=$(iw dev 2>/dev/null | awk '$1==\"Interface\"{print $2; exit}') || true\n"
            "if [ -z \"$IFACE\" ]; then\n"
            "  echo 'No wireless interface found yet — pass a second USB adapter "
            "through to this node (see README) then re-run: "
            "wpa_supplicant -B -i <iface> -c /etc/wpa_supplicant/labforge-client.conf "
            "&& dhclient <iface>'\n"
            "  exit 0\n"
            "fi\n"
            "cat > /etc/wpa_supplicant/labforge-client.conf <<EOF\n"
            "ctrl_interface=/var/run/wpa_supplicant\n"
            "network={\n"
            "  ssid=\"LabForge-Demo-AP\"\n"
            "  psk=\"LabForgeDemo123\"\n"
            "}\n"
            "EOF\n"
            "cat > /etc/systemd/system/labforge-wifi-client.service <<EOF\n"
            "[Unit]\n"
            "Description=LabForge auto-associating wifi station\n"
            "After=network.target\n"
            "[Service]\n"
            "ExecStart=/sbin/wpa_supplicant -i $IFACE -c "
            "/etc/wpa_supplicant/labforge-client.conf\n"
            "ExecStartPost=/sbin/dhclient $IFACE\n"
            "Restart=on-failure\n"
            "RestartSec=5\n"
            "[Install]\n"
            "WantedBy=multi-user.target\n"
            "EOF\n"
            "systemctl daemon-reload || true\n"
            "systemctl enable --now labforge-wifi-client || echo '[!] wpa_supplicant "
            "failed to start — check journalctl -u labforge-wifi-client'\n"
        ),
    ),
    # FreeRADIUS AAA backend for WPA2/WPA3-Enterprise (802.1x). Pairs with the
    # hostapd role's "wpa2-enterprise" / "wpa3-enterprise" scenarios (see
    # build_runner.WIFI_SCENARIOS), which look this node up by role name to
    # fill in auth_server_addr automatically — no manual IP wiring needed.
    # One shared NAS secret for every AP in the lab (LabForgeRadius123) and
    # one test identity (labforge / LabForgeDemo123) for PEAP/MSCHAPv2 and
    # EAP-MD5 demos, same "safe default so the node boots to something
    # working" pattern as the hostapd role's default PSK.
    "freeradius": _bash(
        "freeradius",
        "FreeRADIUS AAA server for WPA2/WPA3-Enterprise (802.1x) against the hostapd role",
        _APT_PREAMBLE + (
            "apt-get install -y freeradius\n"
            "systemctl stop freeradius || true\n"
            "USERS=/etc/freeradius/3.0/users\n"
            "if [ -f \"$USERS\" ] && ! grep -q '^labforge ' \"$USERS\"; then\n"
            "  printf '%s\\n' 'labforge Cleartext-Password := \"LabForgeDemo123\"' >> \"$USERS\"\n"
            "fi\n"
            "CLIENTS=/etc/freeradius/3.0/clients.conf\n"
            "if [ -f \"$CLIENTS\" ] && ! grep -q 'labforge-aps' \"$CLIENTS\"; then\n"
            "  printf '%s\\n' '' 'client labforge-aps {' '  ipaddr = 0.0.0.0/0' "
            "'  secret = LabForgeRadius123' '}' >> \"$CLIENTS\"\n"
            "fi\n"
            # Debian's packaged eap.conf already enables md5, mschapv2, peap,
            # ttls, and tls out of the box — that alone covers EAP Downgrade,
            # PEAP Relay, and EAP-MD5 cracking against the 'labforge' identity
            # above with no further config. BUT it wires tls-common to the
            # system's snakeoil cert and the SYSTEM CA bundle
            # (ca-certificates.crt) — verified against a real install: the
            # package's own postinst does NOT run `certs/bootstrap`, so
            # /etc/freeradius/3.0/certs/*.pem never exist unless something
            # generates them, and even once they do, the default ca_file
            # would still validate client certs against the system trust
            # store, not a CA this lab controls. EAP-TLS needs a client to
            # present a cert THIS server will actually accept, so: generate
            # our own CA/server/client cert set (idempotent — skip if already
            # bootstrapped, so a re-provision mid-webinar doesn't invalidate
            # a cert the presenter already copied out), then repoint
            # tls-common's ca_file/certificate_file/private_key_file at them.
            # Both steps must happen BEFORE the service starts below, or
            # it comes up still trusting the old chain.\n"
            "CERTDIR=/etc/freeradius/3.0/certs\n"
            "if [ ! -f \"$CERTDIR/ca.pem\" ]; then\n"
            "  ( cd \"$CERTDIR\" && sh ./bootstrap ) || echo '[freeradius role] cert "
            "bootstrap failed — see the output above; EAP-TLS will not work until it "
            "succeeds'\n"
            "fi\n"
            # radiusd drops privileges to the unprivileged 'freerad' user at
            # runtime (Debian's default.conf: user = freerad). bootstrap
            # writes root:root 640 — fine for the stock snakeoil cert/key
            # (root:ssl-cert, with freerad in the ssl-cert group) but NOT
            # for these files once eap.conf below points at them instead —
            # verified on a real install: without this, radiusd fails to
            # start with 'Failed reading certificate file ... Permission
            # denied', config check and all. World-readable is fine for a
            # lab's throwaway CA, not something to carry into production.\n"
            "chmod 644 \"$CERTDIR\"/ca.pem \"$CERTDIR\"/server.pem \"$CERTDIR\"/client.pem "
            "2>/dev/null || true\n"
            # Matches the key/value with optional quotes and any amount of
            # whitespace, since Debian's shipped file uses unquoted paths
            # (verified on a real install — quoted patterns silently never
            # matched here, which is exactly the kind of bug that looks
            # fine in a code review and does nothing at runtime) while
            # other freeradius config files in this same package DO quote
            # their values. Idempotent by construction: once a line no
            # longer matches the snakeoil/system-bundle path, sed leaves it
            # alone on every later run.\n"
            "EAPCONF=/etc/freeradius/3.0/mods-available/eap\n"
            "if [ -f \"$EAPCONF\" ]; then\n"
            "  sed -i -E \\\n"
            "    -e \"s#private_key_file[[:space:]]*=[[:space:]]*.?/etc/ssl/private/"
            "ssl-cert-snakeoil.key.?#private_key_file = $CERTDIR/server.pem#\" \\\n"
            "    -e \"s#certificate_file[[:space:]]*=[[:space:]]*.?/etc/ssl/certs/"
            "ssl-cert-snakeoil.pem.?#certificate_file = $CERTDIR/server.pem#\" \\\n"
            "    -e \"s#ca_file[[:space:]]*=[[:space:]]*.?/etc/ssl/certs/"
            "ca-certificates.crt.?#ca_file = $CERTDIR/ca.pem#\" \\\n"
            "    \"$EAPCONF\"\n"
            "  if grep -q \"ca_file = $CERTDIR/ca.pem\" \"$EAPCONF\"; then\n"
            "    echo '[freeradius role] eap.conf now trusts this labs own CA for "
            "EAP-TLS instead of the system trust store'\n"
            "  else\n"
            "    echo '[freeradius role] could not repoint eap.conf to this labs CA "
            "— the ca_file line did not match what this role expected. EAP-TLS will "
            "validate against the system trust store instead, check "
            "'\"$EAPCONF\"' by hand'\n"
            "  fi\n"
            "fi\n"
            "systemctl enable --now freeradius || echo '[!] freeradius failed to "
            "start — check journalctl -u freeradius'\n"
            # Copy the client identity out of the root-only certs dir so the
            # webinar presenter can actually fetch it (scp/vagrant-upload to
            # kali-wifi) for the 'Attacking EAP-TLS Authentication' segment,
            # without hunting through /etc/freeradius on stage.\n"
            "EXPORT=/opt/labforge/freeradius-client-certs\n"
            "if [ -f \"$CERTDIR/client.pem\" ]; then\n"
            "  mkdir -p \"$EXPORT\"\n"
            "  cp -f \"$CERTDIR\"/ca.pem \"$CERTDIR\"/client.pem \"$CERTDIR\"/client.key "
            "\"$EXPORT\"/ 2>/dev/null || true\n"
            "  chmod 644 \"$EXPORT\"/* 2>/dev/null || true\n"
            "  echo \"[freeradius role] EAP-TLS CA + client cert (passphrase: whatever) "
            "exported to $EXPORT\"\n"
            "else\n"
            "  echo '[freeradius role] cert bootstrap did not produce client.pem — "
            "EAP-TLS export skipped, see the bootstrap output above'\n"
            "fi\n"
        ),
    ),
    # Intentionally vulnerable captive-portal webapp — the attack target for
    # the "Bypassing Wi-Fi Captive Portals" segment. Pairs on the SAME node
    # as the hostapd role: that role's $IFACE is reused here for the NAT
    # redirect, so an unauthenticated client associated to the AP gets
    # bounced to this portal on any plain-HTTP request, like a real walled
    # garden. The app itself is deliberately broken (string-built SQL, an
    # unescaped reflected-XSS field, a path-traversal file upload, and a
    # Host-header-only admin gate) — never deploy this outside a lab.
    "captive-portal": _bash(
        "captive-portal",
        "Intentionally vulnerable captive-portal webapp (XSS/SQLi/upload/host-header) "
        "+ NAT redirect off the hostapd role's interface",
        _APT_PREAMBLE + (
            "apt-get install -y python3-flask iptables\n"
            "mkdir -p /opt/labforge/captive-portal/static/uploads\n"
            "cat > /opt/labforge/captive-portal/app.py <<'PYEOF'\n"
            "# LabForge captive portal — deliberately vulnerable, lab use only.\n"
            "import os\n"
            "import sqlite3\n"
            "\n"
            "from flask import Flask, request\n"
            "\n"
            "app = Flask(__name__)\n"
            "BASE = os.path.dirname(os.path.abspath(__file__))\n"
            "DB = os.path.join(BASE, 'portal.db')\n"
            "AUTH_FILE = os.path.join(BASE, 'authorized.txt')\n"
            "UPLOAD_DIR = os.path.join(BASE, 'static', 'uploads')\n"
            "\n"
            "def _db():\n"
            "    con = sqlite3.connect(DB)\n"
            "    con.execute('CREATE TABLE IF NOT EXISTS users (mac TEXT, name TEXT)')\n"
            "    return con\n"
            "\n"
            "def _is_authorized(mac):\n"
            "    if not os.path.exists(AUTH_FILE):\n"
            "        return False\n"
            "    with open(AUTH_FILE) as f:\n"
            "        return mac in [line.strip() for line in f]\n"
            "\n"
            "LEASES = '/var/lib/misc/dnsmasq.leases'\n"
            "\n"
            "def _client_mac(ip):\n"
            "    # Real captive portals never ask the guest to type in their own\n"
            "    # MAC address - the gateway already knows it from its own DHCP\n"
            "    # lease table (dnsmasq here, same as CoovaChilli/pfSense captive\n"
            "    # portals in the wild). dnsmasq.leases lines look like:\n"
            "    #   <expiry-epoch> <mac> <ip> <hostname> <client-id>\n"
            "    # This is display-only, pre-filling a hidden field - /login below\n"
            "    # still trusts whatever MAC the submitted form actually carries,\n"
            "    # so forging it (curl, Burp, a modified form) is still the bypass.\n"
            "    try:\n"
            "        with open(LEASES) as f:\n"
            "            for line in f:\n"
            "                parts = line.split()\n"
            "                if len(parts) >= 3 and parts[2] == ip:\n"
            "                    return parts[1]\n"
            "    except OSError:\n"
            "        pass\n"
            "    return ''\n"
            "\n"
            "@app.route('/')\n"
            "def index():\n"
            "    # Reflected XSS: 'name' is echoed back with no escaping. Wrapping it\n"
            "    # in a styled div changes nothing about the vuln — it is still raw\n"
            "    # string concatenation with no output encoding.\n"
            "    name = request.args.get('name', '')\n"
            "    greeting = ('<div class=\"greeting\">Welcome back, ' + name + '!</div>') if name else ''\n"
            "    mac = _client_mac(request.remote_addr)\n"
            "    return (\n"
            "        '<!doctype html><html><head><meta charset=\"utf-8\">'\n"
            "        '<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">'\n"
            "        '<title>Lounge WiFi</title><style>'\n"
            "        'body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;'\n"
            "        'background:linear-gradient(135deg,#0f2027,#203a43,#2c5364);min-height:100vh;'\n"
            "        'display:flex;align-items:center;justify-content:center}'\n"
            "        '.card{background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.35);'\n"
            "        'max-width:380px;width:92%;padding:32px 28px;text-align:center;'\n"
            "        'font-family:inherit}'\n"
            "        '.badge{width:52px;height:52px;border-radius:50%;background:#2c5364;color:#fff;'\n"
            "        'display:flex;align-items:center;justify-content:center;margin:0 auto 10px;'\n"
            "        'font-size:12px;font-weight:700;letter-spacing:.5px}'\n"
            "        'h1{font-size:20px;margin:4px 0 2px;color:#1a1a1a}'\n"
            "        '.sub{color:#667;font-size:13px;margin-bottom:22px}'\n"
            "        '.greeting{background:#eef6ff;color:#1a5fb4;border-radius:8px;padding:8px 12px;'\n"
            "        'font-size:13px;margin-bottom:16px}'\n"
            "        'label{display:block;text-align:left;font-size:12px;color:#556;margin:14px 0 4px;'\n"
            "        'font-weight:600}'\n"
            "        'input[type=text]{width:100%;padding:10px 12px;border:1px solid #dde;'\n"
            "        'border-radius:8px;font-size:14px;box-sizing:border-box}'\n"
            "        '.terms{display:flex;align-items:flex-start;gap:8px;margin:18px 0;font-size:12px;'\n"
            "        'color:#667;text-align:left}'\n"
            "        'button{width:100%;background:#2c5364;color:#fff;border:none;padding:12px;'\n"
            "        'border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;margin-top:6px}'\n"
            "        '.optional{margin-top:24px;padding-top:16px;border-top:1px solid #eee;'\n"
            "        'font-size:12px;color:#889;text-align:left}'\n"
            "        '.optional summary{cursor:pointer;color:#667;font-weight:600;text-align:center}'\n"
            "        'footer{margin-top:18px;font-size:11px;color:#aab}'\n"
            "        '</style></head><body><div class=\"card\">'\n"
            "        '<div class=\"badge\">WiFi</div>'\n"
            "        '<h1>Lounge WiFi</h1>'\n"
            "        '<div class=\"sub\">LabForge Airport Lounge &middot; Complimentary Access</div>' +\n"
            "        greeting +\n"
            "        '<form method=\"post\" action=\"/login\">'\n"
            # The MAC field is the SQLi parameter this whole portal exists to
            # teach, so it has to keep going to the server named "mac" - what
            # changed is that it is no longer a text box asking a guest to
            # type their own device address (no real captive portal does
            # that). It is hidden and pre-filled from the AP's own DHCP
            # lease table via _client_mac() above, exactly like a real
            # walled-garden gateway already knowing who you are. The
            # vulnerability does not move: /login still trusts whatever
            # value the submitted form carries, so overriding this hidden
            # field (curl, Burp, editing the DOM) is still the bypass.
            "        '<input type=\"hidden\" name=\"mac\" value=\"' + mac + '\">'\n"
            "        '<label>Your name</label>'\n"
            "        '<input type=\"text\" name=\"name\" placeholder=\"Jane Smith\">'\n"
            "        '<div class=\"terms\"><input type=\"checkbox\" checked> I agree to the Lounge '\n"
            "        'WiFi Acceptable Use Policy</div>'\n"
            "        '<button type=\"submit\">Connect to WiFi</button>'\n"
            "        '</form>'\n"
            # Deliberately NOT removed: the upload form is the path-traversal
            # file-upload vuln (see /upload below), one of the four attack
            # surfaces this portal exists to teach (XSS/SQLi/upload/host-header —
            # segment 6 of the WiFi walkthrough, "Every Captive Portal Is Just a
            # Web App", screenshots a traversal upload as one of its 4 required
            # outputs). Kept, just re-labeled to something airport lounges
            # genuinely ask for (airline lounge WiFi commonly wants a boarding
            # pass or membership-card photo for eligibility, unlike the
            # "profile photo" framing this used before, which nobody actually
            # asks guests for) and folded into a collapsed <details> instead
            # of sitting next to the connect button as a bare, unexplained
            # upload button.
            "        '<details class=\"optional\"><summary>Verify lounge access '\n"
            "        '(upload boarding pass or membership card)</summary>'\n"
            "        '<form method=\"post\" action=\"/upload\" '\n"
            "        'enctype=\"multipart/form-data\" style=\"margin-top:10px\">'\n"
            "        '<input type=\"file\" name=\"file\">'\n"
            "        '<button type=\"submit\" style=\"margin-top:10px\">Upload</button>'\n"
            "        '</form></details>'\n"
            "        '<footer>By connecting you accept our network usage policy.</footer>'\n"
            "        '</div></body></html>'\n"
            "    )\n"
            "\n"
            "@app.route('/login', methods=['POST'])\n"
            "def login():\n"
            "    # SQL injection: the MAC is spliced straight into the query string.\n"
            "    mac = request.form.get('mac', '')\n"
            "    name = request.form.get('name', '')\n"
            "    con = _db()\n"
            "    query = \"SELECT * FROM users WHERE mac = '\" + mac + \"'\"\n"
            "    try:\n"
            "        rows = con.execute(query).fetchall()\n"
            "    except sqlite3.Error as exc:\n"
            "        return 'query error: ' + str(exc), 500\n"
            "    if not rows:\n"
            "        con.execute('INSERT INTO users (mac, name) VALUES (?, ?)', (mac, name))\n"
            "        con.commit()\n"
            "    con.close()\n"
            "    with open(AUTH_FILE, 'a') as f:\n"
            "        f.write(mac + '\\n')\n"
            "    return 'Authorized. ' + str(len(rows)) + ' prior row(s) matched that MAC.'\n"
            "\n"
            "@app.route('/authorize')\n"
            "def authorize():\n"
            "    # MAC-spoofing bypass: trusts a client-supplied MAC with no\n"
            "    # binding to the actual associated station.\n"
            "    mac = request.args.get('mac', '')\n"
            "    with open(AUTH_FILE, 'a') as f:\n"
            "        f.write(mac + '\\n')\n"
            "    return 'mac ' + mac + ' added to the walled-garden allow-list'\n"
            "\n"
            "@app.route('/upload', methods=['POST'])\n"
            "def upload():\n"
            "    # Unrestricted file upload with no extension/size check and no\n"
            "    # filename sanitization — a path-traversal filename escapes\n"
            "    # UPLOAD_DIR entirely.\n"
            "    f = request.files.get('file')\n"
            "    if not f or not f.filename:\n"
            "        return 'no file', 400\n"
            "    dest = os.path.join(UPLOAD_DIR, f.filename)\n"
            "    f.save(dest)\n"
            "    return 'saved to ' + dest\n"
            "\n"
            "@app.route('/admin')\n"
            "def admin():\n"
            "    # Host-header-only auth gate: trusts whatever Host the client sent.\n"
            "    if request.headers.get('Host', '') != 'portal.internal':\n"
            "        return 'forbidden', 403\n"
            "    rows = _db().execute('SELECT mac, name FROM users').fetchall()\n"
            "    return '<pre>' + '\\n'.join(str(r) for r in rows) + '</pre>'\n"
            "\n"
            "@app.route('/status')\n"
            "def status():\n"
            "    mac = request.args.get('mac', '')\n"
            "    return 'authorized' if _is_authorized(mac) else 'not authorized'\n"
            "\n"
            "if __name__ == '__main__':\n"
            "    app.run(host='0.0.0.0', port=80)\n"
            "PYEOF\n"
            "cat > /etc/systemd/system/labforge-captive-portal.service <<EOF\n"
            "[Unit]\n"
            "Description=LabForge intentionally-vulnerable captive portal\n"
            "After=network.target\n"
            "[Service]\n"
            "WorkingDirectory=/opt/labforge/captive-portal\n"
            "ExecStart=/usr/bin/python3 /opt/labforge/captive-portal/app.py\n"
            "Restart=on-failure\n"
            "[Install]\n"
            "WantedBy=multi-user.target\n"
            "EOF\n"
            "systemctl daemon-reload || true\n"
            "systemctl enable --now labforge-captive-portal || echo '[!] captive portal "
            "failed to start — check journalctl -u labforge-captive-portal'\n"
            # `iw` itself may not even be installed here (this role doesn't
            # install it — it's supposed to pair with the hostapd role,
            # which does) — and even when it is, `iw dev` can fail outright
            # rather than just succeed empty. Either way, `|| true` is what
            # keeps that reachable as a graceful skip instead of aborting
            # the role under `set -e -o pipefail`.\n"
            "IFACE=$(iw dev 2>/dev/null | awk '$1==\"Interface\"{print $2; exit}') || true\n"
            "if [ -n \"$IFACE\" ]; then\n"
            "  iptables -t nat -C PREROUTING -i \"$IFACE\" -p tcp --dport 80 -j REDIRECT "
            "--to-port 80 2>/dev/null || iptables -t nat -A PREROUTING -i \"$IFACE\" "
            "-p tcp --dport 80 -j REDIRECT --to-port 80\n"
            "else\n"
            "  echo '[captive-portal role] no wireless interface yet — the NAT redirect "
            "will apply once the hostapd role brings one up on this same node (re-run "
            "provision after)'\n"
            "fi\n"
        ),
    ),
    # A visible desktop for a VM meant to be shown on a projector instead of
    # driven over SSH — pairs with config.gui: true on the node. Deliberately
    # lightweight (XFCE, not the full Kali desktop meta-package) so a fresh
    # VM is still a fast first boot.
    "desktop-xfce": _bash(
        "desktop-xfce",
        "XFCE desktop + hypervisor guest integration (VirtualBox or VMware), for a node booted with gui: true",
        "export DEBIAN_FRONTEND=noninteractive\n"
        # An older kalilinux/rolling box (the VMware build is 2023.4) ships an
        # expired archive key, so `apt-get update` fails and every package
        # install then 404s against a stale index. Refresh the key first and
        # let a real update failure show instead of swallowing it.
        "if grep -qi kali /etc/os-release; then\n"
        "  wget -qO /usr/share/keyrings/kali-archive-keyring.gpg "
        "https://archive.kali.org/archive-keyring.gpg || true\n"
        "fi\n"
        "apt-get update -y\n"
        "case \"$(systemd-detect-virt 2>/dev/null)\" in\n"
        "  vmware) GUEST_PKGS='open-vm-tools open-vm-tools-desktop' ;;\n"
        "  oracle) GUEST_PKGS='virtualbox-guest-dkms virtualbox-guest-utils virtualbox-guest-x11' ;;\n"
        "  *) GUEST_PKGS='' ;;\n"
        "esac\n"
        "apt-get install -y xfce4 xfce4-terminal lightdm $GUEST_PKGS "
        ">/dev/null 2>&1 || apt-get install -y xfce4 xfce4-terminal lightdm\n"
        + (
            # Confirmed fix for the VMware+Xfce invisible-cursor bug (see the
            # matching vmx settings in Vagrantfile.j2): the generic
            # `modesetting` driver's hardware cursor doesn't render under
            # Xfce on vmwgfx, so force a software cursor instead. Only
            # matters on VMware; harmless (and skipped) elsewhere.
            "if [ \"$(systemd-detect-virt 2>/dev/null)\" = vmware ]; then\n"
            "  mkdir -p /etc/X11/xorg.conf.d\n"
            "  cat > /etc/X11/xorg.conf.d/20-swcursor.conf <<'EOF'\n"
            "Section \"Device\"\n"
            "    Identifier \"Configured Video Device\"\n"
            "    Driver \"modesetting\"\n"
            "    Option \"SWcursor\" \"true\"\n"
            "EndSection\n"
            "EOF\n"
            "fi\n"
            "systemctl set-default graphical.target\n"
            "systemctl enable --now lightdm || true\n"
        ),
    ),
    # Unlike wifi-pentest-env (diagnostics only, any OS — see that role's own
    # comment), this one is specifically for the real kalilinux/rolling box
    # and does pull in attack tooling on purpose: hcxdumptool/hcxtools (PMKID,
    # segment 4), mdk4 (deauth DoS, segment 7), eaphammer + hostapd-wpe
    # (Enterprise Evil Twin / PEAP relay, segment 11). Verified missing from
    # the box image as of kalilinux/rolling 2026.2 — everything else the
    # walkthrough calls for (aircrack-ng, wifite, reaver, hashcat, bully,
    # macchanger) already ships with it.
    "kali-attack-tooling": _bash(
        "kali-attack-tooling",
        "Tops up the handful of attack tools verified missing from the kalilinux/rolling box image",
        _APT_PREAMBLE + (
            "apt-get install -y hcxdumptool hcxtools mdk4 eaphammer hostapd-wpe "
            ">/dev/null 2>&1 || apt-get install -y hcxdumptool hcxtools mdk4 eaphammer hostapd-wpe\n"
        ),
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

# Role names used by a bundled template that are really just a more specific name for an
# installer above. Without these, the role silently gets no installer at all (it falls through to
# the "no curated installer" stub) even though the near-identical bare name works fine — this bit
# both the dfir-lab ('splunk-enterprise@9.3.0', only 'splunk' was registered) and telecom-ad-rts
# ('pfsense-emulator', only 'pfsense' was registered; red-team-range's firewall already used
# 'pfsense' correctly, same stand-in box, same intent).
LINUX_INSTALLERS["splunk-enterprise"] = LINUX_INSTALLERS["splunk"]
LINUX_INSTALLERS["pfsense-emulator"] = LINUX_INSTALLERS["pfsense"]


def linux_snippet(role_id: str) -> RoleSnippet | None:
    return LINUX_INSTALLERS.get(role_id)


def windows_snippet(role_id: str) -> RoleSnippet | None:
    return WINDOWS_INSTALLERS.get(role_id)


__all__ = [
    "LINUX_INSTALLERS",
    "WINDOWS_INSTALLERS",
    "RoleSnippet",
    "linux_snippet",
    "windows_snippet",
]
