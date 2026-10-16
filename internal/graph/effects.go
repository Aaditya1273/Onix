package graph

import (
	"context"
	"sort"
)

// Shadow execution: before an allowed call runs, its predicted effects are
// written as (:PredictedEffect) nodes; after it runs, what the harness
// reports it did becomes (:ObservedEffect) nodes; one query diffs them.
// An observed effect nobody predicted is a hidden secondary effect: it is an
// incident (earned trust resets) and a behavior signal on the next call.

// EffectRef is one thing a call touches.
type EffectRef struct {
	Kind   string `json:"kind"` // file | host | package | env
	Name   string `json:"name"`
	Hidden bool   `json:"hidden,omitempty"`
}

func effectParams(es []EffectRef) []any {
	out := make([]any, 0, len(es))
	for _, e := range es {
		out = append(out, map[string]any{"kind": e.Kind, "name": e.Name})
	}
	return out
}

// EffectHistory is what this tool has done before (hidden effects excluded:
// one bad run must not make the same effect "expected" next time).
func (c *Client) EffectHistory(ctx context.Context, tool string) ([]EffectRef, error) {
	rows, err := c.Query(ctx, q("effect_history"), map[string]any{"tool": tool})
	if err != nil {
		return nil, err
	}
	out := make([]EffectRef, 0, len(rows))
	for _, r := range rows {
		out = append(out, EffectRef{Kind: Str(r[0]), Name: Str(r[1])})
	}
	return out, nil
}

// RecordObserved attaches what a call actually did to the session's latest
// allowed call of tool, then diffs it against the prediction. Asynchronous,
// in order with the call's own write.
func (c *Client) RecordObserved(session, tool string, effects []EffectRef) {
	if c == nil {
		return
	}
	c.enqueue(func(ctx context.Context) error {
		rows, err := c.Write(ctx, q("effect_claim"), map[string]any{"session": session, "tool": tool})
		if err != nil || len(rows) == 0 {
			return err
		}
		id := Str(rows[0][0])
		if len(effects) == 0 {
			return nil
		}
		if err := c.Exec(ctx, q("effect_observe"), map[string]any{"call": id, "effects": effectParams(effects)}); err != nil {
			return err
		}
		return c.Exec(ctx, q("effect_diff"), map[string]any{"call": id})
	})
}

// HiddenRecent counts this agent's recent calls of tool with a hidden effect.
func (c *Client) HiddenRecent(ctx context.Context, agent, tool string) (int64, error) {
	rows, err := c.Query(ctx, q("hidden_recent"), map[string]any{"agent": agent, "tool": tool})
	if err != nil || len(rows) == 0 {
		return 0, err
	}
	return Int(rows[0][0]), nil
}

// CallEffects returns one call's predicted and observed effects.
func (c *Client) CallEffects(ctx context.Context, callID string) (predicted, observed []EffectRef, hidden bool, err error) {
	rows, err := c.Query(ctx, q("effect_compare"), map[string]any{"call": callID})
	predicted, observed = []EffectRef{}, []EffectRef{}
	if err != nil || len(rows) == 0 {
		return predicted, observed, false, err
	}
	for _, p := range listOf(rows[0][0]) {
		if e := listOf(p); len(e) >= 2 && e[0] != nil {
			predicted = append(predicted, EffectRef{Kind: Str(e[0]), Name: Str(e[1])})
		}
	}
	for _, o := range listOf(rows[0][1]) {
		if e := listOf(o); len(e) >= 3 && e[0] != nil {
			h, _ := e[2].(bool)
			observed = append(observed, EffectRef{Kind: Str(e[0]), Name: Str(e[1]), Hidden: h})
		}
	}
	sortEffects(predicted)
	sortEffects(observed)
	hidden, _ = rows[0][2].(bool)
	return predicted, observed, hidden, nil
}

func listOf(v any) []any {
	l, _ := v.([]any)
	return l
}

func sortEffects(es []EffectRef) {
	sort.Slice(es, func(i, j int) bool {
		if es[i].Kind != es[j].Kind {
			return es[i].Kind < es[j].Kind
		}
		return es[i].Name < es[j].Name
	})
}
