// The decision to explain, with the call it decided.
// params: {"id": "s1-1"}
MATCH (s:Session)-[:MADE]->(k:Call)-[:DECIDED]->(d:Decision {id:$id})
OPTIONAL MATCH (a:Agent)-[:RAN]->(s)
RETURN d.verdict, d.stage, d.reason, k.tool, a.id, s.id, coalesce(d.cut_edges, []), coalesce(k.package, ''), coalesce(d.paths, [])
