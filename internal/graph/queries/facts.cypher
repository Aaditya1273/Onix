// Facts about a subject with their provenance authority (min trust over DERIVED_FROM ancestors).
// params: {"subject": "on-call engineer"}
MATCH (f:Fact) WHERE f.subject_lc CONTAINS $subject
OPTIONAL MATCH (f)-[:DERIVED_FROM*0..5]->(src:Fact)
WITH f, min(src.trust_rank) AS authority
RETURN f.id, f.subject, f.text, f.trust, authority, f.valid_from, f.valid_to
ORDER BY f.valid_from
