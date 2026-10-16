// Stored daily risk snapshots since a day, oldest first.
// params: {"fromDay": "2026-01-01"}
MATCH (r:RiskSnapshot) WHERE r.day >= $fromDay
RETURN r.scope, r.day, r.score, r.components ORDER BY r.day, r.scope
