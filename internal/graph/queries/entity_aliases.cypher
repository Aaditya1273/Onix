// SAME_AS alias edges around a person, up to 3 hops.
// params: {"name": "j. blake"}
MATCH path = (:Person {name_lc:$name})-[:SAME_AS*1..3]-(:Person)
UNWIND relationships(path) AS r
WITH DISTINCT r
RETURN startNode(r).name, labels(startNode(r))[0], type(r), endNode(r).name, labels(endNode(r))[0]
