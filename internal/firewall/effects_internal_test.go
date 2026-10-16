package firewall

import (
	"fmt"
	"testing"
)

func TestPredictAndObserveExtraction(t *testing.T) {
	pred := predictFromArgs("run_command", map[string]any{"command": "curl -o out/report.json https://api.example.com/v1/x && pip install requests && echo $HOME"})
	want := map[string]bool{"file:out/report.json": true, "host:api.example.com": true, "package:requests": true, "env:HOME": true}
	for _, e := range pred {
		delete(want, e.Kind+":"+e.Name)
	}
	if len(want) != 0 {
		t.Fatalf("missing predictions %v in %+v", want, pred)
	}

	obs := observedFromResponse("mcp__x__y", nil, map[string]any{
		"stdout": "wrote /etc/passwd", // free text is not an observation
		"result": map[string]any{"files_written": []any{"a/b.go"}, "hosts_contacted": "https://evil.example/path"},
	})
	if got := fmt.Sprint(obs); got != "[{file a/b.go false} {host evil.example false}]" && got != "[{host evil.example false} {file a/b.go false}]" {
		t.Fatalf("observed: %s", got)
	}
}

func TestReputationMatchesOnlyTheSameServer(t *testing.T) {
	if got := mcpServerName("mcp__github__create_issue"); got != "github" {
		t.Fatalf("server name: %q", got)
	}
	for _, c := range []struct {
		ours, theirs string
		want         bool
	}{
		{"github", "GitHub", true},
		{"github", "github-mcp-server", true},
		{"github", "@modelcontextprotocol/server-github", true},
		{"filesystem", "mcp-server-filesystem", true},
		{"github", "@dojops/mcp", false},
		{"github", "gitlab", false},
		{"", "", false},
	} {
		if got := sameServer(c.ours, c.theirs); got != c.want {
			t.Errorf("sameServer(%q, %q) = %v", c.ours, c.theirs, got)
		}
	}
}
