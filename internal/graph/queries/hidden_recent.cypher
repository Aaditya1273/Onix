// How many of this agent's last 20 calls of a tool had a hidden secondary effect.
// params: {"agent": "claude-code", "tool": "mcp__fmt__format"}
MATCH (:Agent {id:$agent})-[:RAN]->(:Session)-[:MADE]->(k:Call {tool:$tool})
WITH k ORDER BY k.ts DESC LIMIT 20
RETURN size([x IN collect(k) WHERE x.hidden = true])
