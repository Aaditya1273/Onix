// Reveal: the decisions that matter most, a secret crossing sessions first, then a redaction, external content into a shell, a package, a rug pull, a person, behavior.
// params: {"limit": 5}
MATCH (s:Session)-[:MADE]->(k:Call)-[:DECIDED]->(d:Decision) WHERE d.verdict <> 'ALLOW' OR d.stage = 'redact'
RETURN d.id, d.verdict, d.stage, d.reason, k.tool, coalesce(k.label, ''), s.id, k.ts, coalesce(k.repo, ''), coalesce(d.paths, [])
ORDER BY CASE d.stage WHEN 'exfiltration' THEN 0 WHEN 'redact' THEN 1 WHEN 'provenance' THEN 2 WHEN 'code_graph' THEN 3
         WHEN 'tool_drift' THEN 4 WHEN 'entity_policy' THEN 5 ELSE 9 END, k.ts
LIMIT $limit
