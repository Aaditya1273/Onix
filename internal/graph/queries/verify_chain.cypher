// Walk the mirrored decision chain: every PREV edge must reach exactly the hash it names.
// params: {}
MATCH (d:Decision) WHERE d.prev_hash <> ''
OPTIONAL MATCH (d)-[:PREV]->(p:Decision)
RETURN count(d), sum(CASE WHEN p IS NULL OR p.hash <> d.prev_hash THEN 1 ELSE 0 END)
