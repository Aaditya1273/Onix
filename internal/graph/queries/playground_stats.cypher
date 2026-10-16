// The public counter: attempts, attempts that reached an unsafe effect, attempts that produced a new signal.
// params: {}
MATCH (a:Attempt)
RETURN count(a), sum(CASE WHEN a.unsafe THEN 1 ELSE 0 END), sum(CASE WHEN a.new_signal THEN 1 ELSE 0 END)
