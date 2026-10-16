// Entity types a person resolves to through aliases, and the policies that deny them.
// params: {"name": "j. blake"}
MATCH (:Person {name_lc:$name})-[:SAME_AS*0..3]-(who:Person)
MATCH (who)-[isa:IS_A]->(t:EntityType)
OPTIONAL MATCH (pol:Policy)-[den:DENIES]->(t)
UNWIND [isa, den] AS r
WITH DISTINCT r WHERE r IS NOT NULL
RETURN startNode(r).name, labels(startNode(r))[0], type(r), endNode(r).name, labels(endNode(r))[0]
