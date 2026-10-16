// Clean, executed runs of one tool + capability shape by one agent in one repo since the last incident or tool change.
// params: {"agent": "claude-code", "repo": "/repo", "tool": "read_file", "caps": "filesystem_read"}
OPTIONAL MATCH (t:Tool {name:$tool})
WITH coalesce(t.changed_at, 0) AS changed
MATCH (:Agent {id:$agent})-[:RAN]->(:Session)-[:MADE]->(k:Call {tool:$tool, caps:$caps, repo:$repo})
WITH changed, collect(k) AS ks
WITH ks, reduce(m = changed, k IN ks | CASE WHEN k.decision <> 'ALLOW' AND k.ts > m THEN k.ts ELSE m END) AS last
RETURN size([k IN ks WHERE k.decision = 'ALLOW' AND k.ok = true AND k.ts > last]), size(ks), last
