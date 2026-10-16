// One call as the reveal page shows it: tool, redacted label, session, time, repo.
// params: {"id": "s1-1"}
MATCH (s:Session)-[:MADE]->(k:Call {id:$id})
RETURN k.tool, coalesce(k.label, ''), s.id, k.ts, coalesce(k.repo, '')
