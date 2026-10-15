package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestInstallHookMergesAndIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".claude", "settings.json")
	os.MkdirAll(filepath.Dir(path), 0o755)
	os.WriteFile(path, []byte(`{"model":"opus","hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"lint.sh"}]}]}}`), 0o644)

	if added, err := installHook(path, "/usr/local/bin/vigil-cli hook"); err != nil || !added {
		t.Fatalf("first install: added=%v err=%v", added, err)
	}
	if added, _ := installHook(path, "/usr/local/bin/vigil-cli hook"); added {
		t.Fatal("second install should be a no-op")
	}

	var s struct {
		Model string                      `json:"model"`
		Hooks map[string][]map[string]any `json:"hooks"`
	}
	raw, _ := os.ReadFile(path)
	if err := json.Unmarshal(raw, &s); err != nil {
		t.Fatal(err)
	}
	if s.Model != "opus" || len(s.Hooks["PreToolUse"]) != 2 || len(s.Hooks["PostToolUse"]) != 1 {
		t.Fatalf("settings not merged: %s", raw)
	}

	os.WriteFile(path, []byte(`{not json`), 0o644)
	if _, err := installHook(path, "x hook"); err == nil {
		t.Fatal("must refuse to overwrite a settings file it cannot parse")
	}
}
