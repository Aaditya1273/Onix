// Record a tool description; a changed one SUPERSEDES the old and stamps changed_at.
// params: {"tool": "dns_update", "hash": "h", "desc": "Updates a DNS record.", "prev": "", "ts": 1}
MERGE (t:Tool {name:$tool})
CREATE (t)-[:HAS_VERSION]->(v:ToolVersion {hash:$hash, description:$desc, seen_at:$ts})
SET t.version = $hash
WITH t, v
OPTIONAL MATCH (t)-[:HAS_VERSION]->(old:ToolVersion {hash:$prev})
FOREACH (_ IN CASE WHEN old IS NULL THEN [] ELSE [1] END |
  CREATE (v)-[:SUPERSEDES]->(old)
  SET t.changed_at = $ts)
