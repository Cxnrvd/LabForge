#!/bin/bash
# Generates every cert the account-compromise-chain Wazuh stack needs, using the official
# wazuh-certs-tool.sh that already ships inside the wazuh-indexer image (no need to vendor our
# own openssl logic or a separate wazuh-certs-generator image).
set -euo pipefail

TOOLS=/usr/share/wazuh-indexer/plugins/opensearch-security/tools
OUT=/certs

if [ -f "$OUT/.ready" ]; then
    echo "certs already generated, skipping"
    exec sleep infinity
fi

sed -i \
    -e "s/<indexer-node-ip>/${INDEXER_IP}/" \
    -e "s/<wazuh-manager-ip>/${MANAGER_IP}/" \
    -e "s/<dashboard-node-ip>/${DASHBOARD_IP}/" \
    "$TOOLS/config.yml"

bash "$TOOLS/wazuh-certs-tool.sh" -A

GEN="$TOOLS/wazuh-certificates"
cp "$GEN/root-ca.pem" "$GEN/root-ca.key" "$GEN/admin.pem" "$GEN/admin-key.pem" "$OUT/"

# wazuh-certs-tool.sh's own leaf certs carry only an IP SAN (config.yml has no hostname field),
# but every service here connects its peers by Docker Compose hostname, not IP — so a cert built
# from config.yml alone fails TLS hostname verification on every client that doesn't skip it
# (curl -k does; Node's https client and the dashboard's opensearch client do not). Re-issuing
# the two server leaf certs here, signed by the same root CA, with both the hostname and IP as
# SAN entries, is simpler than teaching the bundled tool a second SAN source.
gen_server_cert() {
    local name="$1" cn="$2" host="$3" ip="$4"
    local conf="$OUT/${name}.conf"
    # Same extensions as wazuh-certs-tool.sh's own leaf certs (basicConstraints/keyUsage), not
    # just the SAN this role actually needed to add — Node's TLS stack (the dashboard's opensearch
    # client) rejected a leaf cert built with bare -addext subjectAltName and nothing else, where
    # curl's validation was satisfied by it.
    cat > "$conf" <<-EOF
		[ req ]
		prompt = no
		default_bits = 2048
		default_md = sha256
		distinguished_name = req_distinguished_name
		x509_extensions = v3_req

		[ req_distinguished_name ]
		C = US
		L = California
		O = Wazuh
		OU = Wazuh
		CN = ${cn}

		[ v3_req ]
		authorityKeyIdentifier = keyid,issuer
		basicConstraints = CA:FALSE
		keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
		extendedKeyUsage = serverAuth, clientAuth
		subjectAltName = @alt_names

		[ alt_names ]
		DNS.1 = ${host}
		DNS.2 = localhost
		IP.1 = ${ip}
		IP.2 = 127.0.0.1
	EOF
    openssl req -new -nodes -newkey rsa:2048 \
        -keyout "$OUT/${name}-key.pem" -out "$OUT/${name}.csr" -config "$conf"
    openssl x509 -req -in "$OUT/${name}.csr" \
        -CA "$OUT/root-ca.pem" -CAkey "$OUT/root-ca.key" -CAcreateserial \
        -out "$OUT/${name}.pem" -days 3650 -sha256 -extfile "$conf" -extensions v3_req
    rm -f "$OUT/${name}.csr" "$conf"
}

# CN stays "node-1" to match opensearch.yml's nodes_dn ("CN=node-1,..."); the file is still named
# indexer.pem/-key.pem because that's what opensearch.yml's own cert path settings hardcode.
gen_server_cert indexer node-1 wazuh-indexer "${INDEXER_IP}"
gen_server_cert dashboard dashboard wazuh-dashboard "${DASHBOARD_IP}"

chmod 644 "$OUT"/*.pem
chmod 644 "$OUT"/*.key 2>/dev/null || true

touch "$OUT/.ready"
echo "certs ready in $OUT"
exec sleep infinity
