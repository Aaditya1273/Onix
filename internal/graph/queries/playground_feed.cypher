// The anonymized feed: the latest attempts, inputs already stripped of secrets, no client identity stored.
// params: {"limit": 15}
MATCH (a:Attempt)
RETURN a.ts, a.scenario, a.input, a.verdict, a.stage, a.unsafe, a.new_signal
ORDER BY a.ts DESC LIMIT $limit
