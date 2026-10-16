// Maintainer risk: the PageRank mass (over DEPENDS_ON) each of a package's maintainers controls.
// Shape chosen to avoid FalkorDB 6.0.2 finding F1 (MATCH after an aggregation over CALL ... YIELD returns no rows).
// params: {"pkg": "body-parser"}
MATCH (m:Maintainer)-[:MAINTAINS]->(:Package {name:$pkg})
WITH collect(DISTINCT m) AS ms
CALL algo.pageRank('Package', 'DEPENDS_ON') YIELD node, score
MATCH (m:Maintainer)-[:MAINTAINS]->(node) WHERE m IN ms
RETURN m.name, sum(score) AS risk ORDER BY risk DESC
