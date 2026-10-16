// Store one day's Agent Risk Score for an agent (scope = agent id) or the whole tenant (scope = '*'). Idempotent per day.
// params: {"scope": "claude-code", "day": "2026-10-16", "score": 12.5, "components": "{}", "ts": 0}
MERGE (r:RiskSnapshot {scope:$scope, day:$day})
SET r.score = $score, r.components = $components, r.ts = $ts
WITH r
OPTIONAL MATCH (a:Agent {id:$scope})
FOREACH (_ IN CASE WHEN a IS NULL THEN [] ELSE [1] END | MERGE (a)-[:HAS_RISK]->(r))
