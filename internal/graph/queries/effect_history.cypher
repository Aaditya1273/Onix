// What this tool has done before: its observed effects that were not themselves hidden side effects.
// params: {"tool": "mcp__fmt__format"}
MATCH (k:Call {tool:$tool})-[:OBSERVED]->(o:ObservedEffect)
WHERE coalesce(o.hidden, false) = false
RETURN o.kind, o.name, count(*) AS seen ORDER BY seen DESC LIMIT 50
