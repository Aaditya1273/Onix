package appserver

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/mux"
)

// registerLedgerRoutes serves the Agent Risk Score and the underwriting
// ledger export, and stores a RiskSnapshot every day.
func (st *stack) registerLedgerRoutes(api *mux.Router, logger *slog.Logger) {
	if !st.graph.Configured() {
		return
	}
	window := func(r *http.Request) time.Duration {
		days := 7
		if n, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil && n > 0 && n <= 3650 {
			days = n
		}
		return time.Duration(days) * 24 * time.Hour
	}

	snapshot := func(ctx context.Context) error {
		now := time.Now()
		scores, err := st.graph.RiskScores(ctx, now.Add(-7*24*time.Hour))
		if err != nil {
			return err
		}
		return st.graph.SnapshotRisk(ctx, scores, now)
	}
	go func() {
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			if err := snapshot(ctx); err != nil {
				logger.Warn("vigil: daily risk snapshot failed", slog.String("error", err.Error()))
			}
			cancel()
			time.Sleep(24 * time.Hour)
		}
	}()

	// GET /vigil/risk?days=7: current scores per agent and for the tenant
	// ("*"), the formula's inputs, and the stored daily history. Also stores
	// today's snapshot.
	api.HandleFunc("/vigil/risk", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		since := time.Now().Add(-window(r))
		scores, err := st.graph.RiskScores(ctx, since)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "graph query failed: "+err.Error())
			return
		}
		if err := st.graph.SnapshotRisk(ctx, scores, time.Now()); err != nil {
			writeErr(w, http.StatusBadGateway, "snapshot failed: "+err.Error())
			return
		}
		history, err := st.graph.RiskHistory(ctx, since)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "graph query failed: "+err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"scores": scores, "history": history})
	}).Methods("GET", "OPTIONS")

	// GET /vigil/ledger/export?days=7: the hash-chained decision ledger with
	// its graph evidence, as a JSON file. Verify with `vigil-cli verify-ledger`.
	api.HandleFunc("/vigil/ledger/export", requireControlAuth(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()
		to := time.Now()
		l, err := st.graph.ExportLedger(ctx, to.Add(-window(r)), to)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "graph query failed: "+err.Error())
			return
		}
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="vigil-ledger-%s-%s.json"`, l.Tenant, to.UTC().Format("20060102T150405Z")))
		writeJSON(w, http.StatusOK, l)
	})).Methods("GET", "OPTIONS")
}
