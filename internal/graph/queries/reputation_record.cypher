// Attach a scan-time reputation score to a tool's current version as an EXTERNAL fact (trust rank 0).
// params: {"tool": "mcp__dns__update", "source": "craftedtrust", "server": "dns", "score": 82.0, "label": "B", "url": "https://github.com/x/dns", "text": "craftedtrust rates dns 82 (B)", "ts": 1}
MATCH (t:Tool {name:$tool})-[:HAS_VERSION]->(v:ToolVersion) WHERE v.hash = t.version
MERGE (f:Fact {id: $source + ':' + $tool + ':' + v.hash})
SET f.subject = 'reputation of ' + $tool, f.subject_lc = toLower('reputation of ' + $tool), f.name = $source + ': ' + $server,
    f.text = $text, f.trust = 'EXTERNAL', f.trust_rank = 0, f.source = $source, f.score = $score, f.label = $label,
    f.url = $url, f.valid_from = $ts
MERGE (f)-[:ABOUT]->(v)
RETURN f.id
