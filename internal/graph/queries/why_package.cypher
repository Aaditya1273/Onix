// The graph facts that blocked an install: a TYPOSQUAT_OF edge, if any.
// params: {"pkg": "reqeusts"}
OPTIONAL MATCH (p:Package {name:$pkg})-[:TYPOSQUAT_OF]->(real:Package)
RETURN real.name
