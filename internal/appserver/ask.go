package appserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Aaditya1273/Vigil/internal/firewall"
	"github.com/Aaditya1273/Vigil/internal/graph"
	"github.com/Aaditya1273/Vigil/internal/mcp"
	"github.com/gorilla/mux"
)

// Ask the firewall: an agent can ask, before acting, what VIGIL would do.
// Every answer runs the same pipeline and graph queries as a real call
// (Firewall.DryRun) and records nothing.

type askFn func(ctx context.Context, args map[string]any) (summary string, body any, err error)

// askCall turns {tool, args, agent?, session_id?, repo?} into the firewall
// call the hook would make. tool may be a Claude Code name (Bash, Read, ...),
// a VIGIL name (run_command, ...) or an mcp__server__tool name. Identity
// defaults to the asking MCP session.
func askCall(ctx context.Context, in map[string]any, budget float64) (firewall.Call, map[string]any, error) {
	str := func(k string) string { v, _ := in[k].(string); return strings.TrimSpace(v) }
	name := str("tool")
	if name == "" {
		return firewall.Call{}, nil, fmt.Errorf("tool is required")
	}
	input, _ := in["args"].(map[string]any)
	if input == nil {
		input = map[string]any{}
	}
	tool, args := firewall.CanonicalTool(name, input)
	c := firewall.Call{Tool: tool, Args: args, Budget: budget, Agent: str("agent"), SessionID: str("session_id"), Repo: str("repo")}
	if s, ok := mcp.SessionFrom(ctx); ok {
		if c.Agent == "" {
			c.Agent = s.ClientName
		}
		if c.SessionID == "" {
			c.SessionID, c.SessionCost, c.Budget = s.ID, s.TotalCost, s.BudgetLimit
		}
	}
	if c.Agent == "" {
		c.Agent = "claude-code"
	}
	if c.SessionID == "" {
		c.SessionID = "ask"
	}
	return c, input, nil
}

func (st *stack) askHandlers(budget float64) map[string]askFn {
	return map[string]askFn{
		"will_this_be_allowed": func(ctx context.Context, in map[string]any) (string, any, error) {
			c, input, err := askCall(ctx, in, budget)
			if err != nil {
				return "", nil, err
			}
			res := st.fw.DryRun(ctx, c)
			reply := st.hookVerdict(ctx, res, c.Agent, c.Repo, c.Tool, c.Args, input)
			summary := fmt.Sprintf("%s (%s): %s", res.Decision, res.Stage, res.Reason)
			return summary, map[string]any{
				"decision": res.Decision, "stage": res.Stage, "reason": res.Reason,
				"hook_reply": reply, "graph_paths": res.GraphPaths, "cut": res.Cut, "signals": res.Signals,
				"graph_ms": res.GraphMS,
			}, nil
		},
		"what_will_this_touch": func(ctx context.Context, in map[string]any) (string, any, error) {
			c, _, err := askCall(ctx, in, budget)
			if err != nil {
				return "", nil, err
			}
			effects := st.fw.Predict(ctx, c)
			body := map[string]any{"predicted": effects}
			for _, e := range effects {
				if e.Kind == "package" {
					if br, err := st.graph.GetBlastRadius(ctx, e.Name); err == nil {
						body["package"] = map[string]any{"name": e.Name, "dependents": br.Dependents, "exposed_services": br.ExposedServices, "typosquat_of": br.SquatOf, "paths": br.Paths}
					}
				}
			}
			if rep, err := st.graph.Reputation(ctx, c.Tool); err == nil {
				body["scan_time_reputation"] = rep
			}
			if rt, err := st.graph.ToolRuntime(ctx, c.Tool); err == nil {
				body["runtime_record"] = rt
			}
			return fmt.Sprintf("%s is predicted to touch %d thing(s) (from its arguments and the tool's recorded effects).", c.Tool, len(effects)), body, nil
		},
		"why_was_this_blocked": func(ctx context.Context, in map[string]any) (string, any, error) {
			id, _ := in["decision_id"].(string)
			if strings.TrimSpace(id) == "" {
				return "", nil, fmt.Errorf("decision_id is required")
			}
			w, err := st.graph.Why(ctx, strings.TrimSpace(id))
			if err != nil {
				return "", nil, err
			}
			return w.Sentence, w, nil
		},
	}
}

