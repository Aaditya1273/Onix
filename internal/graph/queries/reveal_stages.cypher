// Reveal: what would have been stopped or rewritten, by verdict and stage.
// params: {}
MATCH (k:Call)-[:DECIDED]->(d:Decision) WHERE d.verdict <> 'ALLOW' OR d.stage = 'redact'
RETURN d.verdict, d.stage, count(*) ORDER BY count(*) DESC
