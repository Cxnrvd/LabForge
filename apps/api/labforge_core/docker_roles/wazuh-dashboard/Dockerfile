FROM wazuh/wazuh-dashboard:4.9.0

LABEL org.opencontainers.image.title="labforge wazuh-dashboard" \
      org.opencontainers.image.description="wazuh-dashboard with opensearch.hosts repointed from the image's hardcoded https://localhost:9200 at the lab's own wazuh-indexer container"

USER root
COPY entrypoint.sh /labforge-entrypoint.sh
RUN chmod +x /labforge-entrypoint.sh \
    # opensearch-dashboards refuses to run as root, and the image's own entrypoint.sh does not
    # drop privileges itself (unlike wazuh-indexer's), so this wrapper must switch back before
    # exec'ing it; the config file our sed targets needs to stay writable by that user too.
    && chown wazuh-dashboard:wazuh-dashboard /usr/share/wazuh-dashboard/config/opensearch_dashboards.yml \
    # /etc/wazuh-dashboard does not exist in this image at all (the keystore it writes to lives
    # there, not under /usr/share/.../config); pre-creating it here, owned by the runtime user,
    # stops Docker auto-creating it root:root the moment the certs volume below is mounted under
    # it, which otherwise makes the keystore write fail with EACCES.
    && mkdir -p /etc/wazuh-dashboard && chown wazuh-dashboard:wazuh-dashboard /etc/wazuh-dashboard

USER wazuh-dashboard
ENTRYPOINT ["/labforge-entrypoint.sh"]
