package firewall

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Aaditya1273/Vigil/internal/audit"
	"github.com/Aaditya1273/Vigil/internal/engine"
	"github.com/Aaditya1273/Vigil/internal/graph"
	"github.com/Aaditya1273/Vigil/internal/llm"
	"github.com/Aaditya1273/Vigil/internal/policy"
	"github.com/Aaditya1273/Vigil/internal/recovery"
	"github.com/Aaditya1273/Vigil/internal/telemetry"
	"github.com/Aaditya1273/Vigil/internal/vigil"
)

// Decision is the firewall's answer for one tool call.
type Decision string

const (
	Allow    Decision = "ALLOW"
	Pause    Decision = "PAUSE"
	Block    Decision = "BLOCK"
	Fallback Decision = "FALLBACK"
)

// Stage names which check produced the decision, so the dashboard can show
// *why* rather than just *what*.
const (
	StageIntent       = "intent"
	StageForecast     = "forecast"
	StageBehavior     = "behavior"
	StageCodeGraph    = "code_graph"
	StageEntityPolicy = "entity_policy"
	StageExfil        = "exfiltration"
	StageProvenance   = "provenance"
	StageToolDrift    = "tool_drift"
	StageJudge        = "judge"
	StageDefault      = "default"
)

// Call is one tool call awaiting a decision.
type Call struct {
	SessionID string
	// Agent is the stable identity trust is earned under (the MCP client's
	// name); a session is one run of it. Empty means "this session only".
	Agent       string
	Repo        string // scope trust is earned in (the working directory); "" when unknown
	Tool        string
	Args        map[string]any
	ToolCost    float64
	SessionCost float64
	Budget      float64
}

// Result is a decision plus everything needed to explain and audit it.
type Result struct {
	Decision  Decision `json:"decision"`
	Stage     string   `json:"stage"`
	Reason    string   `json:"reason"`
	RuleName  string   `json:"rule_name,omitempty"`
	Severity  string   `json:"severity,omitempty"`
	Tool      string   `json:"tool"`
	SessionID string   `json:"session_id"`
	Agent     string   `json:"agent,omitempty"`
	Repo      string   `json:"repo,omitempty"`
	// Caps are the capabilities this call needs; trust is earned per shape.
	Caps []string `json:"capabilities,omitempty"`
	// RiskScore is -1 when no model was consulted. Zero would be
	// indistinguishable from "a model looked and saw no risk".
	RiskScore int       `json:"risk_score"`
	ModelUsed string    `json:"model_used,omitempty"`
	Signals   []string  `json:"signals,omitempty"`
	Cost      float64   `json:"cost"`
	Forecast  Snapshot  `json:"forecast"`
	Message   string    `json:"message,omitempty"`
	At        time.Time `json:"at"`

	// GraphPaths are the (node)--[EDGE]-->(node) paths FalkorDB returned for
	// this decision. Empty when no graph is configured, the call never needed
	// one (a covered, uncontested call does not reach the graph), or the graph
	// had nothing. Never fabricated: exactly what a query returned.
	GraphPaths []string `json:"graph_paths,omitempty"`
	// GraphQueried records that a graph query round-trip actually happened for
	// this decision, whether or not it resolved anything: proof the graph was
	// on the request path, not merely configured.
	GraphQueried bool `json:"graph_queried"`
	// GraphMS is the time this decision spent in graph queries.
	GraphMS float64 `json:"graph_ms"`
	// egress are hashes of known values this call's arguments carried.
	egress []string
	// sig identifies the exact call for loop detection.
	sig string
	// SupplyChain is populated only when a call was blocked by the
	// compromised-package list (supply_chain.go) — the structured
	// exposed-services/maintainer/typosquat report an incident responder
	// actually needs, not just "blocked".
	SupplyChain *SupplyChainReport `json:"supply_chain,omitempty"`
	// EntityPolicy is populated when a file-sharing-shaped call named a
	// recipient the enterprise graph resolved to a protected entity type
	// (entity_policy.go) — the alias-merge chain that explains the block,
	// whether or not it fired.
	EntityPolicy *EntityPolicyReport `json:"entity_policy,omitempty"`
}

