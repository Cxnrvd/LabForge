#!/bin/bash
# opensearch_dashboards.yml ships with opensearch.hosts hardcoded to https://localhost:9200,
# which only works when the dashboard and indexer are the same host/container. Repoint it at
# this lab's actual indexer hostname before handing off to the image's own entrypoint.
set -euo pipefail

CONF=/usr/share/wazuh-dashboard/config/opensearch_dashboards.yml
sed -i "s#https://localhost:9200#${INDEXER_URL:-https://wazuh-indexer:9200}#" "$CONF"

exec /entrypoint.sh "$@"
