// A package's maintainers and everything else they maintain.
// params: {"pkg": "body-parser"}
MATCH (m:Maintainer)-[:MAINTAINS]->(:Package {name:$pkg})
MATCH (m)-[r:MAINTAINS]->(:Package)
RETURN startNode(r).name, labels(startNode(r))[0], type(r), endNode(r).name, labels(endNode(r))[0]