// Deps are the firewall's collaborators. All are optional except Policies:
// a deployment with no ledger, no model, and no governance engine still
// enforces intent and cost.
type Deps struct {
	Logger     *slog.Logger
	Policies   *policy.Store
	Gov        *engine.GovernanceEngine
	Heal       *recovery.SelfHealingEngine
	Router     *llm.Router
	Ledger     *audit.Ledger
	Forecaster Forecaster
	// Graph is FalkorDB, the firewall's memory. Nil is a safe no-op: a
	// deployment without it still enforces intent, cost and behavior, it just
	// has no history to earn trust from.
	Graph *graph.Client
	// TrustThreshold is the clean-history count that earns autonomy.
	// Zero means VIGIL_TRUST_THRESHOLD, default 20.
	TrustThreshold int64
	// Compromised is the incident-response denylist checked before the
	// general typosquat heuristic. Nil (or empty) is the normal state — no
	// active incident. See supply_chain.go.
	Compromised *CompromisedList
	// RecentSize bounds the in-memory decision ring served to the dashboard.
	RecentSize int
}

// Firewall is the decision pipeline.
type Firewall struct {
	deps     Deps
	sessions *Sessions

	mu     sync.Mutex
	recent []Result
}

func New(d Deps) *Firewall {
	if d.Logger == nil {
		d.Logger = slog.Default()
	}
	if d.Policies == nil {
		d.Policies = policy.NewStore()
	}
	if d.Forecaster.HardLimitPct == 0 {
		d.Forecaster = DefaultForecaster()
	}
	if d.RecentSize <= 0 {
		d.RecentSize = 200
	}
	if d.TrustThreshold <= 0 {
		d.TrustThreshold = envTrustThreshold()
	}
	return &Firewall{deps: d, sessions: newSessions()}
}

// Policies exposes the policy store for the HTTP layer.
func (f *Firewall) Policies() *policy.Store { return f.deps.Policies }

// Router exposes the model router for the status endpoint.
func (f *Firewall) Router() *llm.Router { return f.deps.Router }

