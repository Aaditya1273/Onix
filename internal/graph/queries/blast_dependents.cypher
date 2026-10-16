// Everything that depends on a package, up to 4 hops (reverse DEPENDS_ON closure).
// params: {"pkg": "body-parser"}
MATCH path = (:Package {name:$pkg})<-[:DEPENDS_ON*1..4]-()
UNWIND relationships(path) AS r
WITH DISTINCT r
RETURN startNode(r).name, labels(startNode(r))[0], type(r), endNode(r).name, labels(endNode(r))[0]
