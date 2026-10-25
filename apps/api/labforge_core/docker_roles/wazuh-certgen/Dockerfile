FROM wazuh/wazuh-indexer:4.9.0

LABEL org.opencontainers.image.title="labforge wazuh-certgen" \
      org.opencontainers.image.description="One-shot cert generator for the account-compromise-chain Wazuh stack, using the wazuh-certs-tool.sh already bundled in the wazuh-indexer image"

USER root
RUN dnf install -y openssl && dnf clean all
COPY entrypoint.sh /labforge-entrypoint.sh
RUN chmod +x /labforge-entrypoint.sh

ENTRYPOINT ["/labforge-entrypoint.sh"]
