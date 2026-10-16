// Strengthen the prev -> tool behavior edge for an agent.
// params: {"agent": "claude-code", "prev": "read_file", "tool": "run_command"}
MERGE (a:Tool {name:$prev})
MERGE (b:Tool {name:$tool})
MERGE (a)-[r:THEN {agent:$agent}]->(b)
ON CREATE SET r.count = 1
ON MATCH SET r.count = r.count + 1
