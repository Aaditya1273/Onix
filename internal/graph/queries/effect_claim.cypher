// Claim the session's latest allowed, not-yet-observed call of a tool, so its observed effects attach to the right call.
// params: {"session": "s1", "tool": "mcp__fmt__format"}
MATCH (:Session {id:$session})-[:MADE]->(k:Call {tool:$tool, decision:'ALLOW'})
WHERE k.observed IS NULL
WITH k ORDER BY k.ts DESC LIMIT 1
SET k.observed = true
RETURN k.id
