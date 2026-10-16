package graph

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// Counterfactual replay: for a decision that stopped or rewrote a call, find
// the single edge whose absence would have let it through, and say so in one
// sentence. For decisions made by a min cut the answer is computed on the
// decision's persisted influence network: an edge on every source-to-sink
// path (a bridge) is one whose removal disconnects the tainted value from the
// call, so the max flow would be 0 and the call allowed. For decisions made
// by one graph fact (a typosquat edge, an IS_A classification, a description
// change) the answer is that fact, confirmed to exist in the graph.

// Why is the answer to "why was this stopped, and what would have changed it?"
type Why struct {
	Decision string `json:"decision"`
	Verdict  string `json:"verdict"`
	Stage    string `json:"stage"`
	Tool     string `json:"tool"`
	// Flips is true when removing Edge alone would have allowed the call.
	Flips bool `json:"flips"`
	// Edge is the counterfactual edge, "from --[REL]--> to".
	Edge string `json:"edge,omitempty"`
	// Cause is the earlier decision on the chain that let the edge exist
	// (the decision that allowed the read, for a flow decision).
	Cause    string `json:"cause_decision,omitempty"`
	Sentence string `json:"sentence"`
	Method   string `json:"method"`
}

func (c *Client) Why(ctx context.Context, decisionID string) (Why, error) {
	rows, err := c.Query(ctx, q("why_decision"), map[string]any{"id": decisionID})
	if err != nil {
		return Why{}, err
	}
	if len(rows) == 0 {
		return Why{}, fmt.Errorf("no decision %s in the graph", decisionID)
	}
	r := rows[0]
	w := Why{Decision: decisionID, Verdict: Str(r[0]), Stage: Str(r[1]), Tool: Str(r[3])}
	agent, pkg := Str(r[4]), Str(r[7])
	cutEdges := strs(r[6])
	paths := strs(r[8])

	switch {
	case w.Verdict == "ALLOW" && len(cutEdges) == 0:
		w.Method = "none"
		w.Sentence = "This call was allowed as asked; there is no verdict to flip."
	case len(cutEdges) > 0 || w.Stage == "exfiltration" || w.Stage == "provenance":
		return c.whyFlow(ctx, w)
	case w.Stage == "code_graph":
		return c.whyPackage(ctx, w, pkg)
	case w.Stage == "entity_policy":
		return c.whyEntity(ctx, w, paths)
	case w.Stage == "tool_drift":
		return c.whyDrift(ctx, w, agent)
	default:
		w.Method = "not-graph"
		w.Sentence = fmt.Sprintf("This decision was made at the %s stage, not by a graph path, so no single graph edge flips it.", w.Stage)
	}
	return w, nil
}

func (c *Client) whyFlow(ctx context.Context, w Why) (Why, error) {
	w.Method = "bridge-of-cut-network"
	rows, err := c.Query(ctx, q("why_paths"), map[string]any{"call": w.Decision})
	if err != nil {
		return w, err
	}
	if len(rows) == 0 {
		w.Sentence = "No influence network was stored for this decision."
		return w, nil
	}
	// Edges on every path, in path order.
	count := map[int64]int{}
	kind := map[int64]string{}
	var order []int64
	for i, row := range rows {
		for _, e := range listOf(row[0]) {
			pair := listOf(e)
			id := Int(pair[0])
			if i == 0 {
				order = append(order, id)
			}
			count[id]++
			kind[id] = Str(pair[1])
		}
	}
	var bridges []int64
	for _, id := range order {
		if count[id] == len(rows) {
			bridges = append(bridges, id)
		}
	}
	verdictWord := strings.ToLower(w.Verdict) + "ed"
	if w.Verdict == "PAUSE" {
		verdictWord = "paused"
	}
	if w.Verdict == "ALLOW" {
		verdictWord = "rewritten"
	}
	// Prefer the committed event (the earlier read), then the argument it reached.
	for _, want := range []string{"read", "taints"} {
		for _, id := range bridges {
			if kind[id] != want {
				continue
			}
			w.Flips = true
			if want == "read" {
				o, err := c.Query(ctx, q("why_read_origin"), map[string]any{"rid": id})
				if err != nil || len(o) == 0 {
					return w, err
				}
				tool, session, value, cause := Str(o[0][0]), Str(o[0][1]), Str(o[0][3]), Str(o[0][4])
				when := time.Unix(0, Int(o[0][2])).UTC().Format("2006-01-02 15:04:05 UTC")
				w.Edge = fmt.Sprintf("%s @ %s --[READ]--> %s", tool, session, value)
				w.Cause = cause
				w.Sentence = fmt.Sprintf("If %s in session %s had not read %s (at %s, decision %s), this call would have been ALLOWed instead of %s: that read is on every path the min cut severed.",
					tool, session, value, when, cause, verdictWord)
				return w, nil
			}
			o, err := c.Query(ctx, q("why_taint_origin"), map[string]any{"rid": id})
			if err != nil || len(o) == 0 {
				return w, err
			}
			w.Edge = fmt.Sprintf("%s --[TAINTS]--> arg: %s", Str(o[0][0]), Str(o[0][1]))
			w.Sentence = fmt.Sprintf("If argument %s had not carried %s, this call would have been ALLOWed instead of %s.", Str(o[0][1]), Str(o[0][0]), verdictWord)
			return w, nil
		}
	}
	w.Sentence = fmt.Sprintf("No single edge flips this: the tainted values reach the call along %d independent paths.", len(rows))
	return w, nil
}

