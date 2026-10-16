package appserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Aaditya1273/Vigil/internal/firewall"
	"github.com/Aaditya1273/Vigil/internal/mcp"
	"github.com/Aaditya1273/Vigil/internal/vigil"
	"github.com/gorilla/mux"
)

// hookInput is what Claude Code sends a PreToolUse / PostToolUse hook on
// stdin; vigil-cli hook forwards it here verbatim, adding vigil_agent.
type hookInput struct {
	SessionID    string         `json:"session_id"`
	Cwd          string         `json:"cwd"`
	Event        string         `json:"hook_event_name"`
	ToolName     string         `json:"tool_name"`
	ToolInput    map[string]any `json:"tool_input"`
	ToolResponse any            `json:"tool_response"`
	Agent        string         `json:"vigil_agent"`
}

// canonicalTool maps a Claude Code tool onto the tool vocabulary the policy
// layer has a capability model for. Anything else (mcp__* tools) keeps its
// name and is treated as capable of anything.
func canonicalTool(name string, in map[string]any) (string, map[string]any) {
	str := func(k string) string { v, _ := in[k].(string); return v }
	switch name {
	case "Bash":
		return "run_command", map[string]any{"command": str("command")}
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

// hookReply speaks Claude Code's PreToolUse output: deny, ask, allow, or an
// empty object for "no opinion, use the normal permission flow".
func hookReply(decision, reason string) map[string]any {
	if decision == "" {
		return map[string]any{}
	}
	return map[string]any{"hookSpecificOutput": map[string]any{
		"hookEventName":            "PreToolUse",
		"permissionDecision":       decision,
		"permissionDecisionReason": reason,
	}}
}

// hookRewrite allows the call with its input replaced (Claude Code applies
// updatedInput before the tool runs).
func hookRewrite(reason string, input map[string]any) map[string]any {
	out := hookReply("allow", reason)
	out["hookSpecificOutput"].(map[string]any)["updatedInput"] = input
	return out
}

// textOf flattens a tool response to the text an agent actually saw.
func textOf(v any) string {
	var b strings.Builder
	var walk func(any)
	walk = func(v any) {
		switch x := v.(type) {
		case string:
			b.WriteString(x)
			b.WriteByte('\n')
		case map[string]any:
			for _, e := range x {
				walk(e)
			}
		case []any:
			for _, e := range x {
				walk(e)
			}
		}
	}
	walk(v)
	return b.String()
}

func failed(v any) bool {
	m, ok := v.(map[string]any)
	if !ok {
		return false
	}
	if s, ok := m["success"].(bool); ok && !s {
		return true
	}
	if e, ok := m["is_error"].(bool); ok && e {
		return true
	}
	return m["error"] != nil
}

// hookVerdict is the PreToolUse reply for a decided call. The hook and the
// will_this_be_allowed MCP tool both answer through it.
func (st *stack) hookVerdict(ctx context.Context, res firewall.Result, agent, repo, tool string, args, input map[string]any) map[string]any {
	switch res.Decision {
	case firewall.Block:
		return hookReply("deny", "Vigil: "+res.Reason)
	case firewall.Pause:
		return hookReply("ask", "Vigil: "+res.Reason)
	}
	if len(res.RedactTokens) > 0 {
		// FalkorDB's min cut severed only some arguments: run the call with
		// those values redacted, in the caller's own argument names.
		return hookRewrite("Vigil: "+res.Reason, firewall.Redact(input, res.RedactTokens))
	}
	// Allowed is not the same as autonomous: skip the human prompt only when
	// this agent has earned it for this exact shape of call in this repo.
	// Otherwise Claude Code asks as it normally would.
	if tr, earned := st.fw.EarnedTrust(ctx, agent, repo, tool, args); earned {
		return hookReply("allow", "Vigil: earned autonomy, "+strconv.FormatInt(tr.Clean, 10)+" clean runs since the last incident")
	}
	return hookReply("", "")
}

func (st *stack) registerHookRoutes(api *mux.Router, budgetLimit float64, ownTools []mcp.Tool) {
	// observe: decide and record everything, enforce nothing. The README's
	// day one: the graph fills, and day two shows what would have been
	// blocked and how much autonomy was earned.
	observe := strings.EqualFold(vigil.Env("MODE"), "observe")

	// POST /vigil/hook: Claude Code's PreToolUse and PostToolUse, via
	// `vigil-cli hook`. Trust is earned per agent and per repo (cwd).
	api.HandleFunc("/vigil/hook", requireControlAuth(func(w http.ResponseWriter, r *http.Request) {
		var in hookInput
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid hook payload: "+err.Error())
			return
		}
		if in.Agent == "" {
			in.Agent = "claude-code"
		}
		session := "cc-" + in.SessionID
		tool, args := canonicalTool(in.ToolName, in.ToolInput)

		if in.Event == "PostToolUse" {
			ok := !failed(in.ToolResponse)
			st.fw.Commit(session, tool, 0, 0, ok)
			if ok {
				st.fw.Observe(session, tool, args, textOf(in.ToolResponse))
				st.fw.ObserveEffects(session, tool, args, in.ToolResponse)
			}
			writeJSON(w, http.StatusOK, map[string]any{})
			return
		}

		res := st.fw.Check(r.Context(), firewall.Call{
			SessionID: session, Agent: in.Agent, Repo: in.Cwd,
			Tool: tool, Args: args, Budget: budgetLimit,
		})
		if observe {
			writeJSON(w, http.StatusOK, hookReply("", ""))
			return
		}
		writeJSON(w, http.StatusOK, st.hookVerdict(r.Context(), res, in.Agent, in.Cwd, tool, args, in.ToolInput))
	})).Methods("POST", "OPTIONS")

	// POST /vigil/tools: an MCP gateway (or anything that can see tools/list)
	// registers tool descriptions. A changed description is a rug pull.
	api.HandleFunc("/vigil/tools", requireControlAuth(func(w http.ResponseWriter, r *http.Request) {
		if !st.graph.Configured() {
			writeErr(w, http.StatusServiceUnavailable, "FalkorDB is not configured (VIGIL_FALKORDB_URL unset)")
			return
		}
		var tools []mcp.Tool
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&tools); err != nil {
			writeErr(w, http.StatusBadRequest, "expected [{name, description}]: "+err.Error())
			return
		}
		changed := []string{}
		for _, t := range tools {
			c, err := st.graph.RecordToolVersion(r.Context(), t.Name, t.Description)
			if err != nil {
				writeErr(w, http.StatusBadGateway, "graph write failed: "+err.Error())
				return
			}
			if c {
				changed = append(changed, t.Name)
			}
		}
		names := make([]string, len(tools))
		for i, t := range tools {
			names[i] = t.Name
		}
		st.ingestMissingReputation(names)
		writeJSON(w, http.StatusOK, map[string]any{"registered": len(tools), "changed": changed})
	})).Methods("POST", "OPTIONS")

	// GET /vigil/digest?days=7: what was blocked, what autonomy was earned,
	// how many decisions never touched a model, and what the graph cost.
	api.HandleFunc("/vigil/digest", func(w http.ResponseWriter, r *http.Request) {
		if !st.graph.Configured() {
			writeErr(w, http.StatusServiceUnavailable, "FalkorDB is not configured (VIGIL_FALKORDB_URL unset)")
			return
		}
		days := 7
		if n, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil && n > 0 {
			days = n
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		d, err := st.graph.GetDigest(ctx, time.Now().Add(-time.Duration(days)*24*time.Hour).UnixNano(), st.fw.TrustThreshold())
		if err != nil {
			writeErr(w, http.StatusBadGateway, "graph query failed: "+err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"days": days, "observe_mode": observe, "trust_threshold": st.fw.TrustThreshold(), "digest": d})
	}).Methods("GET", "OPTIONS")

	// Vigil's own MCP tools are registered like anyone else's, so a deploy
	// that changes one of their descriptions is caught too.
	if st.graph.Configured() {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			for _, t := range ownTools {
				if _, err := st.graph.RecordToolVersion(ctx, t.Name, t.Description); err != nil {
					return
				}
			}
		}()
	}
}
