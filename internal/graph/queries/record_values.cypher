// Link hashed values a call produced (secrets read, URLs fetched) to the session's latest call of a tool.
// First seen decides: a value first seen in public content ($public) never becomes sensitive later,
// while a secret that later shows up in public content stays a secret.
// params: {"session": "s1", "tool": "read_file", "hashes": ["0000000000000000000000000000000000000000000000000000000000000000"], "sensitive": true, "public": false, "trust": "TOOL", "rank": 1}
MATCH (:Session {id:$session})-[:MADE]->(k:Call {tool:$tool})
WITH k ORDER BY k.ts DESC LIMIT 1
UNWIND $hashes AS h
MERGE (v:Value {hash:h})
ON CREATE SET v.sensitive = $sensitive AND NOT $public, v.public = $public, v.trust = $trust, v.trust_rank = $rank
ON MATCH SET v.sensitive = (v.sensitive OR $sensitive) AND NOT coalesce(v.public, false),
             v.trust_rank = CASE WHEN $rank < v.trust_rank THEN $rank ELSE v.trust_rank END
MERGE (k)-[:READ]->(v)
