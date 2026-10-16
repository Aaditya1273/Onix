package graph

import (
	"context"
	"fmt"
	"time"
)

// Scan-time reputation: what an outside scanner said about a tool, stored as
// an EXTERNAL fact (trust rank 0) about the tool's current ToolVersion. It is
// evidence that can raise scrutiny, never authority: nothing derives earned
// trust from it, and a description change (a new version) leaves it behind.

// LowReputation is the score under which an external rating raises scrutiny.
const LowReputation = 50

// ExternalScore is one scanner's rating. Score is -1 when the source has
// the server but has not rated it.
type ExternalScore struct {
	Source string  `json:"source"`
	Server string  `json:"server,omitempty"`
	Score  float64 `json:"score"`
	Label  string  `json:"label,omitempty"`
	URL    string  `json:"url,omitempty"`
	Trust  string  `json:"trust"`
	At     int64   `json:"at,omitempty"`
}

func (s ExternalScore) Low() bool { return s.Score >= 0 && s.Score < LowReputation }

// RecordReputation attaches a score to the tool's current version. False when
// the tool has no registered version to attach it to.
func (c *Client) RecordReputation(ctx context.Context, tool string, s ExternalScore) (bool, error) {
	text := fmt.Sprintf("%s has %s unrated", s.Source, s.Server)
	if s.Score >= 0 {
		text = fmt.Sprintf("%s rates %s %.0f/100 (%s)", s.Source, s.Server, s.Score, s.Label)
	} else if s.Label != "" {
		text += " (" + s.Label + ")"
	}
	rows, err := c.Write(ctx, q("reputation_record"), map[string]any{
		"tool": tool, "source": s.Source, "server": s.Server, "score": s.Score, "label": s.Label,
		"url": s.URL, "text": text, "ts": time.Now().UnixMilli(),
	})
	return len(rows) > 0, err
}

// Reputation is the EXTERNAL facts about the tool's current version.
func (c *Client) Reputation(ctx context.Context, tool string) ([]ExternalScore, error) {
	rows, err := c.Query(ctx, q("reputation_tool"), map[string]any{"tool": tool})
	if err != nil {
		return nil, err
	}
	out := make([]ExternalScore, 0, len(rows))
	for _, r := range rows {
		out = append(out, ExternalScore{Source: Str(r[0]), Score: Float(r[1]), Label: Str(r[2]), URL: Str(r[3]), Trust: Str(r[4]), At: Int(r[6])})
	}
	return out, nil
}

// RuntimeRecord is what the tool's calls did here.
type RuntimeRecord struct {
	Calls         int64 `json:"calls"`
	Incidents     int64 `json:"incidents"`
	HiddenEffects int64 `json:"hidden_effects"`
	Agents        int64 `json:"agents"`
	LastCall      int64 `json:"last_call,omitempty"`
}

func (c *Client) ToolRuntime(ctx context.Context, tool string) (RuntimeRecord, error) {
	rows, err := c.Query(ctx, q("reputation_runtime"), map[string]any{"tool": tool})
	if err != nil || len(rows) == 0 {
		return RuntimeRecord{}, err
	}
	r := rows[0]
	return RuntimeRecord{Calls: Int(r[0]), Incidents: Int(r[1]), HiddenEffects: Int(r[2]), Agents: Int(r[3]), LastCall: Int(r[4])}, nil
}
