FROM debian:bookworm-slim

LABEL org.opencontainers.image.title="labforge analyst-workstation" \
      org.opencontainers.image.description="Terminal tooling for hunting in the lab's logs"

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       jq ripgrep python3 curl ca-certificates less gawk bsdextrautils nano procps \
    && rm -rf /var/lib/apt/lists/*

COPY esq /usr/local/bin/esq
COPY motd.sh /etc/profile.d/labforge-motd.sh
RUN chmod +x /usr/local/bin/esq \
    && echo '[ -f /etc/profile.d/labforge-motd.sh ] && . /etc/profile.d/labforge-motd.sh' >> /root/.bashrc

WORKDIR /root
CMD ["sleep", "infinity"]
