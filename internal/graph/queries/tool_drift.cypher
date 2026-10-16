// Has the tool's description changed since this agent last used it?
// params: {"agent": "claude-code", "tool": "dns_update"}
MATCH (t:Tool {name:$tool}) WHERE t.changed_at IS NOT NULL
MATCH (t)-[:HAS_VERSION]->(cur:ToolVersion {hash:t.version})
OPTIONAL MATCH (cur)-[:SUPERSEDES]->(old:ToolVersion)
OPTIONAL MATCH (:Agent {id:$agent})-[:RAN]->(:Session)-[:MADE]->(k:Call {tool:$tool})
RETURN t.changed_at, max(k.ts), old.description, cur.description
