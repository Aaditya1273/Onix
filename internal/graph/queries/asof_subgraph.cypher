// Time travel: the subgraph around one call as it stood at time $t. Every edge is returned only if it existed then (its call's ts <= $t), so a cross-session path appears hop by hop. No snapshot: one filtered query over the live graph.
// params: {"id": "s7-2", "t": 9000000000000000000}
MATCH (e:Call {id:$id})-[:ARG_CONTAINS]->(v:Value)<-[:READ]-(r:Call)<-[:MADE]-(sr:Session)
WHERE r.ts <= $t
RETURN sr.id AS f, 'session' AS fk, 'MADE' AS rel, r.id AS t2, CASE WHEN coalesce(r.label, '') = '' THEN r.tool ELSE r.label END AS tl, 'call' AS tk, r.ts AS ts
UNION ALL
MATCH (e:Call {id:$id})-[:ARG_CONTAINS]->(v:Value)<-[:READ]-(r:Call)
WHERE r.ts <= $t
RETURN r.id AS f, 'call' AS fk, 'READ' AS rel, 'value#' + left(v.hash, 12) AS t2, CASE WHEN v.sensitive THEN 'secret' ELSE 'value' END AS tl, 'value' AS tk, r.ts AS ts
UNION ALL
MATCH (se:Session)-[:MADE]->(e:Call {id:$id})
WHERE e.ts <= $t
RETURN se.id AS f, 'session' AS fk, 'MADE' AS rel, e.id AS t2, CASE WHEN coalesce(e.label, '') = '' THEN e.tool ELSE e.label END AS tl, 'call' AS tk, e.ts AS ts
UNION ALL
MATCH (e:Call {id:$id})-[:ARG_CONTAINS]->(v:Value)
WHERE e.ts <= $t
RETURN 'value#' + left(v.hash, 12) AS f, 'value' AS fk, 'ARG_CONTAINS' AS rel, e.id AS t2, CASE WHEN coalesce(e.label, '') = '' THEN e.tool ELSE e.label END AS tl, 'call' AS tk, e.ts AS ts
UNION ALL
MATCH (e:Call {id:$id})-[:DECIDED]->(d:Decision)
WHERE e.ts <= $t
RETURN e.id AS f, 'call' AS fk, 'DECIDED' AS rel, 'decision ' + d.id AS t2, d.verdict + ' · ' + d.stage AS tl, 'decision' AS tk, e.ts AS ts
UNION ALL
MATCH (e:Call {id:$id})-[:DECIDED]->(d:Decision)-[:PREV]->(p:Decision)
WHERE e.ts <= $t AND p.ts <= $t
RETURN 'decision ' + d.id AS f, 'decision' AS fk, 'PREV' AS rel, 'decision ' + p.id AS t2, p.verdict + ' · ' + p.stage AS tl, 'decision' AS tk, p.ts AS ts
