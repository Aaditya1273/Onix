// Share a block across tenants: the hash and an anonymized tenant marker, never content. (threat_intel graph)
// params: {"h": "0000000000000000000000000000000000000000000000000000000000000000", "kind": "package", "ts": 1, "tenant": "t"}
MERGE (h:Hash {value:$h})
ON CREATE SET h.kind = $kind, h.first_seen = $ts, h.tenants = []
SET h.tenants = CASE WHEN $tenant IN h.tenants THEN h.tenants ELSE h.tenants + $tenant END
