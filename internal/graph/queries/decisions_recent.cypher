// Recent decisions from the graph, newest first, optionally only the ones that stopped or rewrote a call.
// params: {"limit": 20, "all": false}
MATCH (s:Session)-[:MADE]->(k:Call)-[:DECIDED]->(d:Decision)
WHERE $all OR d.verdict <> 'ALLOW' OR size(coalesce(d.cut_edges, [])) > 0 OR k.hidden = true
OPTIONAL MATCH (a:Agent)-[:RAN]->(s)
RETURN d.id, d.ts, a.id, s.id, k.tool, d.verdict, d.stage, d.reason, coalesce(d.cut_edges, []), coalesce(d.cut_cost, 0), coalesce(k.hidden, false)
ORDER BY d.ts DESC LIMIT $limit
