FROM ubuntu:22.04

LABEL org.opencontainers.image.title="labforge ssh-victim" \
      org.opencontainers.image.description="SSH login target for the account-compromise-chain lab: real sshd + rsyslog (so /var/log/auth.log behaves like a normal host) plus a Wazuh agent enrolled at runtime"

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       openssh-server rsyslog sudo curl gnupg ca-certificates \
    && mkdir -p /run/sshd \
    && rm -rf /var/lib/apt/lists/* \
    # Wazuh's apt repo, pinned to the 4.x line the manager/indexer/dashboard roles use.
    && curl -fsSL https://packages.wazuh.com/key/GPG-KEY-WAZUH | gpg --dearmor -o /usr/share/keyrings/wazuh.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main" \
       > /etc/apt/sources.list.d/wazuh.list \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends wazuh-agent=4.9.0-1 \
    && rm -rf /var/lib/apt/lists/* \
    && sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config \
    && sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config

COPY entrypoint.sh /usr/local/bin/labforge-entrypoint.sh
RUN chmod +x /usr/local/bin/labforge-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/labforge-entrypoint.sh"]
