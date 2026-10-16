// Every edge around one named node.
// params: {"name": "sam"}
MATCH (n) WHERE toLower(n.name) = $name
MATCH (n)-[r]-()
RETURN startNode(r).name, labels(startNode(r))[0], type(r), endNode(r).name, labels(endNode(r))[0] LIMIT 300
