// Org policies that deny one of the call's capabilities.
// params: {"caps": ["filesystem_write", "exec"]}
MATCH (p:Policy)-[r:DENIES]->(cp:Capability) WHERE cp.name IN $caps
RETURN startNode(r).name, labels(startNode(r))[0], type(r), endNode(r).name, labels(endNode(r))[0]
