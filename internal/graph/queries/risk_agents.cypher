// Agent Risk Score inputs, per agent, since a timestamp: decisions, incidents, trust revocations by tool change,
// hidden side effects, decisions with no model, executed-call costs, and packages it was allowed to install.
// params: {"since": 0}
MATCH (a:Agent)-[:RAN]->(:Session)-[:MADE]->(k:Call)-[:DECIDED]->(d:Decision)
WHERE d.ts >= $since
WITH a.id AS agent, collect(d) AS ds, collect(k) AS ks
RETURN agent, size(ds),
  size([x IN ds WHERE x.verdict <> 'ALLOW']),
  size([x IN ds WHERE x.stage = 'tool_drift']),
  size([x IN ks WHERE x.hidden = true]),
  size([x IN ds WHERE coalesce(x.model, '') = '']),
  [x IN ks WHERE x.cost IS NOT NULL | x.cost],
  [x IN ks WHERE x.decision = 'ALLOW' AND coalesce(x.package, '') <> '' | x.package]
