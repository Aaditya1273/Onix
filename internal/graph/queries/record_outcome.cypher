// Mark the session's latest allowed call of a tool as executed (ok or failed).
// params: {"session": "s1", "tool": "read_file", "ok": true, "cost": 0.0}
MATCH (:Session {id:$session})-[:MADE]->(k:Call {tool:$tool, decision:'ALLOW'})
WHERE k.ok IS NULL
WITH k ORDER BY k.ts DESC LIMIT 1
SET k.ok = $ok, k.cost = $cost
