FROM wazuh/wazuh-indexer:4.9.0

LABEL org.opencontainers.image.title="labforge wazuh-indexer" \
      org.opencontainers.image.description="wazuh-indexer with its cert paths repointed from /etc/wazuh-indexer/certs (outside this image's OPENSEARCH_PATH_CONF, which the security plugin's SecurityManager policy does not grant) to a path under path.conf"

USER root
COPY entrypoint.sh /labforge-entrypoint.sh
RUN chmod +x /labforge-entrypoint.sh

ENTRYPOINT ["/labforge-entrypoint.sh"]
