// The committed read behind a network's read edge, and the earlier Decision that let it happen (walking the chain).
// params: {"rid": 0}
MATCH (fk:FlowRead)-[r:FLOW]->(fv:FlowValue) WHERE id(r) = $rid
MATCH (fk)-[:COPY_OF]->(k:Call)<-[:MADE]-(s:Session)
OPTIONAL MATCH (k)-[:DECIDED]->(d:Decision)
RETURN k.tool, s.id, k.ts, fv.name, d.id
