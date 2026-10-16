// Write one decision: Agent, Session, Call, Decision, the PREV hash-chain edge and ARG_CONTAINS value edges.
// params: {"agent": "claude-code", "session": "s1", "tool": "read_file", "repo": "/repo", "caps": "filesystem_read", "capList": ["filesystem_read"], "model": "", "graphMs": 0.3, "egress": [], "id": "s1-1", "decision": "ALLOW", "stage": "default", "reason": "ok", "hash": "h1", "prev": "", "ts": 1, "cutEdges": [], "cutCost": 0, "paths": [], "predicted": [{"kind": "file", "name": "src/app.go"}]}
MERGE (a:Agent {id:$agent})
MERGE (s:Session {id:$session}) ON CREATE SET s.started_at = $ts
MERGE (a)-[:RAN]->(s)
MERGE (t:Tool {name:$tool})
FOREACH (cap IN $capList | MERGE (cp:Capability {name:cap}) MERGE (t)-[:REQUIRES]->(cp))
CREATE (s)-[:MADE]->(k:Call {id:$id, ts:$ts, tool:$tool, repo:$repo, caps:$caps, decision:$decision, stage:$stage})-[:INVOKED]->(t)
CREATE (k)-[:DECIDED]->(d:Decision {id:$id, verdict:$decision, stage:$stage, reason:$reason, model:$model, graph_ms:$graphMs, hash:$hash, prev_hash:$prev, ts:$ts, cut_edges:$cutEdges, cut_cost:$cutCost, paths:$paths})
FOREACH (h IN $egress | MERGE (v:Value {hash:h}) MERGE (k)-[:ARG_CONTAINS]->(v))
FOREACH (e IN $predicted | CREATE (k)-[:PREDICTED]->(:PredictedEffect {call:$id, kind:e.kind, name:e.name}))
WITH d
OPTIONAL MATCH (p:Decision {hash:$prev}) WHERE $prev <> ''
FOREACH (_ IN CASE WHEN p IS NULL THEN [] ELSE [1] END | CREATE (d)-[:PREV]->(p))
