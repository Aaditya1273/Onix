// The underwriting ledger: every sealed decision in a time window, in chain order, with the audit fields its hash
// covers plus the graph evidence behind it (paths, cut, predicted and observed effects).
// params: {"from": 0, "to": 9000000000000000000}
MATCH (s:Session)-[:MADE]->(k:Call)-[:DECIDED]->(d:Decision)
WHERE d.audit_ns >= $from AND d.audit_ns <= $to AND coalesce(d.hash, '') <> ''
OPTIONAL MATCH (k)-[:PREDICTED]->(p:PredictedEffect)
WITH s, k, d, collect(DISTINCT [p.kind, p.name]) AS predicted
OPTIONAL MATCH (k)-[:OBSERVED]->(o:ObservedEffect)
WITH s, k, d, predicted, collect(DISTINCT [o.kind, o.name, coalesce(o.hidden, false)]) AS observed
RETURN d.audit_id, d.audit_ts, d.audit_agent, s.id, k.tool, d.args_hash, d.verdict, d.reason, d.model, d.cost, d.prev_hash, d.hash,
       d.id, d.stage, coalesce(d.paths, []), coalesce(d.cut_edges, []), coalesce(d.cut_cost, 0), predicted, observed
ORDER BY d.audit_ns
