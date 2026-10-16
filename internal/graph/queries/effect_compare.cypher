// Predicted vs observed effects of one call, side by side.
// params: {"call": "s1-1"}
MATCH (k:Call {id:$call})
OPTIONAL MATCH (k)-[:PREDICTED]->(p:PredictedEffect)
WITH k, collect(DISTINCT [p.kind, p.name]) AS predicted
OPTIONAL MATCH (k)-[:OBSERVED]->(o:ObservedEffect)
RETURN predicted, collect(DISTINCT [o.kind, o.name, coalesce(o.hidden, false)]), coalesce(k.hidden, false)
