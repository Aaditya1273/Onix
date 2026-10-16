# FalkorDB findings

Engine behavior we hit while building VIGIL, each with a minimal reproduction. Versions:

- **6.0.2**: `docker run falkordb/falkordb:6.0.2` (what `docker-compose.yaml` pins)
- **4.22.1**: `docker run falkordb/falkordb:latest` (on Oct 15, 2026, `latest` still pointed at 4.22.1, not 6.x)

Every reproduction below is run with `redis-cli GRAPH.QUERY <graph> "<query>"` on an empty graph.

---

## F1 · 6.0.2: `MATCH` after an aggregation over `CALL … YIELD` returns no rows

**Status:** open. **Regression:** yes; 4.22.1 returns the correct row.

```cypher
CREATE (a:Package {name:'a'})-[:DEPENDS_ON]->(b:Package {name:'b'}),
       (m:Maintainer {name:'m'})-[:MAINTAINS]->(b)
```
```cypher
CALL algo.pageRank('Package','DEPENDS_ON') YIELD node, score
MATCH (m:Maintainer)-[:MAINTAINS]->(node)
WITH m, sum(score) AS risk
MATCH (m)-[:MAINTAINS]->(p:Package)
RETURN m.name, risk, p.name
```

| Version | Result |
|---|---|
| 4.22.1 | `m, 0.48…, b` (correct) |
| 6.0.2 | **empty** |

Narrowing it down, on 6.0.2 all of these return the correct row:
- the same query without the final `MATCH`;
- the same shape with `UNWIND [1] AS x` in place of the `CALL`;
- the same shape with a plain `MATCH … WITH m, count(p) AS n MATCH (m)-…`.

So it takes the combination of a procedure call, then an aggregation, then a traversal from the grouped node.

**How VIGIL handles it (not silently).** Maintainer risk
([`maintainer_pagerank.cypher`](internal/graph/queries/maintainer_pagerank.cypher)) collects the package's maintainers
*before* the `CALL` and aggregates in `RETURN`, which gives the correct answer on both versions. The file says why.

---

## F2 · 6.0.2: "Variable not found" for a variable carried through an aggregating `WITH`

**Status:** open. **Regression:** yes; 4.22.1 runs it.

```cypher
CREATE (:M {name:'m'})-[:R]->(:P {name:'b'})
```
```cypher
MATCH (m:M) WITH m, count(*) AS c
MATCH (x:M) WHERE id(x) = id(m)
MATCH (x)-[:R]->(p:P)
RETURN x.name, p.name
```

| Version | Result |
|---|---|
| 4.22.1 | `m, b` |
| 6.0.2 | **error: `Variable m not found`** |

`m` is projected by the `WITH`, so it is in scope. VIGIL does not use this shape.

---

## Observations (not bugs)

- **O1 · PageRank scale differs between versions.** On the same 3-node graph, 4.22.1 returns scores that don't sum
  to 1 (e.g. `0.48, 0.26`); 6.0.2 returns scores that do (`0.649, 0.351`). VIGIL only uses PageRank to *rank*
  maintainers, so the ordering is what matters; absolute values are not comparable across versions.
- **O2 · `algo.maxFlow` returns flows, not the cut.** It yields `nodes, edges, edgeFlows, maxFlow`, as documented.
  The minimum cut has to be derived from the flows; see the README section "The database computes the cut" for how
  VIGIL's capacities make that derivation unambiguous.
- **O3 · Default query timeout.** The 6.0.2 image starts with `FALKORDB_ARGS=... TIMEOUT 1000 ...` (1 s). Every VIGIL
  query is far below that, but a long ingest written as one query would hit it.
