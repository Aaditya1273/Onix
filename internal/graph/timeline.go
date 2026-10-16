package graph

import "context"

// Time travel: the graph as it stood at a moment, by filtering on the
// timestamps every Call and Decision already carry. Nothing is copied.

type Tick struct {
	ID      string `json:"id"`
	TS      int64  `json:"ts"`
	Verdict string `json:"verdict"`
	Stage   string `json:"stage"`
	Tool    string `json:"tool"`
}

func (c *Client) Ticks(ctx context.Context, limit int) ([]Tick, error) {
	rows, err := c.Query(ctx, q("timeline_ticks"), map[string]any{"limit": limit})
	if err != nil {
		return nil, err
	}
	out := make([]Tick, 0, len(rows))
	for _, r := range rows {
		out = append(out, Tick{ID: Str(r[0]), TS: Int(r[1]), Verdict: Str(r[2]), Stage: Str(r[3]), Tool: Str(r[4])})
	}
	return out, nil
}

// AsOfEdge is one edge that existed at the requested time.
type AsOfEdge struct {
	From     string `json:"from"`
	FromKind string `json:"from_kind"`
	Rel      string `json:"rel"`
	To       string `json:"to"`
	ToLabel  string `json:"to_label"`
	ToKind   string `json:"to_kind"`
	TS       int64  `json:"ts"` // when it came to exist
}

// AsOf is the subgraph around one call (its id is its decision's id) as it
// stood at t (unix ns).
func (c *Client) AsOf(ctx context.Context, id string, t int64) ([]AsOfEdge, error) {
	rows, err := c.Query(ctx, q("asof_subgraph"), map[string]any{"id": id, "t": t})
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	out := make([]AsOfEdge, 0, len(rows))
	for _, r := range rows {
		e := AsOfEdge{From: Str(r[0]), FromKind: Str(r[1]), Rel: Str(r[2]), To: Str(r[3]), ToLabel: Str(r[4]), ToKind: Str(r[5]), TS: Int(r[6])}
		if k := e.From + e.Rel + e.To; !seen[k] {
			seen[k] = true
			out = append(out, e)
		}
	}
	return out, nil
}

// LatestStop is the newest decision at or before t that stopped or rewrote a call.
func (c *Client) LatestStop(ctx context.Context, t int64) (string, error) {
	rows, err := c.Query(ctx, q("timeline_latest_stop"), map[string]any{"t": t})
	if err != nil || len(rows) == 0 {
		return "", err
	}
	return Str(rows[0][0]), nil
}
