// Time travel: the most recent decision at or before $t that stopped or rewrote a call, for "Why?" at any point.
// params: {"t": 9000000000000000000}
MATCH (k:Call)-[:DECIDED]->(d:Decision)
WHERE d.ts <= $t AND (d.verdict <> 'ALLOW' OR d.stage = 'redact')
RETURN d.id ORDER BY d.ts DESC LIMIT 1
