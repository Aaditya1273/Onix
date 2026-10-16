// Which of these value hashes has any session read, and where.
// params: {"hashes": ["0000000000000000000000000000000000000000000000000000000000000000"]}
MATCH (s:Session)-[:MADE]->(k:Call)-[:READ]->(v:Value)
WHERE v.hash IN $hashes
RETURN v.hash, v.sensitive, v.trust_rank, s.id, k.tool, k.ts
ORDER BY k.ts
