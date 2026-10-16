package reveal

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/Aaditya1273/Vigil/internal/firewall"
	"github.com/Aaditya1273/Vigil/internal/graph"
)

// Replay feeds every indexed call, oldest first, through the firewall as if
// it were live, at its original time. History is replayed as it happened: a
// call VIGIL would have stopped still ran, so what it read stays in the graph
// and later decisions see it (a secret read by a call that would have been
// blocked can still be caught leaving later). Only calls VIGIL would have
// allowed count toward earned autonomy, exactly as live.
//
// progress, if set, is called after each call with (done, total).
func Replay(ctx context.Context, s *Scan, fw *firewall.Firewall, g *graph.Client, home string, progress func(done, total int)) error {
	type stats struct {
		source         string
		calls, repeats int64
		last           string
	}
	sessions := map[string]*stats{}
	err := s.Each(func(i int, ev Event) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		tool, args := firewall.CanonicalTool(ev.Tool, ev.Input)
		session := prefix(ev.Source) + ev.Session
		st := sessions[session]
		if st == nil {
			st = &stats{source: ev.Source}
			sessions[session] = st
		}
		sig := tool + " " + canonicalJSON(args)
		st.calls++
		if sig == st.last {
			st.repeats++
		}
		st.last = sig

		// The hook asks this after deciding; nothing between the two writes
		// changes the answer, so asking first is the same question.
		_, earned := fw.EarnedTrust(ctx, ev.Source, ev.Cwd, tool, args)
		res := fw.Check(ctx, firewall.Call{
			SessionID: session, Agent: ev.Source, Repo: ev.Cwd, Tool: tool, Args: args,
			Budget: 1e9, At: ev.At, Label: Label(tool, args, home),
		})
		if res.Decision == firewall.Allow && earned && len(res.RedactTokens) == 0 {
			g.MarkAutonomous(res.ID)
		}
		if ev.HasResult {
			if res.Decision == firewall.Allow {
				dur := ev.Done.Sub(ev.At)
				if dur < 0 {
					dur = 0
				}
				fw.Commit(session, tool, 0, dur, !ev.IsError)
			}
			if !ev.IsError {
				fw.Observe(session, tool, args, ev.Output)
				fw.ObserveEffects(session, tool, args, ev.Result)
			}
		}
		g.Flush() // the next call's queries must see this one, as they would live
		if progress != nil {
			progress(i+1, s.Calls)
		}
		return nil
	})
	if err != nil {
		return err
	}
	for id, st := range sessions {
		cost := -1.0
		raw := strings.TrimPrefix(id, prefix(st.source))
		if c, ok := s.Costs[raw]; ok && st.source == "claude-code" {
			cost = c
		}
		g.SetSessionStats(graph.SessionStats{Session: id, Source: st.source, CostUSD: cost, Calls: st.calls, Repeats: st.repeats})
	}
	g.Flush()
	return nil
}

// prefix matches the live hook's session ids (cc-<claude session>), so a
// replayed history and a live one are the same graph.
func prefix(source string) string {
	switch source {
	case "claude-code":
		return "cc-"
	case "codex":
		return "codex-"
	default:
		return "gem-"
	}
}

func canonicalJSON(v any) string {
	b, _ := json.Marshal(v) // map keys are sorted by encoding/json
	return string(b)
}

// Label is what the reveal page shows for a call: short, with every secret
// the detectors recognize masked and the home directory written as ~.
func Label(tool string, args map[string]any, home string) string {
	var s string
	switch tool {
	case "run_command":
		s, _ = args["command"].(string)
	case "read_file", "write_file", "list_directory":
		p, _ := args["path"].(string)
		s = tool + " " + p
	case "web_fetch":
		u, _ := args["url"].(string)
		s = "fetch " + u
	default:
		s = tool + " " + canonicalJSON(args)
	}
	if home != "" {
		s = strings.ReplaceAll(s, home, "~")
	}
	s = firewall.RedactSecrets(strings.Join(strings.Fields(s), " "))
	if r := []rune(s); len(r) > 140 {
		s = string(r[:140]) + "…"
	}
	return s
}

// Summary is one line for a terminal.
func Summary(r graph.RevealSummary) string {
	if r.Calls == 0 {
		return "No agent tool calls found in this window."
	}
	return fmt.Sprintf("%d tool calls across %d sessions; %d would have been blocked, %d would have asked first, %d rewritten; autonomy level %.1f%%.",
		r.Calls, r.Sessions, r.Blocked, r.Paused, r.Redacted, r.AutonomyLevel)
}