// Check decides whether a tool call may proceed.
//
// The ordering IS the security guarantee, so it is written as one readable
// sequence:
//
//  1. Declared intent. A BLOCK here returns immediately and is final. An
//     UNCERTAIN verdict asks the graph: an org policy denying one of the
//     call's capabilities blocks it; enough clean history for this agent,
//     tool and capability shape allows it (earned autonomy).
//  2. Packages. Any install-shaped call is checked unconditionally: the
//     compromised list, the shared threat graph, then typosquat edges.
//  3. Cost forecast on the *projected* charge. Hard limit blocks; soft limit
//     does not block, it recommends a cheaper route and raises scrutiny.
//  4. Behavioral plugins. CRITICAL blocks; HIGH and below raise scrutiny, and
//     a raised signal is put in context with the agent's THEN edges: has it
//     ever taken this step before.
//  5. If nothing raised scrutiny, allow — with no model call, and no graph
//     call either: a call fully covered by declared intent never needed
//     either.
//  6. Only now, a model, and only when the graph had no path. Graph first,
//     model second.
func (f *Firewall) Check(ctx context.Context, c Call) Result {
	ctx, span := telemetry.StartDecision(ctx, c.SessionID, c.Tool)
	defer span.End()

	sess := f.sessions.Get(c.SessionID)
	sess.setAgent(c.Agent)
	agent := sess.agentID()
	pol := f.deps.Policies.GetOrDefault(c.SessionID, c.Budget)
	caps := policy.Categories(c.Tool, c.Args)

	res := Result{
		Tool:      c.Tool,
		SessionID: c.SessionID,
		Agent:     agent,
		Repo:      c.Repo,
		Caps:      caps,
		sig:       callSignature(c.Tool, c.Args),
		RiskScore: -1,
		Cost:      c.ToolCost,
		At:        time.Now(),
	}

	// --- 1. Declared intent, graph-adjudicated when uncertain -----------------
	verdict := pol.Evaluate(c.Tool, c.Args)
	if verdict.Outcome == policy.Block {
		res.Decision, res.Stage, res.Reason = Block, StageIntent, verdict.Reason
		res.Message = "Vigil blocked this call: " + verdict.Reason
		return f.finish(ctx, span, sess, res)
	}
	graphAllowed := false
	if verdict.Outcome == policy.Uncertain {
		graphVerdict, gf := f.graphIntent(ctx, agent, c, caps)
		res.addGraph(gf)
		switch graphVerdict {
		case "deny":
			res.Decision, res.Stage = Block, StageIntent
			res.Reason = "denied by org policy graph: " + strings.Join(gf.paths, "; ")
			res.Message = "Vigil blocked this call: " + res.Reason
			return f.finish(ctx, span, sess, res)
		case "allow":
			// Earned autonomy: the history resolved what the allowlist could
			// not, so intent_uncovered does not escalate. Other signals below
			// still apply.
			graphAllowed = true
			verdict.Reason = "earned autonomy: " + strings.Join(gf.paths, "; ")
		}
	}

	// --- 2. Packages, unconditional for install-shaped calls -----------------
	if pkg := blastRadiusTarget(c); pkg != "" {
		// A package on the incident-response list is blocked without waiting
		// on the graph: the operator already knows the answer.
		if blocked, report, name := f.checkSupplyChain(ctx, c); blocked {
			res.Decision, res.Stage = Block, StageCodeGraph
			res.SupplyChain = report
			res.Reason = "package " + name + " is on the compromised-package list"
			if report != nil {
				res.GraphQueried = true
				res.Reason += fmt.Sprintf(" — %d dependent(s), %d service(s) exposed, %d shared maintainer(s), found in %.1fms",
					report.Dependents, len(report.ExposedServices), len(report.MaintainerShared), report.BlastRadiusTimeMS)
			}
			res.Message = "Vigil blocked this call: " + res.Reason
			return f.finish(ctx, span, sess, res)
		}

		reason, gf := f.graphPackage(ctx, pkg)
		res.addGraph(gf)
		if reason != "" {
			res.Decision, res.Stage, res.Reason = Block, StageCodeGraph, reason
			res.Message = "Vigil blocked this call: " + res.Reason
			return f.finish(ctx, span, sess, res)
		}
	}

	// --- 2b. Entity policy, unconditional for share-shaped calls -------------
	// A call that names a recipient ("share the export with Sam") is
	// resolved through the enterprise graph before it proceeds: who is
	// this, does the name merge to a protected entity type, does policy
	// deny sharing with them. This is the entity-resolution problem made
	// operational — "Sam" alone tells the deterministic policy layer
	// nothing, but the graph already knows Sam is Soham Ratnaparkhi is
	// S. Ratnaparkhi, and separately knows Jordan Blake resolves to a
	// Customer a policy denies sharing with.
	if entBlocked, entReport := f.checkEntityPolicy(ctx, c); entReport != nil {
		res.GraphQueried = true
		res.GraphPaths = append(res.GraphPaths, entReport.PolicyPaths...)
		if entBlocked {
			res.Decision, res.Stage = Block, StageEntityPolicy
			res.EntityPolicy = entReport
			res.Reason = fmt.Sprintf("%s resolves to entity type %s, denied by policy — aliases: %s",
				entReport.Name, entReport.EntityType, strings.Join(entReport.ResolvedAliases, ", "))
			res.Message = "Vigil blocked this call: " + res.Reason
			return f.finish(ctx, span, sess, res)
		}
	}

	// --- 2c. Rug pull: the tool changed since this agent last used it ---------
	reason, gf := f.checkToolDrift(ctx, agent, c.Tool)
	res.addGraph(gf)
	if reason != "" {
		res.Decision, res.Stage, res.Reason = Pause, StageToolDrift, reason
		res.Message = "Vigil paused this session for review: " + reason
		return f.finish(ctx, span, sess, res)
	}

	// --- 2d. Values flowing across calls and sessions -------------------------
	d, stage, reason, egress, gf := f.checkFlows(ctx, c, caps)
	res.addGraph(gf)
	if d != "" {
		res.Decision, res.Stage, res.Reason, res.egress = d, stage, reason, egress
		if d == Block {
			res.Message = "Vigil blocked this call: " + reason
		} else {
			res.Message = "Vigil paused this session for review: " + reason
		}
		return f.finish(ctx, span, sess, res)
	}

	// --- 3. Cost forecast ----------------------------------------------------
	// Forecast the charge this call *would* incur, not the one already spent —
	// the point is to intervene before the budget is gone.
	fc := f.deps.Forecaster.Compute(time.Now(), c.SessionCost+c.ToolCost, c.Budget, sess.costSamples())
	res.Forecast = fc

	tier := llm.TierNormal
	var signals []string

	if fc.State == StateHardLimit {
		res.Decision, res.Stage = Block, StageForecast
		res.Reason = fmt.Sprintf("budget exhausted: $%.4f of $%.2f", fc.CurrentCost, fc.Budget)
		res.Message = "Vigil blocked this call: " + res.Reason
		return f.finish(ctx, span, sess, res)
	}
	if fc.State == StateSoftLimit {
		// Not a block. A projected breach should reroute to something cheaper,
		// not kill an agent that is still doing useful work.
		signals = append(signals, "cost_soft_limit")
		tier = maxTier(tier, llm.TierSuspicious)
		f.recover(ctx, sess, c, engine.RuleResult{
			RuleName:        "Projected Budget Breach",
			Reason:          fmt.Sprintf("projected $%.4f against a $%.2f budget", fc.ProjectedTotal, fc.Budget),
			Severity:        engine.SeverityMedium,
			AutomaticAction: engine.ActionTriggerFallback,
		})
	}

	// --- 4. Behavioral plugins -------------------------------------------------
	agentCtx := sess.AgentContext(c.Budget, c.Tool, res.sig)
	if f.deps.Gov != nil {
		for _, v := range f.deps.Gov.EvaluateContext(ctx, agentCtx) {
			signals = append(signals, v.RuleName)
			switch v.Severity {
			case engine.SeverityCritical:
				res.Decision, res.Stage = Block, StageBehavior
				res.RuleName, res.Severity, res.Reason = v.RuleName, string(v.Severity), v.Reason
				res.Signals = signals
				res.Message = "Vigil blocked this call: " + v.Reason
				return f.finish(ctx, span, sess, res)
			case engine.SeverityHigh:
				tier = maxTier(tier, llm.TierUncertain)
				res.RuleName, res.Severity = v.RuleName, string(v.Severity)
			default:
				tier = maxTier(tier, llm.TierSuspicious)
			}
		}
	}

	// Neither declared intent nor earned history covers this call: exactly
	// the case a model is for.
	if verdict.Outcome == policy.Uncertain && !graphAllowed {
		signals = append(signals, "intent_uncovered")
		tier = maxTier(tier, llm.TierUncertain)
	}
	res.Signals = signals

	// Something already raised scrutiny: put it in the context of this
	// agent's history (has it ever taken this step) before the judge sees it.
	if len(signals) > 0 {
		res.addGraph(f.graphBehavior(ctx, agent, sess.lastExecuted(), c.Tool))
	}

	// --- 5. Nothing raised scrutiny -----------------------------------------
	if tier == llm.TierNormal {
		res.Decision, res.Stage, res.Reason = Allow, StageDefault, verdict.Reason
		return f.finish(ctx, span, sess, res)
	}

	// --- 6. Model judgement, to tighten only, graph already had its say ------
	if f.deps.Router == nil || !f.deps.Router.Available() {
		// No inference configured, so nothing can adjudicate the uncertainty.
		//
		// An UNCERTAIN intent verdict means the call fell outside a declared
		// allowlist. Allowing it here would make `allowed_tools` advisory on the
		// default configuration -- the operator wrote an allowlist and got a
		// suggestion. It fails closed instead, and says why.
		//
		// Other signals (a soft cost limit, a MEDIUM-severity detector) are
		// warnings rather than exclusions, so those still pass with the signal
		// recorded. Blocking on every signal when the provider is merely
		// unconfigured would make an unconfigured deployment unusable.
		if verdict.Outcome == policy.Uncertain && !graphAllowed {
			res.Decision, res.Stage = Block, StageIntent
			res.Reason = verdict.Reason + " (no judge configured to adjudicate it)"
			res.Signals = signals
			res.Message = "Vigil blocked this call: " + res.Reason
			return f.finish(ctx, span, sess, res)
		}
		res.Decision, res.Stage = Allow, StageDefault
		res.Reason = deterministicReason(signals, verdict.Reason)
		return f.finish(ctx, span, sess, res)
	}

	j, model, err := f.consult(ctx, tier, c, pol, sess, signals)
	if err != nil {
		// Fail closed on the strength of what determinism already found: a HIGH
		// signal we could not adjudicate becomes a block, anything less does
		// not. Never allow *because* the model failed.
		res.Stage = StageJudge
		res.Reason = fmt.Sprintf("model judgement unavailable (%v); deterministic signals: %s", err, strings.Join(signals, ", "))
		if tier >= llm.TierUncertain {
			res.Decision = Block
			res.Message = "Vigil blocked this call: " + res.Reason
		} else {
			res.Decision = Allow
		}
		return f.finish(ctx, span, sess, res)
	}

	res.Stage, res.ModelUsed, res.RiskScore = StageJudge, model, j.score()
	res.Severity = j.Severity
	res.Reason = j.reason()

	switch Decision(j.Decision) {
	case Block:
		res.Decision, res.Message = Block, "Vigil blocked this call: "+res.Reason
	case Pause:
		res.Decision, res.Message = Pause, "Vigil paused this session for review: "+res.Reason
	case Fallback:
		// Vigil does not run the agent's model, so it cannot execute a fallback
		// on the agent's behalf. The call proceeds and the recommendation is
		// surfaced; pretending otherwise would be a fake feature.
		res.Decision = Allow
		res.Reason = "model recommended a cheaper route: " + res.Reason
	default:
		res.Decision = Allow
	}
	return f.finish(ctx, span, sess, res)
}

