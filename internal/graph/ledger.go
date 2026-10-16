package graph

import (
	"context"
	"time"

	"github.com/Aaditya1273/Vigil/internal/audit"
)

// LedgerFormat names the export format, so a verifier knows what it reads.
const LedgerFormat = "vigil-ledger/1"

// LedgerEntry is one sealed decision: the audit record its hash covers, and
// the graph evidence behind it. Only Audit is covered by the hash chain; the
// evidence fields are the context an underwriter reads with it.
type LedgerEntry struct {
	Audit      audit.Event `json:"audit"`
	DecisionID string      `json:"decision_id"`
	Stage      string      `json:"stage"`
	Paths      []string    `json:"paths"`
	CutEdges   []string    `json:"cut_edges"`
	CutCost    int64       `json:"cut_cost"`
	Predicted  []EffectRef `json:"predicted_effects"`
	Observed   []EffectRef `json:"observed_effects"`
}

type Ledger struct {
	Format     string         `json:"format"`
	Tenant     string         `json:"tenant"`
	From       time.Time      `json:"from"`
	To         time.Time      `json:"to"`
	ExportedAt time.Time      `json:"exported_at"`
	HashFields []string       `json:"hash_fields"`
	Entries    []LedgerEntry  `json:"decisions"`
	Risk       []RiskSnapshot `json:"risk_snapshots"`
}

// ExportLedger reads every sealed decision in [from, to] from the graph, in
// chain order, plus the risk snapshots for those days.
func (c *Client) ExportLedger(ctx context.Context, from, to time.Time) (Ledger, error) {
	l := Ledger{
		Format: LedgerFormat, Tenant: c.tenant, From: from.UTC(), To: to.UTC(), ExportedAt: time.Now().UTC(),
		HashFields: []string{"id", "ts", "agent_id", "session_id", "tool", "args_hash", "decision", "reason", "model_used", "cost", "prev_hash"},
		Entries:    []LedgerEntry{},
	}
	rows, err := c.Query(ctx, q("ledger_export"), map[string]any{"from": from.UnixNano(), "to": to.UnixNano()})
	if err != nil {
		return l, err
	}
	for _, r := range rows {
		ts, _ := time.Parse(time.RFC3339Nano, Str(r[1]))
		e := LedgerEntry{
			Audit: audit.Event{
				ID: Str(r[0]), Timestamp: ts, AgentID: Str(r[2]), SessionID: Str(r[3]), Tool: Str(r[4]),
				ArgsHash: Str(r[5]), Decision: Str(r[6]), Reason: Str(r[7]), ModelUsed: Str(r[8]), Cost: Float(r[9]),
				PrevHash: Str(r[10]), Hash: Str(r[11]),
			},
			DecisionID: Str(r[12]), Stage: Str(r[13]), Paths: nonNilStrings(strs(r[14])), CutEdges: nonNilStrings(strs(r[15])),
			CutCost: Int(r[16]), Predicted: []EffectRef{}, Observed: []EffectRef{},
		}
		for _, p := range listOf(r[17]) {
			if x := listOf(p); len(x) >= 2 && x[0] != nil {
				e.Predicted = append(e.Predicted, EffectRef{Kind: Str(x[0]), Name: Str(x[1])})
			}
		}
		for _, o := range listOf(r[18]) {
			if x := listOf(o); len(x) >= 3 && x[0] != nil {
				h, _ := x[2].(bool)
				e.Observed = append(e.Observed, EffectRef{Kind: Str(x[0]), Name: Str(x[1]), Hidden: h})
			}
		}
		l.Entries = append(l.Entries, e)
	}
	l.Risk, err = c.RiskHistory(ctx, from)
	return l, err
}

// VerifyLedger recomputes the hash chain of an exported ledger.
func VerifyLedger(l Ledger) audit.Report {
	events := make([]audit.Event, len(l.Entries))
	for i, e := range l.Entries {
		events[i] = e.Audit
	}
	return audit.VerifyEvents(events)
}