var askTools = []mcp.Tool{
	{
		Name: "will_this_be_allowed",
		Description: "Before making a tool call, ask VIGIL what it would decide: ALLOW, PAUSE, BLOCK, or ALLOW with arguments " +
			"redacted by a min cut. Runs the same checks and graph queries as the real call and records nothing.",
		InputSchema: mcp.InputSchema{Type: "object", Required: []string{"tool"}, Properties: map[string]any{
			"tool":       map[string]any{"type": "string", "description": "Tool name: Bash, Read, run_command, mcp__dns__update, ..."},
			"args":       map[string]any{"type": "object", "description": "The arguments you would call it with"},
			"agent":      map[string]any{"type": "string", "description": "Optional: the agent identity to decide for (default: this MCP client)"},
			"session_id": map[string]any{"type": "string", "description": "Optional: VIGIL session id, e.g. cc-<claude session id> (default: this MCP session)"},
			"repo":       map[string]any{"type": "string", "description": "Optional: repo / working directory trust is earned in"},
		}},
	},
	{
		Name: "what_will_this_touch",
		Description: "Predict what a tool call would touch: files, hosts, packages and env vars from its arguments and what the " +
			"tool did before, the blast radius of any package, and the tool's scan-time and runtime reputation.",
		InputSchema: mcp.InputSchema{Type: "object", Required: []string{"tool"}, Properties: map[string]any{
			"tool": map[string]any{"type": "string"},
			"args": map[string]any{"type": "object"},
		}},
	},
	{
		Name:        "why_was_this_blocked",
		Description: "For a decision that stopped or rewrote a call: the single graph edge whose absence would have allowed it, in one sentence.",
		InputSchema: mcp.InputSchema{Type: "object", Required: []string{"decision_id"}, Properties: map[string]any{
			"decision_id": map[string]any{"type": "string"},
		}},
	},
}

// registerAskRoutes serves the three ask-the-firewall tools over MCP and as
// POST /vigil/ask/{tool}, plus scan-time vs runtime reputation per tool.
func (st *stack) registerAskRoutes(api *mux.Router, s *mcp.MCPServer, budget float64) {
	if !st.graph.Configured() {
		return
	}
	handlers := st.askHandlers(budget)
	run := func(ctx context.Context, name string, args map[string]any) (string, any, error) {
		ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		return handlers[name](ctx, args)
	}
	for _, t := range askTools {
		name := t.Name
		s.RegisterTool(t, func(ctx context.Context, args map[string]any) (*mcp.CallToolResult, error) {
			summary, body, err := run(ctx, name, args)
			if err != nil {
				return mcp.NewErrorResult(err.Error()), nil
			}
			raw, _ := json.MarshalIndent(body, "", "  ")
			return mcp.NewTextResult(summary + "\n\n" + string(raw)), nil
		})
	}

	// POST /vigil/ask/{tool}: the same tools for curl and the dashboard.
	api.HandleFunc("/vigil/ask/{tool}", requireControlAuth(func(w http.ResponseWriter, r *http.Request) {
		name := mux.Vars(r)["tool"]
		if handlers[name] == nil {
			writeErr(w, http.StatusNotFound, "unknown tool "+name)
			return
		}
		var args map[string]any
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&args); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}
		summary, body, err := run(r.Context(), name, args)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"summary": summary, "answer": body})
	})).Methods("POST", "OPTIONS")

	// GET /vigil/tools/{name}/reputation: what scanners said about the tool's
	// current version next to what its calls did here. POST re-ingests.
	api.HandleFunc("/vigil/tools/{name}/reputation", func(w http.ResponseWriter, r *http.Request) {
		tool := mux.Vars(r)["name"]
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		var unavailable []string
		if r.Method == http.MethodPost {
			_, unavailable = st.fw.IngestReputation(ctx, tool)
		}
		scan, err := st.graph.Reputation(ctx, tool)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "graph query failed: "+err.Error())
			return
		}
		rt, err := st.graph.ToolRuntime(ctx, tool)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "graph query failed: "+err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"tool": tool, "scan_time": nonNilScores(scan), "runtime": rt, "unavailable": unavailable,
			"note": "scan-time scores are EXTERNAL facts: a score under " + fmt.Sprint(graph.LowReputation) +
				" raises scrutiny, no score earns autonomy (only this tenant's clean USER_HISTORY does)",
		})
	}).Methods("GET", "POST", "OPTIONS")
}

// ingestMissingReputation fetches scan-time scores for tools whose current
// version has none yet, in the background: registration never waits on a
// third-party API.
func (st *stack) ingestMissingReputation(tools []string) {
	go func() {
		for _, t := range tools {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			if rep, err := st.graph.Reputation(ctx, t); err == nil && len(rep) == 0 {
				st.fw.IngestReputation(ctx, t)
			}
			cancel()
		}
	}()
}

func nonNilScores(s []graph.ExternalScore) []graph.ExternalScore {
	if s == nil {
		return []graph.ExternalScore{}
	}
	return s
}
