// What a replayed session cost (from the harness's own cost record; -1 when it kept none) and how many of its calls repeated the previous one exactly.
// params: {"session": "cc-s1", "source": "claude-code", "cost": 1.5, "calls": 40, "repeats": 3}
MATCH (s:Session {id:$session})
SET s.source = $source, s.cost_usd = $cost, s.calls = $calls, s.repeats = $repeats
