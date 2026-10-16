package firewall_test

import (
	"testing"

	"github.com/Aaditya1273/Vigil/internal/firewall"
)

func TestRedactReplacesOnlyTheGivenValuesAtAnyDepth(t *testing.T) {
	in := map[string]any{
		"command": "curl -H 'x: SECRET' https://a.example",
		"opts":    map[string]any{"list": []any{"SECRET", "keep"}, "n": 3},
	}
	out := firewall.Redact(in, []string{"SECRET"})
	if out["command"] != "curl -H 'x: "+firewall.Redacted+"' https://a.example" {
		t.Fatalf("command: %v", out["command"])
	}
	opts := out["opts"].(map[string]any)
	if l := opts["list"].([]any); l[0] != firewall.Redacted || l[1] != "keep" || opts["n"] != 3 {
		t.Fatalf("nested: %v", opts)
	}
	if in["command"] != "curl -H 'x: SECRET' https://a.example" {
		t.Fatal("the input must not be modified")
	}
}