// judgeBudget bounds the entire escalation stage.
//
// The per-attempt timeout does not bound this: a HighRisk tier walks two roles,
// each re-prompts once on a schema slip, each of those retries transient
// failures, and the chain repeats the whole thing per vendor. Multiplied out
// that is minutes, while the HTTP server's WriteTimeout is 15s — so the agent
// would get a dropped connection instead of a decision, which is a fail-open
// dressed as a network error.
//
// Ten seconds leaves headroom under WriteTimeout. Exceeding it is not an
// outage: the deadline surfaces as an error on the existing fail-closed path,
// so the call is decided on deterministic signals alone.
var judgeBudget = func() time.Duration {
	if v := vigil.Env("JUDGE_BUDGET_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return time.Duration(n) * time.Second
		}
	}
	return 10 * time.Second
}()

// consult asks the model, retrying once on a validation failure.
func (f *Firewall) consult(ctx context.Context, tier llm.Tier, c Call, pol *policy.Policy, sess *Session, signals []string) (judgment, string, error) {
	ctx, cancel := context.WithTimeout(ctx, judgeBudget)
	defer cancel()

	prompt := f.buildPrompt(c, pol, sess, signals)

	var lastErr error
	var lastModel string
	for _, role := range f.deps.Router.RolesFor(tier) {
		if ctx.Err() != nil {
			// Out of budget. Stop rather than walking the remaining roles to
			// collect the same deadline error from each.
			return judgment{}, lastModel, ctx.Err()
		}
		user := prompt
		for attempt := 0; attempt < 2; attempt++ {
			mctx, mspan := telemetry.StartModelCall(ctx, string(role))
			resp, err := f.deps.Router.Complete(mctx, role, llm.Request{
				System: judgeSystemPrompt, User: user, MaxTokens: 500, Temperature: 0, JSONOnly: true,
			})
			var mc telemetry.ModelCall
			if resp != nil {
				mc = telemetry.ModelCall{
					ModelID: resp.ModelID, RequestID: resp.RequestID, Latency: resp.Latency,
					PromptTokens: resp.PromptTokens, CompletionTokens: resp.CompletionTokens,
				}
			}
			telemetry.RecordModelCall(mspan, mc, err)
			mspan.End()

			if err != nil {
				lastErr = err
				break // a transport failure will not be fixed by re-prompting
			}
			lastModel = resp.ModelID

			j, perr := parseJudgment([]byte(resp.Text))
			if perr == nil {
				return j, resp.ModelID, nil
			}
			lastErr = perr
			// Re-prompt once with the validation error appended. Models
			// frequently self-correct a schema slip when shown it.
			user = prompt + "\n\nYour previous reply was rejected: " + perr.Error() + "\nReturn only the required JSON object."
		}
	}
	if lastErr == nil {
		lastErr = llm.ErrNoModel
	}
	return judgment{}, lastModel, lastErr
}

