package appserver

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/Aaditya1273/Vigil/internal/audit"
	"github.com/Aaditya1273/Vigil/internal/engine"
	"github.com/Aaditya1273/Vigil/internal/firewall"
	"github.com/Aaditya1273/Vigil/internal/graph"
	"github.com/Aaditya1273/Vigil/internal/policy"
	"github.com/Aaditya1273/Vigil/internal/web"
	"github.com/gorilla/mux"
)

// ReplayFirewall is the live pipeline for recorded history (vigil-cli
// reveal): the same detectors and graph checks, the given graph and audit
// ledger, no recovery actions, no outbound reputation lookups, and no model,
// so every replayed decision is deterministic.
func ReplayFirewall(logger *slog.Logger, g *graph.Client, ledger *audit.Ledger) *firewall.Firewall {
	gov := engine.NewGovernanceEngine(logger, nil)
	registerDetectors(gov)
	return firewall.New(firewall.Deps{
		Logger: logger, Policies: policy.NewStore(), Gov: gov, Ledger: ledger, Graph: g,
		Compromised: firewall.NewCompromisedList(), ReputationURLs: map[string]string{},
	})
}

// RevealPath is the decision that mattered most, drawn: its influence
// network (when a min cut decided it), the counterfactual, and the calls on
// either end of the path.
type RevealPath struct {
	Decision graph.RevealDecision `json:"decision"`
	Why      graph.Why            `json:"why"`
	Network  []graph.FlowEdge     `json:"network"`
	Cause    *graph.RevealCall    `json:"cause,omitempty"`
}

func (st *stack) registerRevealRoutes(api *mux.Router, scan func() any) {
	// GET /vigil/reveal: what a replay of local agent history found.
	api.HandleFunc("/vigil/reveal", func(w http.ResponseWriter, r *http.Request) {
		if !st.graph.Configured() {
			writeErr(w, http.StatusServiceUnavailable, "FalkorDB is not configured")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		sum, err := st.graph.Reveal(ctx, st.fw.TrustThreshold())
		if err != nil {
			writeErr(w, http.StatusBadGateway, "graph query failed: "+err.Error())
			return
		}
		out := map[string]any{"summary": sum}
		if scan != nil {
			out["scan"] = scan()
		}
		if len(sum.Top) > 0 {
			// The one that mattered: the highest-ranked decision whose cause is
			// a single earlier call in another session (the cross-session story),
			// else the highest-ranked one.
			p := RevealPath{Decision: sum.Top[0], Network: []graph.FlowEdge{}}
			p.Why, _ = st.graph.Why(ctx, p.Decision.ID)
			for _, d := range sum.Top {
				w, err := st.graph.Why(ctx, d.ID)
				if err != nil || !w.Flips || w.Cause == "" {
					continue
				}
				if c, err := st.graph.RevealCallByID(ctx, w.Cause); err == nil && c.Session != d.Session {
					p.Decision, p.Why, p.Cause = d, w, &c
					break
				}
			}
			if edges, err := st.graph.CutNetwork(ctx, p.Decision.ID); err == nil && edges != nil {
				p.Network = edges
			}
			out["path"] = p
		}
		if risk, err := st.graph.RiskScores(ctx, time.Unix(0, 0)); err == nil {
			out["risk"] = risk
		}
		writeJSON(w, http.StatusOK, out)
	}).Methods("GET", "OPTIONS")
}

// ServeLocal serves the graph views of one tenant on addr until ctx ends:
// /web/* pages, and the reveal, time-travel, decision and risk APIs. It is
// what vigil-cli reveal opens in the browser.
func ServeLocal(ctx context.Context, ln net.Listener, logger *slog.Logger, fw *firewall.Firewall, g *graph.Client, scan func() any) error {
	st := &stack{fw: fw, graph: g}
	r := mux.NewRouter()
	api := r.PathPrefix("/api/v1").Subrouter()
	st.registerDecisionRoutes(api)
	st.registerRevealRoutes(api, scan)
	r.PathPrefix("/web/").Handler(web.Handler())
	r.Handle("/", http.RedirectHandler("/web/reveal.html", http.StatusFound))
	srv := &http.Server{Handler: r, ReadTimeout: 15 * time.Second, WriteTimeout: 60 * time.Second}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		srv.Shutdown(sctx)
	}()
	if err := srv.Serve(ln); err != http.ErrServerClosed {
		return err
	}
	return nil
}
