#!/bin/bash
# Runtime setup for the account-compromise-chain 'victim' container.
#
# Build-time (Dockerfile) installs sshd, rsyslog and the wazuh-agent package. Everything that
# depends on *this lab's* topology (the SSH login account, the manager's address) happens here
# instead, since those values only exist once the compose project is rendered.
set -euo pipefail

SSH_USER="${LABFORGE_USER:-jdoe}"
SSH_PASSWORD="${LABFORGE_PASSWORD:-password123}"
WAZUH_MANAGER_IP="${WAZUH_MANAGER_IP:-}"

if ! id -u "$SSH_USER" >/dev/null 2>&1; then
    useradd -m -s /bin/bash "$SSH_USER"
fi
echo "${SSH_USER}:${SSH_PASSWORD}" | chpasswd

# rsyslog is what turns sshd/PAM's syslog(3) calls into a real /var/log/auth.log; a bare
# container has no systemd/journald (so no `service` command either, hence calling the daemon
# directly), and without this step journalctl -u ssh shows nothing and the raw-log half of the
# lesson (comparing auth.log to what Wazuh parsed) has nothing to show.
/usr/sbin/rsyslogd

if [ -n "$WAZUH_MANAGER_IP" ]; then
    sed -i "s/<address>.*<\/address>/<address>${WAZUH_MANAGER_IP}<\/address>/" /var/ossec/etc/ossec.conf

    # File Integrity Monitoring on the two paths the privilege-escalation step touches (new user /
    # sudoers edit), in realtime so that step also lights up in the dashboard instead of being a
    # pure "the SIEM didn't catch everything" gap.
    sed -i 's#</syscheck>#  <directories realtime="yes" check_all="yes">/etc/passwd,/etc/sudoers</directories>\n  </syscheck>#' \
        /var/ossec/etc/ossec.conf

    # agent-auth talks to the manager's authd (port 1515) and writes this agent's registration
    # key itself; retried because the manager's healthcheck can report healthy a few seconds
    # before authd actually accepts connections.
    for _ in $(seq 1 30); do
        if /var/ossec/bin/agent-auth -m "$WAZUH_MANAGER_IP"; then
            break
        fi
        sleep 2
    done
    /var/ossec/bin/wazuh-control start
else
    echo "WAZUH_MANAGER_IP not set: starting sshd without agent enrollment" >&2
fi

exec /usr/sbin/sshd -D -e
