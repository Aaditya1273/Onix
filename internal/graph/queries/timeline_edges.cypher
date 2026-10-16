// SUPERSEDES and DERIVED_FROM edges between matching facts.
// params: {"words": ["on-call"]}
MATCH (f:Fact)-[r:SUPERSEDES|DERIVED_FROM]->(:Fact)
WHERE size($words) = 0 OR any(w IN $words WHERE toLower(f.text) CONTAINS w OR f.subject_lc CONTAINS w)
RETURN startNode(r).name, labels(startNode(r))[0], type(r), endNode(r).name, labels(endNode(r))[0]
