package appserver

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/Aaditya1273/Vigil/internal/graph"
	"github.com/Aaditya1273/Vigil/internal/playground"
	"github.com/Aaditya1273/Vigil/internal/vigil"
	"github.com/Aaditya1273/Vigil/internal/web"
	"github.com/gorilla/mux"
)

// NewPlaygroundServer is hosted mode (VIGIL_PLAYGROUND=1): the public
// playground and nothing else. No control API, no hook endpoint, no MCP
// server, no OAuth: only the playground's three routes, health, and the
// /web pages. Attempts are decided by the real firewall on their own tenant
// graph (VIGIL_ORG_ID, default "playground") and executed by a fake tool
// layer that does no I/O.
func NewPlaygroundServer(addr string, logger *slog.Logger) (*http.Server, error) {
	g, err := graph.New(vigil.EnvOr("FALKORDB_URL", "redis://localhost:6379"), vigil.EnvOr("ORG_ID", "playground"), logger)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := g.SeedPlayground(ctx); err != nil {
		return nil, fmt.Errorf("playground: seed: %w", err)
	}
	run := &playground.Runner{FW: ReplayFirewall(logger, g, nil), G: g}
	limit := playground.NewLimiter(envInt("PLAYGROUND_RATE", 20), time.Minute)
	trustProxy := vigil.Env("TRUST_PROXY") == "1"

	r := mux.NewRouter()
	api := r.PathPrefix("/api/v1").Subrouter()
	api.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "vigil-playground"})
	}).Methods("GET")
	api.HandleFunc("/playground/scenarios", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"scenarios": playground.Scenarios})
	}).Methods("GET")
	api.HandleFunc("/playground/stats", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		st, err := g.PlaygroundStats(ctx)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "graph query failed")
			return
		}
		feed, _ := g.PlaygroundFeed(ctx, 15)
		writeJSON(w, http.StatusOK, map[string]any{"stats": st, "feed": feed})
	}).Methods("GET")
	api.HandleFunc("/playground/attempt", func(w http.ResponseWriter, r *http.Request) {
		if !limit.Allow(clientKey(r, trustProxy), time.Now()) {
			w.Header().Set("Retry-After", "60")
			writeErr(w, http.StatusTooManyRequests, "slow down: a few attempts a minute per visitor")
			return
		}
		var in struct {
			World     string `json:"world"`
			Scenario  string `json:"scenario"`
			Input     string `json:"input"`
			BeforeFix bool   `json:"before_fix"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil || len(in.Input) > 500 {
			writeErr(w, http.StatusBadRequest, "send {world, scenario} or {world, input} (input up to 500 characters)")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		tr, err := run.Run(ctx, in.World, in.Scenario, in.Input, in.BeforeFix)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, tr)
	}).Methods("POST")
	r.PathPrefix("/web/").Handler(web.Handler())
	r.Handle("/", http.RedirectHandler("/web/playground.html", http.StatusFound))
	return &http.Server{Addr: addr, Handler: r, ReadTimeout: 10 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second}, nil
}

// clientKey is what the rate limit counts by. Behind a proxy that sets it
// (Fly, Railway: VIGIL_TRUST_PROXY=1) the first forwarded address; otherwise
// the socket's, since a client can write any header it likes. The key is
// held in memory for a minute and never stored.
func clientKey(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if v := r.Header.Get("Fly-Client-IP"); v != "" {
			return v
		}
		if v := r.Header.Get("X-Forwarded-For"); v != "" {
			return strings.TrimSpace(strings.Split(v, ",")[0])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
