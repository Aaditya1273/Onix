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

// Found by replaying real history: ordinary words in a command's output were
// recorded as secrets, so later commands mentioning them looked like
// exfiltration. Secrets are still found; words, paths and config are not.
func TestSecretValuesIgnoresOrdinaryValues(t *testing.T) {
	out := `status: expected
result: generated
Content-Type: application/json
loaded .env.local
NODE_ENV=production
PORT=8080
HOME=/home/dev/project
SITE_URL=https://example.com/docs
STRIPE_KEY=sk_live_51HxAbCdEfGh123456
password: hunter2hunter
DATABASE_URL=postgres://app:s3cretpass@db/app
SESSION_TOKEN=3f9a1c2b7d8e4f60a1b2
export GITHUB_TOKEN="ghp_abcdefghijklmnop1234"
DEPLOY_KEY: generated
API_KEY=undefined
secrets: secrets:
Author: Aaditya1273
CONTRACT_ADDRESS=0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed
GIT_SHA=4f8c2e9a1b7d3c6e5f0a9b8c7d6e5f4a3b2c1d0e
SIGNING_SECRET=Zx9vQ2mL7pR4tY8wK3nB6cJ1
PRIVATE_KEY=0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318
OPENAI_API_KEY=sk-proj-abcdefghij0123456789`
	got := map[string]bool{}
	for _, v := range secretValues(out) {
		got[v] = true
	}
	for _, want := range []string{"sk_live_51HxAbCdEfGh123456", "hunter2hunter", "postgres://app:s3cretpass@db/app", "3f9a1c2b7d8e4f60a1b2",
		"ghp_abcdefghijklmnop1234", "Zx9vQ2mL7pR4tY8wK3nB6cJ1", "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318", "sk-proj-abcdefghij0123456789"} {
		if !got[want] {
			t.Errorf("missed secret %q (got %v)", want, got)
		}
	}
	for _, not := range []string{"expected", "generated", "application/json", "production", "/home/dev/project", "https://example.com/docs",
		"undefined", "secrets:", "Aaditya1273", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "4f8c2e9a1b7d3c6e5f0a9b8c7d6e5f4a3b2c1d0e"} {
		if got[not] {
			t.Errorf("%q is not a secret", not)
		}
	}
}
