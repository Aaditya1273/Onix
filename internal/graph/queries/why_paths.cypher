// Every path through a decision's persisted influence network, as edge ids and kinds. An edge on all of them is a
// bridge: remove it and no tainted value reaches the call.
// params: {"call": "s1-1"}
MATCH p = (:FlowSource {call:$call})-[:FLOW*1..8]->(:FlowSink {call:$call})
RETURN [r IN relationships(p) | [id(r), r.kind]]
