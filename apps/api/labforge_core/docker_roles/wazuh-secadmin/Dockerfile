FROM wazuh/wazuh-indexer:4.9.0

LABEL org.opencontainers.image.title="labforge wazuh-secadmin" \
      org.opencontainers.image.description="Runs the one-time securityadmin.sh bootstrap against wazuh-indexer, loading the demo internal_users/roles bundled in the image (admin/admin, kibanaserver/kibanaserver)"

USER root
COPY entrypoint.sh /labforge-entrypoint.sh
RUN chmod +x /labforge-entrypoint.sh

ENTRYPOINT ["/labforge-entrypoint.sh"]
