package firewall

import (
	"fmt"
	"strings"
)

// CanonicalTool maps an agent harness's tool (Claude Code, Codex, Gemini CLI) onto the tool vocabulary the policy
// layer has a capability model for. Anything else (mcp__* tools) keeps its
// name and is treated as capable of anything.
func CanonicalTool(name string, in map[string]any) (string, map[string]any) {
	str := func(k string) string { v, _ := in[k].(string); return v }
	switch name {
	case "Bash", "run_shell_command":
		return "run_command", map[string]any{"command": str("command")}
	case "shell", "local_shell", "exec_command": // Codex: command is an argv array or a string
		cmd := str("command")
		if argv, ok := in["command"].([]any); ok {
			parts := make([]string, 0, len(argv))
			for _, a := range argv {
				parts = append(parts, fmt.Sprint(a))
			}
			// bash -lc "<script>": the script is the command.
			if len(parts) == 3 && (parts[1] == "-lc" || parts[1] == "-c") {
				parts = parts[2:]
			}
			cmd = strings.Join(parts, " ")
		}
		return "run_command", map[string]any{"command": cmd}
	case "read_file", "read_many_files":
		p := str("file_path")
		if p == "" {
			p = str("absolute_path")
		}
		if p == "" {
			p = str("path")
		}
		return "read_file", map[string]any{"path": p}
	case "write_file", "replace", "apply_patch":
		p := str("file_path")
		if p == "" {
			p = str("path")
		}
		return "write_file", map[string]any{"path": p}
	case "web_fetch":
		u := str("url")
		if u == "" {
			u = str("prompt")
		}
		return "web_fetch", map[string]any{"url": u, "prompt": str("prompt")}
	case "google_web_search":
		return "web_search", map[string]any{"query": str("query")}
	case "Read":
		return "read_file", map[string]any{"path": str("file_path")}
	case "Write", "Edit", "MultiEdit", "NotebookEdit":
		p := str("file_path")
		if p == "" {
			p = str("notebook_path")
		}
		return "write_file", map[string]any{"path": p}
	case "Glob", "LS":
		return "list_directory", map[string]any{"path": str("path"), "pattern": str("pattern")}
	case "Grep":
		return "search_code", map[string]any{"pattern": str("pattern"), "path": str("path")}
	case "WebFetch":
		return "web_fetch", map[string]any{"url": str("url"), "prompt": str("prompt")}
	case "WebSearch":
		return "web_search", map[string]any{"query": str("query")}
	}
	return name, in
}

// RedactSecrets masks every value the secret detectors recognize, for
// anything shown or stored outside the graph (which only ever holds hashes).
func RedactSecrets(text string) string {
	for _, v := range secretValues(text) {
		text = strings.ReplaceAll(text, v, "[secret]")
	}
	return text
}
