// Decisions since a timestamp, for the digest.
// params: {"since": 0}
MATCH (d:Decision) WHERE d.ts >= $since
RETURN d.verdict, d.stage, d.model, d.graph_ms
