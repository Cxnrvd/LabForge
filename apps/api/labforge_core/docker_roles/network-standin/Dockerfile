FROM debian:bookworm-slim

LABEL org.opencontainers.image.title="labforge network-standin" \
      org.opencontainers.image.description="pfSense/OPNsense stand-in: nftables default-accept forwarding + dnsmasq, same approach as the Vagrant path's 'pfsense'/'opnsense' roles (role_installers.py), ported to a container"

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nftables dnsmasq \
    && rm -rf /var/lib/apt/lists/*

# No CMD here: the role's own `command` (docker_roles.py) applies the nftables table and execs
# dnsmasq, so the exact startup sequence lives with the role definition, not baked into the image.
