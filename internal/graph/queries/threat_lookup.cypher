// Has any tenant blocked this hash? (runs on the shared threat_intel graph)
// params: {"h": "0000000000000000000000000000000000000000000000000000000000000000"}
MATCH (h:Hash {value:$h}) RETURN h.kind, h.first_seen, size(h.tenants)
