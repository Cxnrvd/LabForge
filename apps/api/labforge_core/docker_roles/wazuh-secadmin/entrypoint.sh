#!/bin/bash
# One-time bootstrap of wazuh-indexer's security index from the demo internal_users.yml/roles.yml
# already bundled in the wazuh-indexer image (securityadmin.sh never runs this automatically in
# this image version — the usual single-host deployment runs it once by hand after the indexer
# is up, which is what this container does for every lab run instead).
set -euo pipefail

CERTS=/certs
OUT="$CERTS/.secadmin-ready"

if [ -f "$OUT" ]; then
    echo "security index already bootstrapped, skipping"
    exec sleep infinity
fi

for i in $(seq 1 30); do
    if [ -f "$CERTS/admin.pem" ] && [ -f "$CERTS/root-ca.pem" ]; then
        break
    fi
    sleep 2
done

bash /usr/share/wazuh-indexer/plugins/opensearch-security/tools/securityadmin.sh \
    -cd /usr/share/wazuh-indexer/opensearch-security/ \
    -nhnv -icl \
    -cacert "$CERTS/root-ca.pem" \
    -cert "$CERTS/admin.pem" \
    -key "$CERTS/admin-key.pem" \
    -h "${INDEXER_HOST:-wazuh-indexer}" \
    -p 9200

touch "$OUT"
echo "security index bootstrapped"
exec sleep infinity
