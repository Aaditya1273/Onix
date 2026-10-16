package graph

import (
	"context"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

// The database computes the cut.
//
// For a call whose arguments carry tainted values (a secret read earlier, or
// external content headed for a shell), VIGIL builds that call's influence
// network in the graph and asks FalkorDB's algo.maxFlow for the maximum flow
// from the committed reads to the call's effect. By max-flow/min-cut, that
// value is the cost of the cheapest set of edges that severs every path.
//
// Capacities are chosen so the cut can be read off the flow value alone:
//
//	committed edges (source, read, taints)  inf
//	argument -> effect (redact that arg)    2
//	effect -> sink (block the call)         2*n - 1   (n = number of arguments)
//
// Redacting k tainted arguments costs 2k (even); blocking costs 2n-1 (odd).
// So an odd max flow means FalkorDB cut the terminal edge (every argument was
// tainted: block), and an even one means it cut exactly the tainted argument
// edges (redact them, allow the rewritten call). No ties are possible.
const (
	cutRedactCap = 2
	cutInf       = 1_000_000
)

// BlockCap is the cost of the terminal edge for a call with n arguments.
func BlockCap(n int) int64 { return int64(2*n - 1) }

type CutArg struct {
	Key    string
	Hashes []string // tainted value hashes this argument carries
}

type Cut struct {
	MaxFlow  int64    `json:"max_flow"` // computed by FalkorDB; equals the cut's cost
	Terminal bool     `json:"terminal"` // block the call
	Redact   []string `json:"redact"`   // argument keys to redact; the rewritten call is allowed
	MS       float64  `json:"ms"`
}

func (k Cut) Empty() bool { return !k.Terminal && len(k.Redact) == 0 }

// Edges names the severed edges, as stored on the Decision node.
func (k Cut) Edges() []string {
	if k.Terminal {
		return []string{"terminal"}
	}
	out := make([]string, 0, len(k.Redact))
	for _, key := range k.Redact {
		out = append(out, "arg:"+key)
	}
	return out
}

// ComputeCut builds the call's influence network, runs algo.maxFlow over it,
// marks the cut edges, and returns the cut.
func (c *Client) ComputeCut(ctx context.Context, callID, tool string, args []CutArg) (Cut, error) {
	start := time.Now()
	argList := make([]any, 0, len(args))
	for _, a := range args {
		hs := make([]any, len(a.Hashes))
		for i, h := range a.Hashes {
			hs[i] = h
		}
		argList = append(argList, map[string]any{"key": a.Key, "hashes": hs})
	}
	if err := c.Exec(ctx, q("cut_build"), map[string]any{
		"call": callID, "tool": tool, "args": argList,
		"redactCap": cutRedactCap, "blockCap": BlockCap(len(args)), "inf": cutInf,
	}); err != nil {
		return Cut{}, err
	}
	rows, err := c.Query(ctx, q("cut_compute"), map[string]any{"call": callID})
	if err != nil || len(rows) == 0 {
		return Cut{}, err
	}

	cut := Cut{MaxFlow: int64(math.Round(Float(rows[0][0])))}
	switch {
	case cut.MaxFlow == 0:
	case cut.MaxFlow == BlockCap(len(args)):
		cut.Terminal = true
	default:
		flows, _ := rows[0][1].([]any)
		for _, f := range flows {
			e, _ := f.([]any)
			if len(e) == 4 && Str(e[0]) == "arg" && Float(e[2]) > 0 && Str(e[3]) == callID {
				cut.Redact = append(cut.Redact, Str(e[1]))
			}
		}
		sort.Strings(cut.Redact)
	}
	if !cut.Empty() {
		if err := c.Exec(ctx, q("cut_mark"), map[string]any{"call": callID, "keys": cut.Redact, "terminal": cut.Terminal}); err != nil {
			return cut, err
		}
	}
	cut.MS = ms(start)
	return cut, nil
}

// DropCut removes a call's network; a dry run must leave no trace.
func (c *Client) DropCut(ctx context.Context, callID string) error {
	return c.Exec(ctx, q("cut_drop"), map[string]any{"call": callID})
}

type FlowEdge struct {
	From      string `json:"from"`
	FromLabel string `json:"from_label"`
	Kind      string `json:"kind"`
	To        string `json:"to"`
	ToLabel   string `json:"to_label"`
	Cap       int64  `json:"cap"`
	Cut       bool   `json:"cut"`
}

// CutNetwork returns a decision's persisted influence network, for rendering.
func (c *Client) CutNetwork(ctx context.Context, callID string) ([]FlowEdge, error) {
	rows, err := c.Query(ctx, q("cut_network"), map[string]any{"call": callID})
	if err != nil {
		return nil, err
	}
	out := make([]FlowEdge, 0, len(rows))
	for _, r := range rows {
		cut, _ := r[6].(bool)
		out = append(out, FlowEdge{From: Str(r[0]), FromLabel: Str(r[1]), Kind: Str(r[2]), To: Str(r[3]), ToLabel: Str(r[4]), Cap: Int(r[5]), Cut: cut})
	}
	return out, nil
}

// FlowTriplets renders a network as graph triplets; a cut edge's label says so.
func FlowTriplets(edges []FlowEdge) []Triplet {
	out := make([]Triplet, 0, len(edges))
	for _, e := range edges {
		cap := "∞"
		if e.Cap < cutInf {
			cap = strconv.FormatInt(e.Cap, 10)
		}
		label := strings.ToUpper(e.Kind) + " cap " + cap
		if e.Cut {
			label += " ✂ CUT"
		}
		out = append(out, Triplet{
			Source:   Entity{ID: e.FromLabel + ":" + e.From, Name: e.From, Type: strings.ToUpper(e.FromLabel)},
			Relation: Relation{Predicate: label},
			Target:   Entity{ID: e.ToLabel + ":" + e.To, Name: e.To, Type: strings.ToUpper(e.ToLabel)},
		})
	}
	return out
}

// DecisionRow is one decision as stored in the graph.
type DecisionRow struct {
	ID       string   `json:"id"`
	TS       int64    `json:"ts"`
	Agent    string   `json:"agent"`
	Session  string   `json:"session"`
	Tool     string   `json:"tool"`
	Verdict  string   `json:"verdict"`
	Stage    string   `json:"stage"`
	Reason   string   `json:"reason"`
	CutEdges []string `json:"cut_edges"`
	CutCost  int64    `json:"cut_cost"`
	Hidden   bool     `json:"hidden_effect"` // the call did something its prediction did not cover
}

func (c *Client) RecentDecisions(ctx context.Context, limit int, all bool) ([]DecisionRow, error) {
	rows, err := c.Query(ctx, q("decisions_recent"), map[string]any{"limit": limit, "all": all})
	if err != nil {
		return nil, err
	}
	out := make([]DecisionRow, 0, len(rows))
	for _, r := range rows {
		d := DecisionRow{ID: Str(r[0]), TS: Int(r[1]), Agent: Str(r[2]), Session: Str(r[3]), Tool: Str(r[4]),
			Verdict: Str(r[5]), Stage: Str(r[6]), Reason: Str(r[7]), CutEdges: []string{}, CutCost: Int(r[9])}
		d.Hidden, _ = r[10].(bool)
		if es, ok := r[8].([]any); ok {
			for _, e := range es {
				d.CutEdges = append(d.CutEdges, Str(e))
			}
		}
		out = append(out, d)
	}
	return out, nil
}
