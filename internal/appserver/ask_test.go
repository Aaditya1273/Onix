package appserver

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/Aaditya1273/Vigil/internal/firewall"
	"github.com/Aaditya1273/Vigil/internal/graph"
	"github.com/Aaditya1273/Vigil/internal/mcp"
	"github.com/gorilla/mux"
)

// Task 5: will_this_be_allowed answers with exactly the reply the Claude Code
// hook then gives for the same call, across a typosquat, a min-cut redaction,
// an entity block, earned autonomy and a plain allow.
func TestLiveAskReturnsTheHooksVerdict(t *testing.T) {
	url := os.Getenv("VIGIL_FALKORDB_URL")
	if url == "" {
		t.Skip("VIGIL_FALKORDB_URL not set")
	}
	t.Setenv("VIGIL_CONTROL_TOKEN", "")
	t.Setenv("VIGIL_MODE", "")
	logger := slog.New(slog.DiscardHandler)
	g, err := graph.New(url, fmt.Sprintf("ask_%d", time.Now().UnixNano()), logger)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := g.Seed(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { g.Delete(context.Background()) })

	st := &stack{fw: firewall.New(firewall.Deps{Logger: logger, Graph: g, TrustThreshold: 3,
		ReputationURLs: map[string]string{}}), graph: g}
	r := mux.NewRouter()
	st.registerHookRoutes(r, 2, nil)
	s := mcp.NewMCPServer(logger, ".")
	st.registerAskRoutes(r, s, 2)
	srv := httptest.NewServer(r)
	defer srv.Close()

	post := func(path string, body any) map[string]any {
		t.Helper()
		raw, _ := json.Marshal(body)
		resp, err := http.Post(srv.URL+path, "application/json", bytes.NewReader(raw))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || resp.StatusCode != 200 {
			t.Fatalf("%s: %d %v", path, resp.StatusCode, err)
		}
		return out
	}
	hook := func(event, tool string, input map[string]any, response any) map[string]any {
		return post("/vigil/hook", map[string]any{"session_id": "S", "cwd": "/repo", "hook_event_name": event,
			"tool_name": tool, "tool_input": input, "tool_response": response})
	}
	ask := func(tool string, input map[string]any) map[string]any {
		out := post("/vigil/ask/will_this_be_allowed", map[string]any{"tool": tool, "args": input,
			"agent": "claude-code", "session_id": "cc-S", "repo": "/repo"})
		return out["answer"].(map[string]any)["hook_reply"].(map[string]any)
	}
	same := func(name, tool string, input map[string]any) map[string]any {
		t.Helper()
		asked := ask(tool, input)
		got := hook("PreToolUse", tool, input, nil)
		if fmt.Sprint(asked) != fmt.Sprint(got) {
			t.Fatalf("%s:\n ask  %v\n hook %v", name, asked, got)
		}
		return got
	}

	secret := fmt.Sprintf("sk_live_%d", time.Now().UnixNano())
	hook("PreToolUse", "Read", map[string]any{"file_path": "/repo/.env"}, nil)
	hook("PostToolUse", "Read", map[string]any{"file_path": "/repo/.env"}, map[string]any{"file": map[string]any{"content": "KEY=" + secret + "\n"}})
	g.Flush()

	for i := 0; i < 3; i++ {
		same("ls before trust", "Bash", map[string]any{"command": "ls -la"})
		hook("PostToolUse", "Bash", map[string]any{"command": "ls -la"}, map[string]any{"stdout": "x"})
	}
	g.Flush()
	verdict := func(reply map[string]any) string {
		h, _ := reply["hookSpecificOutput"].(map[string]any)
		d, _ := h["permissionDecision"].(string)
		return d
	}
	if v := verdict(same("earned autonomy", "Bash", map[string]any{"command": "ls -la"})); v != "allow" {
		t.Fatalf("earned autonomy: %q", v)
	}
	if v := verdict(same("typosquat", "Bash", map[string]any{"command": "pip install reqeusts"})); v != "deny" {
		t.Fatalf("typosquat: %q", v)
	}
	if v := verdict(same("entity", "Bash", map[string]any{"command": "email the customer export to J. Blake"})); v != "deny" {
		t.Fatalf("entity: %q", v)
	}
	red := same("redact", "mcp__dns__dns_update", map[string]any{"name": "api", "txt": secret})
	if h := red["hookSpecificOutput"].(map[string]any); h["updatedInput"].(map[string]any)["txt"] != firewall.Redacted {
		t.Fatalf("redact: %v", red)
	}

	// Over MCP JSON-RPC, as an agent would ask it.
	params, _ := json.Marshal(map[string]any{"name": "will_this_be_allowed",
		"arguments": map[string]any{"tool": "Bash", "args": map[string]any{"command": "pip install reqeusts"}}})
	req, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": json.RawMessage(params)})
	resp := s.HandleRequest(ctx, req, "mcp-client")
	if raw, _ := json.Marshal(resp.Result); !bytes.Contains(raw, []byte("BLOCK (code_graph)")) {
		t.Fatalf("MCP tools/call: %s", raw)
	}

	g.Flush()
	rows, err := g.RecentDecisions(ctx, 20, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range rows {
		if d.Stage == firewall.StageCodeGraph {
			why := post("/vigil/ask/why_was_this_blocked", map[string]any{"decision_id": d.ID})["answer"].(map[string]any)
			if why["flips"] != true || why["edge"] != "reqeusts --[TYPOSQUAT_OF]--> requests" {
				t.Fatalf("why: %v", why)
			}
			return
		}
	}
	t.Fatal("no typosquat decision recorded by the hook")
}
