// How often this agent went from prev to each next tool.
// params: {"agent": "claude-code", "prev": "read_file"}
MATCH (:Tool {name:$prev})-[r:THEN {agent:$agent}]->(n:Tool)
RETURN n.name, r.count
