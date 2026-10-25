#!/bin/bash
# opensearch.yml hardcodes its SSL cert paths at /etc/wazuh-indexer/certs, which sits outside
# this image's OPENSEARCH_PATH_CONF (/usr/share/wazuh-indexer — see the entrypoint's own
# `export OPENSEARCH_PATH_CONF=${INSTALLATION_DIR}`). The security plugin's SecurityManager
# policy only grants file reads under path.conf, so anything outside it throws
# AccessControlException reading indexer.pem even though plain Unix permissions are fine.
# Moving the certs under path.conf itself sidesteps that without touching the plugin's policy.
set -euo pipefail

CONF=/usr/share/wazuh-indexer/opensearch.yml
sed -i 's#/etc/wazuh-indexer/certs#/usr/share/wazuh-indexer/certs#g' "$CONF"

exec /entrypoint.sh "$@"
