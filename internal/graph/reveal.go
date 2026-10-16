package graph

import "context"

// Reveal: what a replay of an agent's local history (vigil-cli reveal) found,
// read back from the graph it built.

// MarkAutonomous records that the hook would have let this call run without
// a prompt (earned autonomy at the time). Ordered after the call's own write.
func (c *Client) MarkAutonomous(id string) {
	c.enqueue(func(ctx context.Context) error {
		return c.Exec(ctx, q("mark_autonomous"), map[string]any{"id": id})
	})
}

// SessionStats is what a replayed session cost and how often it repeated
// itself. CostUSD is -1 when the harness recorded no cost.
type SessionStats struct {
	Session, Source string
	CostUSD         float64
	Calls, Repeats  int64
}

func (c *Client) SetSessionStats(s SessionStats) {
	c.enqueue(func(ctx context.Context) error {
		return c.Exec(ctx, q("session_stats"), map[string]any{
			"session": s.Session, "source": s.Source, "cost": s.CostUSD, "calls": s.Calls, "repeats": s.Repeats,
		})
	})
}

type RevealCall struct {
	ID      string `json:"id"`
	Tool    string `json:"tool"`
	Label   string `json:"label"`
	Session string `json:"session"`
	TS      int64  `json:"ts"`
	Repo    string `json:"repo,omitempty"`
}

type RevealDecision struct {
	RevealCall
	Verdict string   `json:"verdict"`
	Stage   string   `json:"stage"`
	Reason  string   `json:"reason"`
	Paths   []string `json:"paths"`
}

type StageCount struct {
	Verdict string `json:"verdict"`
	Stage   string `json:"stage"`
	Count   int64  `json:"count"`
}

// Spend is an estimate, and says how it was made: each session's recorded
// cost, split evenly over its calls, times its exact repeats.
type Spend struct {
	Available        bool    `json:"available"`
	Sessions         int64   `json:"sessions"`
	SessionsWithCost int64   `json:"sessions_with_cost"`
	RecordedCostUSD  float64 `json:"recorded_cost_usd"`
	RepeatedCalls    int64   `json:"repeated_calls"`
	EstimateUSD      float64 `json:"estimate_usd"`
	Method           string  `json:"method"`
}

type RevealSummary struct {
	Calls         int64            `json:"calls"`
	Sessions      int64            `json:"sessions"`
	Agents        int64            `json:"agents"`
	From          int64            `json:"from"`
	To            int64            `json:"to"`
	Blocked       int64            `json:"blocked"`
	Paused        int64            `json:"paused"`   // the hook would have asked: Claude Code's normal prompt
	Redacted      int64            `json:"redacted"` // allowed with arguments redacted
	Autonomous    int64            `json:"autonomous"`
	AutonomyLevel float64          `json:"autonomy_level"` // % of calls that would have run without a prompt
	Stages        []StageCount     `json:"stages"`
	Top           []RevealDecision `json:"top"`
	AutoApproved  []Autonomy       `json:"auto_approved"`
	Spend         Spend            `json:"spend"`
	Threshold     int64            `json:"trust_threshold"`
}

// Reveal reads the summary back. threshold is the clean-run count that earns
// autonomy, as the replay used it.
func (c *Client) Reveal(ctx context.Context, threshold int64) (RevealSummary, error) {
	s := RevealSummary{Threshold: threshold, Stages: []StageCount{}, Top: []RevealDecision{}, AutoApproved: []Autonomy{}}
	rows, err := c.Query(ctx, q("reveal_totals"), nil)
	if err != nil {
		return s, err
	}
	if len(rows) > 0 {
		r := rows[0]
		s.Calls, s.Sessions, s.Agents, s.From, s.To = Int(r[0]), Int(r[1]), Int(r[2]), Int(r[3]), Int(r[4])
		s.Blocked, s.Paused, s.Redacted, s.Autonomous = Int(r[5]), Int(r[6]), Int(r[7]), Int(r[8])
		if s.Calls > 0 {
			s.AutonomyLevel = float64(int64(1000*float64(s.Autonomous)/float64(s.Calls)+0.5)) / 10
		}
	}
	if s.Calls == 0 {
		return s, nil
	}
	if rows, err = c.Query(ctx, q("reveal_stages"), nil); err != nil {
		return s, err
	}
	for _, r := range rows {
		s.Stages = append(s.Stages, StageCount{Verdict: Str(r[0]), Stage: Str(r[1]), Count: Int(r[2])})
	}
	if rows, err = c.Query(ctx, q("reveal_top"), map[string]any{"limit": 25}); err != nil {
		return s, err
	}
	for _, r := range rows {
		s.Top = append(s.Top, RevealDecision{
			RevealCall: RevealCall{ID: Str(r[0]), Tool: Str(r[4]), Label: Str(r[5]), Session: Str(r[6]), TS: Int(r[7]), Repo: Str(r[8])},
			Verdict:    Str(r[1]), Stage: Str(r[2]), Reason: Str(r[3]), Paths: nonNilStrings(strs(r[9])),
		})
	}
	d, err := c.GetDigest(ctx, 0, threshold)
	if err != nil {
		return s, err
	}
	if d.Autonomy != nil {
		s.AutoApproved = d.Autonomy
	}
	if rows, err = c.Query(ctx, q("reveal_spend"), nil); err != nil {
		return s, err
	}
	if len(rows) > 0 {
		r := rows[0]
		s.Spend = Spend{Sessions: Int(r[0]), SessionsWithCost: Int(r[1]), RecordedCostUSD: Float(r[2]), RepeatedCalls: Int(r[3]), EstimateUSD: Float(r[4])}
		s.Spend.Available = s.Spend.SessionsWithCost > 0
		s.Spend.Method = "each session's recorded cost ÷ its tool calls × its calls that exactly repeated the previous call"
	}
	return s, nil
}

// RevealCallByID is one call for the path view.
func (c *Client) RevealCallByID(ctx context.Context, id string) (RevealCall, error) {
	rows, err := c.Query(ctx, q("reveal_call"), map[string]any{"id": id})
	if err != nil || len(rows) == 0 {
		return RevealCall{ID: id}, err
	}
	r := rows[0]
	return RevealCall{ID: id, Tool: Str(r[0]), Label: Str(r[1]), Session: Str(r[2]), TS: Int(r[3]), Repo: Str(r[4])}, nil
}
