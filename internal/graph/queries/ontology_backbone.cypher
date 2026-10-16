// The identity and policy backbone of the graph.
// params: {}
MATCH ()-[r:SAME_AS|IS_A|DENIES|CONTRADICTS]->()
RETURN startNode(r).name, labels(startNode(r))[0], type(r), endNode(r).name, labels(endNode(r))[0] LIMIT 300
