package appserver

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/Aaditya1273/Vigil/internal/graph"
	"github.com/gorilla/mux"
)

// registerTimelineRoutes serves time travel: the scrubber's ticks, the
// subgraph as of a moment, and "why?" at that moment.
func (st *stack) registerTimelineRoutes(api *mux.Router) {
	ready := func(w http.ResponseWriter) bool {
		if !st.graph.Configured() {
			writeErr(w, http.StatusServiceUnavailable, "FalkorDB is not configured")
			return false
		}
		return true
	}
	at := func(r *http.Request) int64 {
		if t, err := strconv.ParseInt(r.URL.Query().Get("t"), 10, 64); err == nil && t > 0 {
			return t
		}
		return time.Now().UnixNano()
	}

	// GET /vigil/timeline/ticks?limit=20000: one tick per decision, oldest first.
	api.HandleFunc("/vigil/timeline/ticks", func(w http.ResponseWriter, r *http.Request) {
		if !ready(w) {
			return
		}
		limit := 20000
		if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 && n <= 100000 {
			limit = n
		}
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		ticks, err := st.graph.Ticks(ctx, limit)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "graph query failed: "+err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ticks": ticks})
	}).Methods("GET", "OPTIONS")

	// GET /vigil/timeline/asof?id=<decision>&t=<unix ns>: the subgraph around
	// that call as it stood at t.
	api.HandleFunc("/vigil/timeline/asof", func(w http.ResponseWriter, r *http.Request) {
		if !ready(w) {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		t := at(r)
		edges, err := st.graph.AsOf(ctx, r.URL.Query().Get("id"), t)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "graph query failed: "+err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"t": t, "edges": edges})
	}).Methods("GET", "OPTIONS")

	// GET /vigil/timeline/why?id=<decision>&t=<unix ns>: the counterfactual for
	// that decision once it exists; before it, for the latest stop up to t.
	api.HandleFunc("/vigil/timeline/why", func(w http.ResponseWriter, r *http.Request) {
		if !ready(w) {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		t, id := at(r), r.URL.Query().Get("id")
		if id != "" {
			if c, err := st.graph.RevealCallByID(ctx, id); err != nil || c.TS == 0 || c.TS > t {
				id = ""
			}
		}
		if id == "" {
			var err error
			if id, err = st.graph.LatestStop(ctx, t); err != nil {
				writeErr(w, http.StatusBadGateway, "graph query failed: "+err.Error())
				return
			}
		}
		if id == "" {
			writeJSON(w, http.StatusOK, map[string]any{"t": t, "why": graph.Why{Sentence: "Nothing had been stopped yet at this moment."}})
			return
		}
		why, err := st.graph.Why(ctx, id)
		if err != nil {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"t": t, "why": why})
	}).Methods("GET", "OPTIONS")
}