func (f *Firewall) buildPrompt(c Call, pol *policy.Policy, sess *Session, signals []string) string {
	args, _ := json.Marshal(c.Args)
	if len(args) > 2048 {
		args = append(args[:2048], []byte("...[truncated]")...)
	}
	compiled, _ := json.MarshalIndent(pol, "", "  ")

	var history strings.Builder
	for _, sp := range sess.recentTools(10) {
		fmt.Fprintf(&history, "- %s (%s)\n", sp.Name, sp.Status)
	}
	if history.Len() == 0 {
		history.WriteString("- (none)\n")
	}

	intent := pol.DeclaredIntent
	if intent == "" {
		intent = "(no intent declared; permissive baseline in effect)"
	}

	return fmt.Sprintf(`Declared intent: %s

Requested tool: %s
Arguments: %s

Recent tool history:
%s
Budget: $%.2f, spent $%.4f, this call $%.4f

Compiled policy:
%s

Deterministic risk signals already detected: %s`,
		intent, c.Tool, string(args), history.String(),
		c.Budget, c.SessionCost, c.ToolCost, string(compiled),
		orNone(signals))
}

// Commit records a tool call that actually ran, so behavioral and cost history
// reflect executed work rather than attempted work.
func (f *Firewall) Commit(sessionID, tool string, cost float64, dur time.Duration, ok bool) {
	sess := f.sessions.Get(sessionID)
	f.deps.Graph.RecordOutcome(sess.agentID(), sessionID, sess.lastExecuted(), tool, ok, cost)
	status := "ok"
	if !ok {
		status = "error"
	}
	sess.RecordSpan(engine.TraceSpan{
		Signature: sess.sig(tool),
		Name:      tool, Kind: "tool", Duration: dur, Status: status,
	})
	sess.RecordCost(cost, time.Now())
}

