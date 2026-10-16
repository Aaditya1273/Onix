// Reveal: calls, sessions, agents, time span, calls blocked, paused for a human, rewritten, and run without a prompt.
// params: {}
MATCH (a:Agent)-[:RAN]->(s:Session)-[:MADE]->(k:Call)-[:DECIDED]->(d:Decision)
RETURN count(k), count(DISTINCT s), count(DISTINCT a), min(k.ts), max(k.ts),
       sum(CASE WHEN d.verdict = 'BLOCK' THEN 1 ELSE 0 END), sum(CASE WHEN d.verdict = 'PAUSE' THEN 1 ELSE 0 END),
       sum(CASE WHEN d.stage = 'redact' THEN 1 ELSE 0 END),
       sum(CASE WHEN k.autonomous = true THEN 1 ELSE 0 END)
