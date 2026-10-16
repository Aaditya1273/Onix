// A tool's current description hash.
// params: {"tool": "dns_update"}
MATCH (t:Tool {name:$tool}) RETURN t.version
