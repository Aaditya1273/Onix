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
