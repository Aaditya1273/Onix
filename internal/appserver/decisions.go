package appserver

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/Aaditya1273/Vigil/internal/graph"
	"github.com/gorilla/mux"
)

// registerDecisionRoutes serves decisions as the graph stores them: the list,
// and per decision the influence network FalkorDB cut.
func (st *stack) registerDecisionRoutes(api *mux.Router) {
	graphOr503 := func(w http.ResponseWriter) bool {
		if !st.graph.Configured() {
			writeErr(w, http.StatusServiceUnavailable, "FalkorDB is not configured (VIGIL_FALKORDB_URL unset)")
			return false
		}
		return true
	}

	// GET /vigil/graph/decisions?limit=30&all=false: newest first; by default
	// only the ones that stopped, paused or rewrote a call.
	api.HandleFunc("/vigil/graph/decisions", func(w http.ResponseWriter, r *http.Request) {
		if !graphOr503(w) {
			return
		}
		limit := 30
		if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 && n <= 500 {
			limit = n
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		rows, err := st.graph.RecentDecisions(ctx, limit, r.URL.Query().Get("all") == "true")
		if err != nil {
			writeErr(w, http.StatusBadGateway, "graph query failed: "+err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"decisions": rows})
	}).Methods("GET", "OPTIONS")

	// GET /vigil/calls/{id}/effects: what the call was predicted to touch, what
	// it did, and which observed effects nobody predicted.
	api.HandleFunc("/vigil/calls/{id}/effects", func(w http.ResponseWriter, r *http.Request) {
		if !graphOr503(w) {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		pred, obs, hidden, err := st.graph.CallEffects(ctx, mux.Vars(r)["id"])
		if err != nil {
			writeErr(w, http.StatusBadGateway, "graph query failed: "+err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"predicted": pred, "observed": obs, "hidden_effect": hidden})
	}).Methods("GET", "OPTIONS")

	// GET /vigil/decisions/{id}/flow: the call's influence network, capacities
	// and the edges FalkorDB's min cut severed.
	api.HandleFunc("/vigil/decisions/{id}/flow", func(w http.ResponseWriter, r *http.Request) {
		if !graphOr503(w) {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		edges, err := st.graph.CutNetwork(ctx, mux.Vars(r)["id"])
		if err != nil {
			writeErr(w, http.StatusBadGateway, "graph query failed: "+err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"edges":         edges,
			"graph_context": graph.GraphContext{ChunkRelations: []graph.ChunkRelation{{Triplets: graph.FlowTriplets(edges)}}},
		})
	}).Methods("GET", "OPTIONS")
}
