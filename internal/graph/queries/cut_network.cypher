// The persisted influence network of one decision, with capacities and the cut, for rendering.
// params: {"call": "s1-2"}
MATCH (n)-[r:FLOW {call:$call}]->(m)
RETURN n.name, labels(n)[0], r.kind, m.name, labels(m)[0], r.cap, coalesce(r.cut, false)
