// Time travel: the scrubber's ticks, one per decision, newest $limit, in time order.
// params: {"limit": 20000}
MATCH (k:Call)-[:DECIDED]->(d:Decision)
WITH d, k ORDER BY d.ts DESC LIMIT $limit
RETURN d.id, d.ts, d.verdict, d.stage, k.tool ORDER BY d.ts