func (c *Client) whyPackage(ctx context.Context, w Why, pkg string) (Why, error) {
	w.Method = "deciding-fact"
	if pkg == "" {
		w.Sentence = "This install was blocked, but the package was not recorded on the call."
		return w, nil
	}
	rows, err := c.Query(ctx, q("why_package"), map[string]any{"pkg": pkg})
	if err != nil {
		return w, err
	}
	if len(rows) > 0 && Str(rows[0][0]) != "" {
		real := Str(rows[0][0])
		w.Flips, w.Edge = true, fmt.Sprintf("%s --[TYPOSQUAT_OF]--> %s", pkg, real)
		w.Sentence = fmt.Sprintf("If %s were not recorded as a typosquat of %s, this install would have been ALLOWed.", pkg, real)
		return w, nil
	}
	if t, err := c.ThreatLookup(ctx, "package", pkg); err == nil && t != nil {
		w.Flips, w.Edge = true, fmt.Sprintf("threat_intel Hash(package:%s)", pkg)
		w.Sentence = fmt.Sprintf("If no tenant had blocked %s in the shared threat graph (%d tenant(s) did), this install would have been ALLOWed.", pkg, t.Tenants)
		return w, nil
	}
	w.Method = "not-graph"
	w.Sentence = fmt.Sprintf("%s is on the operator's compromised-package list (configuration, not a graph edge), so no graph edge flips it.", pkg)
	return w, nil
}

func (c *Client) whyEntity(ctx context.Context, w Why, paths []string) (Why, error) {
	w.Method = "deciding-fact"
	// The classification is the counterfactual: without the IS_A to the denied
	// type, no policy applies to this person.
	var isa []string
	for _, p := range paths {
		if strings.Contains(p, "--[IS_A]-->") {
			isa = append(isa, p)
		}
	}
	if len(isa) != 1 {
		w.Sentence = fmt.Sprintf("No single edge flips this: the recipient resolves to %d denied classifications.", len(isa))
		return w, nil
	}
	from, to, _ := strings.Cut(isa[0], " --[IS_A]--> ")
	rows, err := c.Query(ctx, q("why_edge"), map[string]any{"from": from, "rel": "IS_A", "to": to})
	if err != nil {
		return w, err
	}
	if len(rows) == 0 || Int(rows[0][0]) == 0 {
		w.Sentence = "The classification behind this decision is no longer in the graph."
		return w, nil
	}
	w.Flips, w.Edge = true, isa[0]
	w.Sentence = fmt.Sprintf("If %s were not recorded as a %s (IS_A), this share would have been ALLOWed.", from, to)
	return w, nil
}

func (c *Client) whyDrift(ctx context.Context, w Why, agent string) (Why, error) {
	w.Method = "deciding-fact"
	rows, err := c.Query(ctx, q("why_drift"), map[string]any{"tool": w.Tool})
	if err != nil || len(rows) == 0 {
		w.Sentence = "The description change behind this pause is no longer in the graph."
		return w, err
	}
	w.Flips, w.Edge = true, fmt.Sprintf("%s ToolVersion --[SUPERSEDES]--> previous", w.Tool)
	w.Sentence = fmt.Sprintf("If %s's description had not changed after %s last used it (\"%s\" → \"%s\"), this call would have proceeded.",
		w.Tool, agent, clip(Str(rows[0][0]), 80), clip(Str(rows[0][1]), 80))
	return w, nil
}

func strs(v any) []string {
	var out []string
	for _, e := range listOf(v) {
		out = append(out, Str(e))
	}
	return out
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
