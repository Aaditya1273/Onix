package appserver

import (
	"context"
	"log/slog"
	"strconv"
	"time"

	"github.com/Aaditya1273/Vigil/internal/audit"
	"github.com/Aaditya1273/Vigil/internal/engine"
	"github.com/Aaditya1273/Vigil/internal/engine/plugins"
	"github.com/Aaditya1273/Vigil/internal/firewall"
	"github.com/Aaditya1273/Vigil/internal/graph"
	"github.com/Aaditya1273/Vigil/internal/llm"
	"github.com/Aaditya1273/Vigil/internal/policy"
	"github.com/Aaditya1273/Vigil/internal/recovery"
	"github.com/Aaditya1273/Vigil/internal/recovery/actions"
	"github.com/Aaditya1273/Vigil/internal/state"
	"github.com/Aaditya1273/Vigil/internal/vigil"
)

// stack holds the governance components. Construction lives here rather than in
// NewServer, which is already a 900-line function.
type stack struct {
	fw       *firewall.Firewall
	policies *policy.Store
	gov      *engine.GovernanceEngine
	heal     *recovery.SelfHealingEngine
	router   *llm.Router
	ledger   *audit.Ledger
	graph    *graph.Client
}

// buildStack assembles the governance pipeline.
func buildStack(logger *slog.Logger, budgetLimit float64) *stack {
	ctx := context.Background()

	// --- Recovery actions ---------------------------------------------------
	heal := recovery.NewSelfHealingEngine(logger)
	heal.RegisterAction(actions.NewKillAgentAction())
	heal.RegisterAction(actions.NewFallbackModelAction())
	heal.RegisterAction(actions.NewRetryAction())
	heal.RegisterAction(actions.NewReduceContextAction())
	heal.RegisterAction(actions.NewSwitchPromptAction())
	heal.RegisterAction(actions.NewDisableToolAction())
	heal.RegisterAction(actions.NewCircuitBreakerAction())
	heal.RegisterAction(actions.NewEscalateHumanAction())
	heal.RegisterAction(actions.NewAlertAction(broadcastAlert))

	// --- Governance engine ---------------------------------------------------
	// This closure is the single line that makes the recovery actions live: the
	// engine already calls its hook per violation, it simply never had one.
	gov := engine.NewGovernanceEngine(logger, func(ctx context.Context, agentCtx *engine.AgentContext, v engine.RuleResult) {
		heal.ExecuteRecovery(ctx, agentCtx, v)
	})

	// Only the detectors that can actually fire on MCP data are registered.
	//
	// TokenExplosion, RepeatedPrompt, and PromptRecursion read InputTokens,
	// OutputTokens, and PromptText. An MCP *tool* call carries none of those,
	// because Vigil intercepts tool calls, not the agent's LLM turns.
	// Registering them would be dead code presented as coverage, and the
	// governance endpoint would report nine active rules when six can fire.
	// They become registerable when an SDK-side span-ingest path exists.
	gov.RegisterPlugin(plugins.NewInfiniteLoopDetector(envInt("LOOP_MAX_REPEATS", 5)))
	gov.RegisterPlugin(plugins.NewBudgetExceededDetector())
	gov.RegisterPlugin(plugins.NewRetryStormDetector(envInt("RETRY_STORM_MAX", 3)))
	gov.RegisterPlugin(plugins.NewLatencySpikeDetector(envDuration("LATENCY_SPIKE", 30*time.Second)))
	gov.RegisterPlugin(plugins.NewToolTimeoutDetector(envDuration("TOOL_TIMEOUT", 60*time.Second)))
	gov.RegisterPlugin(plugins.NewAgentStuckDetector(envDuration("AGENT_STUCK", 120*time.Second)))

	// --- Inference -----------------------------------------------------------
	var provider llm.Provider = llm.DeterministicProvider{}
	if chain := llm.ChainFromEnv(logger); chain == nil {
		// Info, not warn: running without inference is a supported
		// configuration, not a degraded one. Deterministic checks still govern.
		logger.InfoContext(ctx, "vigil: no inference credentials, running deterministic-only")
	} else {
		provider = chain
		logger.InfoContext(ctx, "vigil: inference configured",
			slog.String("provider", chain.Name()),
			slog.Any("roles", chain.ConfiguredRoles()),
		)
		// In the background: startup must not block on a vendor's network. The
		// firewall works from the first request either way — an unprobed vendor
		// is simply one that has not been verified yet.
		go func() {
			pctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			chain.Probe(pctx)
		}()
	}
	router := llm.NewRouter(logger, provider)

	// --- Audit ledger --------------------------------------------------------
	var ledger *audit.Ledger
	ledgerPath := vigil.EnvOr("AUDIT_PATH", audit.DefaultPath)
	if l, err := audit.Open(ledgerPath); err != nil {
		// Error-level, but not fatal. Losing the audit record is bad; wedging
		// every agent in the deployment because of it is worse.
		logger.ErrorContext(ctx, "vigil: could not open audit ledger, decisions will not be recorded",
			slog.String("path", ledgerPath),
			slog.String("error", err.Error()),
		)
	} else {
		ledger = l
		logger.InfoContext(ctx, "vigil: audit ledger open",
			slog.String("path", ledgerPath),
			slog.Int("existing_events", l.Len()),
		)
	}

	// --- FalkorDB: the firewall's memory -------------------------------------
	// nil when unconfigured; every graph.Client method is a safe no-op on a nil
	// receiver. Index creation runs in the background so a slow or absent
	// database never delays the first request.
	graphClient := graph.NewFromEnv(logger)
	if graphClient == nil {
		logger.InfoContext(ctx, "vigil: VIGIL_FALKORDB_URL unset, running without graph memory")
	} else {
		go func() {
			sctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err := graphClient.EnsureSchema(sctx); err != nil {
				logger.ErrorContext(ctx, "vigil: FalkorDB schema setup failed", slog.String("error", err.Error()))
				return
			}
			logger.InfoContext(ctx, "vigil: FalkorDB ready", slog.String("graph", graphClient.Graph()))
		}()
	}

	policies := policy.NewStore()
	fc := firewall.DefaultForecaster()
	if v := vigil.Env("SOFT_LIMIT_PCT"); v != "" {
		if p, err := strconv.ParseFloat(v, 64); err == nil && p > 0 && p <= 1 {
			fc.SoftLimitPct = p
		}
	}

	fw := firewall.New(firewall.Deps{
		Logger:      logger,
		Policies:    policies,
		Gov:         gov,
		Heal:        heal,
		Router:      router,
		Ledger:      ledger,
		Forecaster:  fc,
		Graph:       graphClient,
		Compromised: firewall.NewCompromisedList(),
	})

	logger.InfoContext(ctx, "vigil: governance engine active",
		slog.Any("plugins", gov.Plugins()),
		slog.Float64("budget_limit", budgetLimit),
		slog.Bool("inference", router.Available()),
		slog.Bool("audit", ledger != nil),
		slog.Bool("graph", graphClient.Configured()),
	)

	return &stack{fw: fw, policies: policies, gov: gov, heal: heal, router: router, ledger: ledger, graph: graphClient}
}

// broadcastAlert pushes a governance alert to the dashboard over the existing
// WebSocket hub. Slack and webhook delivery are configured separately by the
// integrations package; this is the always-available floor.
func broadcastAlert(ctx context.Context, agentCtx *engine.AgentContext, v engine.RuleResult) error {
	state.GetHub().BroadcastMessage(map[string]any{
		"type":      "VIGIL_ALERT",
		"rule":      v.RuleName,
		"severity":  string(v.Severity),
		"reason":    v.Reason,
		"action":    string(v.AutomaticAction),
		"agent_id":  agentCtx.TraceID,
		"timestamp": time.Now(),
	})
	return nil
}

func envInt(name string, def int) int {
	if v := vigil.Env(name); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

func envDuration(name string, def time.Duration) time.Duration {
	if v := vigil.Env(name); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			return d
		}
	}
	return def
}
