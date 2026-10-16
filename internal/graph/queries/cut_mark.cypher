// Mark the edges the cut severs, so the dashboard can render the network with the cut highlighted.
// params: {"call": "s1-2", "keys": ["txt"], "terminal": false}
MATCH (eff:Effect {call:$call})
OPTIONAL MATCH (:ArgSlot {call:$call})-[a:FLOW {kind:'arg'}]->(eff) WHERE a.key IN $keys
OPTIONAL MATCH (eff)-[t:FLOW {kind:'terminal'}]->(:FlowSink {call:$call})
FOREACH (_ IN CASE WHEN a IS NULL THEN [] ELSE [1] END | SET a.cut = true)
FOREACH (_ IN CASE WHEN $terminal AND t IS NOT NULL THEN [1] ELSE [] END | SET t.cut = true)