// Forecast returns a session's current cost projection.
func (f *Firewall) Forecast(sessionID string, budget float64) Snapshot {
	sess := f.sessions.Get(sessionID)
	return f.deps.Forecaster.Compute(time.Now(), sess.Cost(), budget, sess.costSamples())
}

// Recent returns the most recent decisions, newest last.
func (f *Firewall) Recent(sessionID string, limit int) []Result {
	f.mu.Lock()
	defer f.mu.Unlock()

	out := make([]Result, 0, len(f.recent))
	for _, r := range f.recent {
		if sessionID == "" || r.SessionID == sessionID {
			out = append(out, r)
		}
	}
	if limit > 0 && len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out
}

// DropSession clears a disconnected session's state.
func (f *Firewall) DropSession(id string) {
	f.sessions.Drop(id)
	f.deps.Policies.Drop(id)
}

// finish records the decision to telemetry, the audit chain, and the recent
// ring, then returns it. Every decision passes through here, including ALLOW.
func (f *Firewall) finish(ctx context.Context, span telemetry.Span, sess *Session, res Result) Result {
	telemetry.RecordDecision(span, string(res.Decision), res.Stage, res.Reason, res.RuleName, res.RiskScore, res.ModelUsed)

	// Record refused attempts in the behavioral history (but never charge for
	// them — Commit does cost, and only for calls that ran).
	//
	// Without this a tripped behavioral detector is inescapable: blocked calls
	// would never enter the span history, so the pattern that tripped it could
	// never age out of the window and every subsequent call would be refused
	// forever. Recording the attempt is also the more honest history — an agent
	// hammering a tool it keeps being denied is exactly the behavior worth
	// seeing.
	if res.Decision != Allow {
		sess.RecordSpan(engine.TraceSpan{Name: res.Tool, Signature: res.sig, Kind: "tool", Status: "blocked"})
	} else {
		sess.setSig(res.Tool, res.sig)
	}

	// Audit every decision, not just the blocks. A trail that records only
	// refusals proves nothing about what was allowed through.
	var hash, prevHash string
	if f.deps.Ledger != nil {
		e, err := f.deps.Ledger.Append(audit.Event{
			AgentID:   res.SessionID,
			SessionID: res.SessionID,
			Tool:      res.Tool,
			ArgsHash:  audit.HashArgs(nil),
			Decision:  string(res.Decision),
			Reason:    res.Reason,
			ModelUsed: res.ModelUsed,
			Cost:      res.Cost,
		})
		if err != nil {
			// An audit write failure is an error worth shouting about, but it
			// must not block the tool call: losing the record is bad, wedging
			// the agent because of it is worse.
			f.deps.Logger.ErrorContext(ctx, "vigil: audit append failed", slog.String("error", err.Error()))
		} else {
			hash, prevHash = e.Hash, e.PrevHash
		}
	}

	// Every decision becomes graph history: the evidence trust is earned
	// from, and the hash chain mirrored as (:Decision)-[:PREV]->(:Decision).
	f.deps.Graph.RecordCall(graph.CallRecord{
		ID:    fmt.Sprintf("%s-%d", res.SessionID, res.At.UnixNano()),
		Agent: res.Agent, Session: res.SessionID, Tool: res.Tool, Caps: res.Caps, Repo: res.Repo,
		Model: res.ModelUsed, GraphMS: res.GraphMS, Egress: res.egress,
		Decision: string(res.Decision), Stage: res.Stage, Reason: res.Reason,
		Hash: hash, PrevHash: prevHash, At: res.At,
	})

	f.mu.Lock()
	f.recent = append(f.recent, res)
	if len(f.recent) > f.deps.RecentSize {
		f.recent = f.recent[len(f.recent)-f.deps.RecentSize:]
	}
	f.mu.Unlock()

	if res.Decision != Allow {
		f.deps.Logger.WarnContext(ctx, "vigil: call not allowed",
			slog.String("session", res.SessionID),
			slog.String("tool", res.Tool),
			slog.String("decision", string(res.Decision)),
			slog.String("stage", res.Stage),
			slog.String("reason", res.Reason),
		)
	}
	return res
}

