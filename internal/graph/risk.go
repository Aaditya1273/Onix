package graph

import (
	"context"
	"encoding/json"
	"math"
	"sort"
	"time"
)

// Agent Risk Score, 0 (no observed risk) to 100, computed from the graph only.
//
//	risk = 100 × ( 0.35 · incident_rate
//	             + 0.15 · min(1, revocations / 3)
//	             + 0.15 · min(1, hidden_effects / 3)
//	             + 0.15 · min(1, mean_blast_radius / 10)
//	             + 0.10 · min(1, cost_cv)
//	             + 0.10 · (1 − model_free_share) )
//
// incident_rate      decisions that were not ALLOW / all decisions
// revocations        decisions paused because a tool's description changed (rug pull)
// hidden_effects     calls that did something their prediction did not cover
// mean_blast_radius  mean dependents (DEPENDS_ON, 4 hops) of packages it was allowed to install
// cost_cv            coefficient of variation (stddev / mean) of executed calls' cost
// model_free_share   decisions made without a model (reproducible from the graph)
const (
	wIncident      = 0.35
	wRevocation    = 0.15
	wHidden        = 0.15
	wBlast         = 0.15
	wCost          = 0.10
	wModelReliance = 0.10
)

type RiskComponents struct {
	Decisions      int64   `json:"decisions"`
	Incidents      int64   `json:"incidents"`
	Revocations    int64   `json:"revocations"`
	HiddenEffects  int64   `json:"hidden_effects"`
	ModelFree      int64   `json:"model_free"`
	MeanBlast      float64 `json:"mean_blast_radius"`
	CostCV         float64 `json:"cost_cv"`
	IncidentRate   float64 `json:"incident_rate"`
	ModelFreeShare float64 `json:"model_free_share"`
}

type RiskScore struct {
	Scope      string         `json:"scope"` // agent id, or "*" for the tenant
	Score      float64        `json:"score"`
	Components RiskComponents `json:"components"`
}

type RiskSnapshot struct {
	Scope      string          `json:"scope"`
	Day        string          `json:"day"`
	Score      float64         `json:"score"`
	Components json.RawMessage `json:"components"`
}

type riskInput struct {
	decisions, incidents, revocations, hidden, modelFree int64
	costs                                                []float64
	packages                                             []string
}

// Score applies the formula above.
func (in riskInput) score(blast map[string]int64) RiskComponents {
	c := RiskComponents{Decisions: in.decisions, Incidents: in.incidents, Revocations: in.revocations, HiddenEffects: in.hidden, ModelFree: in.modelFree}
	if in.decisions > 0 {
		c.IncidentRate = float64(in.incidents) / float64(in.decisions)
		c.ModelFreeShare = float64(in.modelFree) / float64(in.decisions)
	}
	if len(in.packages) > 0 {
		var sum int64
		for _, p := range in.packages {
			sum += blast[p]
		}
		c.MeanBlast = float64(sum) / float64(len(in.packages))
	}
	if len(in.costs) > 1 {
		var mean float64
		for _, x := range in.costs {
			mean += x
		}
		mean /= float64(len(in.costs))
		var v float64
		for _, x := range in.costs {
			v += (x - mean) * (x - mean)
		}
		if mean > 0 {
			c.CostCV = math.Sqrt(v/float64(len(in.costs))) / mean
		}
	}
	return c
}

func riskValue(c RiskComponents) float64 {
	if c.Decisions == 0 {
		return 0
	}
	r := wIncident*c.IncidentRate +
		wRevocation*math.Min(1, float64(c.Revocations)/3) +
		wHidden*math.Min(1, float64(c.HiddenEffects)/3) +
		wBlast*math.Min(1, c.MeanBlast/10) +
		wCost*math.Min(1, c.CostCV) +
		wModelReliance*(1-c.ModelFreeShare)
	return math.Round(1000*r) / 10 // 0..100, one decimal
}

// RiskScores computes every agent's score and the tenant's, since a time.
func (c *Client) RiskScores(ctx context.Context, since time.Time) ([]RiskScore, error) {
	rows, err := c.Query(ctx, q("risk_agents"), map[string]any{"since": since.UnixNano()})
	if err != nil {
		return nil, err
	}
	var all riskInput
	inputs := map[string]riskInput{}
	pkgSet := map[string]bool{}
	for _, r := range rows {
		in := riskInput{decisions: Int(r[1]), incidents: Int(r[2]), revocations: Int(r[3]), hidden: Int(r[4]), modelFree: Int(r[5])}
		for _, x := range listOf(r[6]) {
			in.costs = append(in.costs, Float(x))
		}
		for _, x := range listOf(r[7]) {
			in.packages = append(in.packages, Str(x))
			pkgSet[Str(x)] = true
		}
		inputs[Str(r[0])] = in
		all.decisions += in.decisions
		all.incidents += in.incidents
		all.revocations += in.revocations
		all.hidden += in.hidden
		all.modelFree += in.modelFree
		all.costs = append(all.costs, in.costs...)
		all.packages = append(all.packages, in.packages...)
	}
	blast := map[string]int64{}
	if len(pkgSet) > 0 {
		pkgs := make([]string, 0, len(pkgSet))
		for p := range pkgSet {
			pkgs = append(pkgs, p)
		}
		br, err := c.Query(ctx, q("risk_blast"), map[string]any{"pkgs": pkgs})
		if err != nil {
			return nil, err
		}
		for _, r := range br {
			blast[Str(r[0])] = Int(r[1])
		}
	}
	out := make([]RiskScore, 0, len(inputs)+1)
	for agent, in := range inputs {
		comp := in.score(blast)
		out = append(out, RiskScore{Scope: agent, Score: riskValue(comp), Components: comp})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	tc := all.score(blast)
	return append([]RiskScore{{Scope: "*", Score: riskValue(tc), Components: tc}}, out...), nil
}

// SnapshotRisk stores today's scores as RiskSnapshot nodes (idempotent per day).
func (c *Client) SnapshotRisk(ctx context.Context, scores []RiskScore, now time.Time) error {
	day := now.UTC().Format("2006-01-02")
	for _, s := range scores {
		comp, _ := json.Marshal(s.Components)
		if err := c.Exec(ctx, q("risk_snapshot"), map[string]any{
			"scope": s.Scope, "day": day, "score": s.Score, "components": string(comp), "ts": now.UnixNano(),
		}); err != nil {
			return err
		}
	}
	return nil
}

// RiskHistory returns the stored daily snapshots since a time.
func (c *Client) RiskHistory(ctx context.Context, since time.Time) ([]RiskSnapshot, error) {
	rows, err := c.Query(ctx, q("risk_history"), map[string]any{"fromDay": since.UTC().Format("2006-01-02")})
	out := []RiskSnapshot{}
	if err != nil {
		return out, err
	}
	for _, r := range rows {
		out = append(out, RiskSnapshot{Scope: Str(r[0]), Day: Str(r[1]), Score: Float(r[2]), Components: json.RawMessage(Str(r[3]))})
	}
	return out, nil
}
