// The description change behind a rug-pull pause.
// params: {"tool": "dns_update"}
MATCH (t:Tool {name:$tool})-[:HAS_VERSION]->(cur:ToolVersion {hash:t.version})-[:SUPERSEDES]->(old:ToolVersion)
RETURN old.description, cur.description, t.changed_at
