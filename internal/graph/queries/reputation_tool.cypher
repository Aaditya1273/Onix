// Scan-time reputation: the EXTERNAL facts about a tool's current version. A rug pull makes a new version, so an old score no longer applies.
// params: {"tool": "mcp__dns__update"}
MATCH (t:Tool {name:$tool})-[:HAS_VERSION]->(v:ToolVersion) WHERE v.hash = t.version
MATCH (f:Fact)-[:ABOUT]->(v)
RETURN f.source, f.score, f.label, f.url, f.trust, f.trust_rank, f.valid_from
ORDER BY f.source
