// Record one playground attempt (input already stripped of secrets). new_signal: the first attempt stopped with this stage and signal set.
// params: {"id": "a1", "ts": 1, "scenario": "freeform", "input": "pip install reqeusts", "verdict": "BLOCK", "stage": "code_graph", "signature": "code_graph", "unsafe": false}
OPTIONAL MATCH (prev:Attempt {signature:$signature}) WHERE prev.verdict <> 'ALLOW'
WITH count(prev) AS seen
CREATE (a:Attempt {id:$id, ts:$ts, scenario:$scenario, input:$input, verdict:$verdict, stage:$stage, signature:$signature,
                   unsafe:$unsafe, new_signal: ($verdict <> 'ALLOW' AND seen = 0)})
RETURN a.new_signal
