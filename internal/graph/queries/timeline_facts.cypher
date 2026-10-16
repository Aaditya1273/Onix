// Facts matching any keyword, oldest first.
// params: {"words": ["on-call", "engineer"]}
MATCH (f:Fact)
WHERE size($words) = 0 OR any(w IN $words WHERE toLower(f.text) CONTAINS w OR f.subject_lc CONTAINS w)
RETURN f.id, f.subject, f.text, f.trust, f.valid_from, f.valid_to
ORDER BY f.valid_from
