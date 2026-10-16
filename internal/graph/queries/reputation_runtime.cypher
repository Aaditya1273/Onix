// Runtime reputation: what this tool's calls actually did here, from decisions and observed effects.
// params: {"tool": "mcp__dns__update"}
MATCH (a:Agent)-[:RAN]->(:Session)-[:MADE]->(k:Call {tool:$tool})-[:DECIDED]->(d:Decision)
RETURN count(k), sum(CASE WHEN d.verdict = 'ALLOW' THEN 0 ELSE 1 END), sum(CASE WHEN coalesce(k.hidden, false) THEN 1 ELSE 0 END),
       count(DISTINCT a), max(k.ts)
