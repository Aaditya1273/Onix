// Every (agent, repo, tool, capability shape) with enough clean runs since its last incident.
// params: {"min": 1}
MATCH (a:Agent)-[:RAN]->(:Session)-[:MADE]->(k:Call)
WITH a.id AS agent, k.repo AS repo, k.tool AS tool, k.caps AS caps, collect(k) AS ks
OPTIONAL MATCH (t:Tool {name:tool})
WITH agent, repo, tool, caps, ks, coalesce(t.changed_at, 0) AS changed
WITH agent, repo, tool, caps, ks, reduce(m = changed, k IN ks | CASE WHEN k.decision <> 'ALLOW' AND k.ts > m THEN k.ts ELSE m END) AS last
WITH agent, repo, tool, caps, size([k IN ks WHERE k.decision = 'ALLOW' AND k.ok = true AND k.ts > last]) AS clean
WHERE clean >= $min
RETURN agent, repo, tool, caps, clean ORDER BY clean DESC
