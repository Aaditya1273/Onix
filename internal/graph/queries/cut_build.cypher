// Build the influence network for one proposed call (PACE-style path confinement, persisted in the graph).
// source -> proxy of each committed call that READ a tainted value -> proxy of the Value -> ArgSlot (one per argument) -> Effect -> sink.
// Proxies (FlowRead, FlowValue) point at the real Call / Value through COPY_OF; they exist because FalkorDB 6.0.2's
// maxFlow takes exactly one relationship type and refuses parallel edges of that type anywhere in the graph
// (FALKORDB_FINDINGS F3, F4), and two calls' networks would otherwise share the same committed edge.
// Committed edges carry $inf; severing an argument costs $redactCap (or $inf for a fixed one: a destination); blocking the call costs $blockCap.
// params: {"call": "s1-2", "tool": "dns_update", "args": [{"key": "txt", "hashes": ["0000000000000000000000000000000000000000000000000000000000000000"], "fixed": false}, {"key": "ttl", "hashes": [], "fixed": false}], "redactCap": 2, "blockCap": 3, "inf": 1000000}
CREATE (src:FlowSource {call:$call, name:'source'})
CREATE (eff:Effect {call:$call, tool:$tool, name:'effect: ' + $tool})
CREATE (eff)-[:FLOW {kind:'terminal', cap:$blockCap, call:$call}]->(:FlowSink {call:$call, name:'sink'})
WITH src, eff
UNWIND $args AS a
CREATE (slot:ArgSlot {call:$call, key:a.key, name:'arg: ' + a.key})-[:FLOW {kind:'arg', cap:CASE WHEN a.fixed THEN $inf ELSE $redactCap END, call:$call, key:a.key}]->(eff)
WITH src, slot, a
UNWIND a.hashes AS h
MATCH (v:Value {hash:h})
MERGE (fv:FlowValue {call:$call, hash:h})
ON CREATE SET fv.name = 'value#' + left(h, 12)
MERGE (fv)-[:COPY_OF]->(v)
CREATE (fv)-[:FLOW {kind:'taints', cap:$inf, call:$call}]->(slot)
WITH DISTINCT src, v, fv
MATCH (s:Session)-[:MADE]->(k:Call)-[:READ]->(v)
MERGE (fk:FlowRead {call:$call, ref:k.id})
ON CREATE SET fk.name = k.tool + ' @ ' + s.id
MERGE (fk)-[:COPY_OF]->(k)
MERGE (src)-[e1:FLOW {kind:'source', call:$call}]->(fk)
ON CREATE SET e1.cap = $inf
MERGE (fk)-[e2:FLOW {kind:'read', call:$call}]->(fv)
ON CREATE SET e2.cap = $inf
