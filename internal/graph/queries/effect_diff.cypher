// Shadow execution: every observed effect the prediction did not cover (same kind and name, or a file inside a
// predicted directory) is a hidden secondary effect. Marks it, and the call, and returns it.
// params: {"call": "s1-1"}
MATCH (k:Call {id:$call})-[:OBSERVED]->(o:ObservedEffect)
OPTIONAL MATCH (k)-[:PREDICTED]->(p:PredictedEffect {kind:o.kind})
WITH k, o, collect(p.name) AS preds
WHERE none(n IN preds WHERE n = o.name OR (o.kind = 'file' AND o.name STARTS WITH (n + '/')))
SET o.hidden = true, k.hidden = true
RETURN o.kind, o.name
