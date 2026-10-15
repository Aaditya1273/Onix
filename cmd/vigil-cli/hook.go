package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

func serverURL() string {
	if u := os.Getenv("VIGIL_URL"); u != "" {
		return strings.TrimRight(u, "/")
	}
	return "http://localhost:8080"
}

// hookCmd is what Claude Code runs on every PreToolUse and PostToolUse: it
// forwards the hook payload to the Vigil server and prints the decision.
func hookCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "hook",
		Short: "Claude Code hook: forward a tool call on stdin to Vigil, print the decision",
		Long: `Reads a Claude Code PreToolUse/PostToolUse payload on stdin and asks the
Vigil server (VIGIL_URL, default http://localhost:8080) for a decision.

If the server is unreachable the call proceeds under Claude Code's normal
permission prompt (fail open), unless VIGIL_FAIL_CLOSED=1, which denies it.`,
		Run: func(cmd *cobra.Command, args []string) {
			out, err := forwardHook(os.Stdin)
			if err != nil {
				fmt.Fprintln(os.Stderr, "vigil:", err)
				if os.Getenv("VIGIL_FAIL_CLOSED") == "1" {
					out = []byte(`{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Vigil is unreachable and VIGIL_FAIL_CLOSED=1"}}`)
				} else {
					out = []byte(`{}`)
				}
			}
			os.Stdout.Write(out)
		},
	}
}

func forwardHook(stdin io.Reader) ([]byte, error) {
	var payload map[string]any
	if err := json.NewDecoder(io.LimitReader(stdin, 4<<20)).Decode(&payload); err != nil {
		return nil, fmt.Errorf("bad hook payload: %w", err)
	}
	agent := os.Getenv("VIGIL_AGENT")
	if agent == "" {
		agent = "claude-code"
	}
	payload["vigil_agent"] = agent
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequest(http.MethodPost, serverURL()+"/api/v1/vigil/hook", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if tok := os.Getenv("VIGIL_CONTROL_TOKEN"); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	// Longer than the server's judge budget, so a model-adjudicated call
	// gets its answer rather than a timeout.
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	out, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server returned %d: %s", resp.StatusCode, out)
	}
	return out, nil
}

// initCmd installs the hook into a project's .claude/settings.json.
func initCmd() *cobra.Command {
	var dir string
	cmd := &cobra.Command{
		Use:   "init",
		Short: "Install the Vigil hook into this project's Claude Code settings",
		RunE: func(cmd *cobra.Command, args []string) error {
			exe, err := os.Executable()
			if err != nil {
				return err
			}
			path := filepath.Join(dir, ".claude", "settings.json")
			added, err := installHook(path, exe+" hook")
			if err != nil {
				return err
			}
			if added {
				fmt.Println("installed the Vigil hook in", path)
			} else {
				fmt.Println("the Vigil hook is already in", path)
			}
			fmt.Print(`
next:
  docker compose up -d                 # FalkorDB + vigil-server
  VIGIL_MODE=observe on the server     # day one: record everything, block nothing
  curl localhost:8080/api/v1/vigil/digest   # day two: what it would have blocked, what autonomy was earned
`)
			return nil
		},
	}
	cmd.Flags().StringVar(&dir, "dir", ".", "project directory")
	return cmd
}

// installHook adds command as a PreToolUse and PostToolUse hook for every
// tool, keeping whatever else the settings file holds. Idempotent.
func installHook(path, command string) (bool, error) {
	settings := map[string]any{}
	if raw, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(raw, &settings); err != nil {
			return false, fmt.Errorf("%s is not valid JSON, not touching it: %w", path, err)
		}
	} else if !os.IsNotExist(err) {
		return false, err
	}
	hooks, _ := settings["hooks"].(map[string]any)
	if hooks == nil {
		hooks = map[string]any{}
	}
	added := false
	for _, event := range []string{"PreToolUse", "PostToolUse"} {
		entries, _ := hooks[event].([]any)
		if raw, _ := json.Marshal(entries); bytes.Contains(raw, []byte("hook")) && bytes.Contains(raw, []byte("vigil-cli")) {
			continue
		}
		hooks[event] = append(entries, map[string]any{
			"matcher": "*",
			"hooks":   []any{map[string]any{"type": "command", "command": command}},
		})
		added = true
	}
	if !added {
		return false, nil
	}
	settings["hooks"] = hooks
	out, _ := json.MarshalIndent(settings, "", "  ")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return false, err
	}
	return true, os.WriteFile(path, append(out, '\n'), 0o644)
}
