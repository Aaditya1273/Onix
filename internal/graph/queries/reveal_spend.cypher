// Reveal: recorded session cost and exact repeats, for an estimate of what repeated identical calls cost.
// params: {}
MATCH (s:Session) WHERE s.calls > 0
RETURN count(s), sum(CASE WHEN s.cost_usd >= 0 THEN 1 ELSE 0 END), sum(CASE WHEN s.cost_usd >= 0 THEN s.cost_usd ELSE 0 END),
       sum(s.repeats), sum(CASE WHEN s.cost_usd >= 0 THEN s.cost_usd * s.repeats / s.calls ELSE 0 END)
