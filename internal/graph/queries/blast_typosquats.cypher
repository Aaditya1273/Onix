// TYPOSQUAT_OF edges in either direction.
// params: {"pkg": "lodash"}
MATCH (a:Package)-[r:TYPOSQUAT_OF]->(b:Package)
WHERE a.name = $pkg OR b.name = $pkg
RETURN startNode(r).name, labels(startNode(r))[0], type(r), endNode(r).name, labels(endNode(r))[0]
