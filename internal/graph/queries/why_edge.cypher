// Does a named edge still exist? Used to confirm the edge a counterfactual names.
// params: {"from": "Jordan Blake", "rel": "IS_A", "to": "Customer"}
MATCH (a {name:$from})-[r]->(b {name:$to})
WHERE type(r) = $rel
RETURN count(r)
