// Record what a call actually did, as reported by the harness after it ran.
// params: {"call": "s1-1", "effects": [{"kind": "file", "name": "src/app.go"}]}
MATCH (k:Call {id:$call})
UNWIND $effects AS e
MERGE (k)-[:OBSERVED]->(:ObservedEffect {call:$call, kind:e.kind, name:e.name})