// recover fires the self-healing engine for a synthesized violation.
func (f *Firewall) recover(ctx context.Context, sess *Session, c Call, v engine.RuleResult) {
	if f.deps.Heal == nil {
		return
	}
	f.deps.Heal.ExecuteRecovery(ctx, sess.AgentContext(c.Budget, c.Tool, callSignature(c.Tool, c.Args)), v)
}

func maxTier(a, b llm.Tier) llm.Tier {
	if b > a {
		return b
	}
	return a
}

func deterministicReason(signals []string, fallback string) string {
	if len(signals) == 0 {
		return fallback
	}
	return "allowed with deterministic signals noted: " + strings.Join(signals, ", ")
}

func orNone(s []string) string {
	if len(s) == 0 {
		return "(none)"
	}
	return strings.Join(s, ", ")
}

// Behaviour returns a session's observed behavioural profile.
func (f *Firewall) Behaviour(sessionID string) Behaviour {
	return f.sessions.Get(sessionID).Behaviour()
}

// callSignature identifies one exact call: the tool name alone when it has no
// arguments, else the tool plus a hash of them.
func callSignature(tool string, args map[string]any) string {
	if len(args) == 0 {
		return tool
	}
	raw, _ := json.Marshal(args) // map keys marshal sorted, so this is stable
	sum := sha256.Sum256(raw)
	return tool + "#" + hex.EncodeToString(sum[:8])
}
