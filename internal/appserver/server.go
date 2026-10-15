package appserver

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Aaditya1273/Vigil/internal/cost"
	"github.com/Aaditya1273/Vigil/internal/mcp"
	vigilOAuth "github.com/Aaditya1273/Vigil/internal/oauth"
	"github.com/Aaditya1273/Vigil/internal/policy"
	"github.com/Aaditya1273/Vigil/internal/state"
	"github.com/Aaditya1273/Vigil/internal/telemetry"
	"github.com/Aaditya1273/Vigil/internal/vigil"
	"github.com/gorilla/mux"
)

// NewServer builds the Vigil HTTP server: the MCP endpoint every agent's tool
// calls flow through, the firewall behind it, and the dashboard API.
func NewServer(addr string) *http.Server {
	logger := slog.Default()

	// --- Core Engines ---
	budgetLimit := 100.0
	if v := vigil.Env("BUDGET_LIMIT"); v != "" {
		if parsed, err := strconv.ParseFloat(v, 64); err == nil {
			budgetLimit = parsed
		}
	}
	costFirewall := vigil.NewCostFirewall(budgetLimit)
	costTracker := cost.NewCostTracker()
	policyEngine := cost.NewPolicyEngine(logger, costTracker)

	// burnHistory records the actual cost firewall burn value at each 5-minute mark.
	// This gives the chart real monotonic data instead of fake linear growth.
	const burnHistoryLen = 25
	burnHistory := make([]float64, burnHistoryLen)
	burnLabels := make([]string, burnHistoryLen)
	burnMu := &sync.Mutex{}

	// Pre-fill labels for the last 25 × 5-minute windows
	now0 := time.Now()
	for i := 0; i < burnHistoryLen; i++ {
		t := now0.Add(time.Duration(-(burnHistoryLen-1-i)*5) * time.Minute)
		burnLabels[i] = t.Format("15:04")
		burnHistory[i] = 0
	}

	// Tick every 5 minutes: shift the window and record the real current burn
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			burnMu.Lock()
			copy(burnHistory[:burnHistoryLen-1], burnHistory[1:])
			burnHistory[burnHistoryLen-1] = costFirewall.Burn()
			copy(burnLabels[:burnHistoryLen-1], burnLabels[1:])
			burnLabels[burnHistoryLen-1] = time.Now().Format("15:04")
			burnMu.Unlock()
		}
	}()

	wsHub := state.GetHub()
	agentTracker := state.GetTracker(wsHub)
	agentHub := state.GetAgentHub()

	// --- OAuth 2.1 AS store (Claude Web real connections) ---
	oauthStore := vigilOAuth.NewStore()
	// onTokenMinted is set after mcpServer is created (needs mcpServer reference)
	var onTokenMinted func(sessionID string, budget float64, clientName string)

	r := mux.NewRouter()

	// --- CORS middleware (allows Next.js frontend on any port to call the backend) ---
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-MCP-Session-ID")
			if req.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, req)
		})
	})

	api := r.PathPrefix("/api/v1").Subrouter()

	// --- Health ---
	api.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","service":"vigil"}`))
	}).Methods("GET", "OPTIONS")

	// --- Aggregated Stats (unified — used by Mission Control AND Cost Firewall pages) ---
	api.HandleFunc("/vigil/stats", func(w http.ResponseWriter, r *http.Request) {
		allAgents := agentTracker.GetAllAgents()
		var totalAgents, healthy, blockedCount, activeIncidents int
		for _, a := range allAgents {
			totalAgents++
			switch a.Status {
			case state.StatusRunning:
				healthy++
			case state.StatusBlocked:
				blockedCount++
				activeIncidents++
			case state.StatusDead:
				activeIncidents++
			}
		}

		// Build policy list for Cost Firewall dashboard
		policies := policyEngine.GetPolicies()
		activePolicies := make([]map[string]string, 0, len(policies))
		for _, p := range policies {
			limitStr := strconv.FormatFloat(p.Condition.Threshold, 'f', 2, 64)
			activePolicies = append(activePolicies, map[string]string{
				"name":   p.Name,
				"limit":  "$" + limitStr,
				"action": string(p.Action),
				"status": "Active",
			})
		}

		// Build cost chart from real burnHistory (updated every 5 minutes by the background ticker).
		// The last slot always reflects the current live burn.
		burnMu.Lock()
		data := make([]float64, burnHistoryLen)
		labels := make([]string, burnHistoryLen)
		copy(data, burnHistory)
		copy(labels, burnLabels)
		data[burnHistoryLen-1] = costFirewall.Burn() // always show live value as last point
		burnMu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			// Mission Control fields
			"total_agents":     totalAgents,
			"healthy":          healthy,
			"blocked":          blockedCount,
			"active_incidents": activeIncidents,
			"active_policies":  len(policies),
			"budget":           costFirewall.BudgetLimit,
			"status":           "active",
			// Cost Firewall fields
			"total_cost":           costFirewall.Burn(),
			"chart_data":           data,
			"chart_labels":         labels,
			"current_burn_rate":    costFirewall.Burn(),
			"daily_total":          costFirewall.Burn(),
			"blocked_requests":     blockedCount,
			"active_policies_list": activePolicies,
		})
	}).Methods("GET", "OPTIONS")

	// --- Cost Firewall ---
	api.HandleFunc("/vigil/cost_firewall", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"budget": costFirewall.BudgetLimit, "burn": costFirewall.Burn(), "status": "active",
		})
	}).Methods("GET", "OPTIONS")

	api.HandleFunc("/vigil/cost/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(costTracker.GetMetrics())
	}).Methods("GET", "OPTIONS")

	api.HandleFunc("/vigil/cost/policies", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(policyEngine.GetPolicies())
	}).Methods("GET", "OPTIONS")

	api.HandleFunc("/vigil/cost/policies", func(w http.ResponseWriter, r *http.Request) {
		var pol cost.CostPolicy
		if err := json.NewDecoder(r.Body).Decode(&pol); err != nil {
			http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
			return
		}
		policyEngine.AddPolicy(r.Context(), pol)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"status": "created"})
	}).Methods("POST")

	// --- Agent DNA Profiles — used by the Agent DNA frontend page ---
	// Returns a list of profiles derived from in-memory agent state + DNA baselines.
	api.HandleFunc("/vigil/dna/profiles", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		allAgents := agentTracker.GetAllAgents()
		type DNAProfile struct {
			AgentID               string         `json:"agent_id"`
			BaselineCostPerRun    float64        `json:"baseline_cost_per_run"`
			BaselineLatencyMs     float64        `json:"baseline_latency_ms"`
			BaselineTokenUsage    int            `json:"baseline_token_usage"`
			ToolUsageDistribution map[string]int `json:"tool_usage_distribution"`
			AnomalyScore          float64        `json:"anomaly_score"`
			DriftDetected         bool           `json:"drift_detected"`
			LastUpdated           string         `json:"last_updated"`
			RunCount              int            `json:"run_count"`
			AvgCost               float64        `json:"avg_cost"`
			AvgLatency            int64          `json:"avg_latency"`
			P95Latency            int64          `json:"p95_latency"`
		}
		profiles := make([]DNAProfile, 0, len(allAgents))
		for _, a := range allAgents {
			anomalyScore := 0.1
			driftDetected := false
			if a.CurrentCost > 1.0 {
				anomalyScore = a.CurrentCost / 10.0
				if anomalyScore > 1.0 {
					anomalyScore = 1.0
				}
			}
			if a.Status == state.StatusBlocked || a.Status == state.StatusDead {
				anomalyScore = 0.85
				driftDetected = true
			}
			toolDist := map[string]int{}
			if a.LastTool != "" {
				toolDist[a.LastTool] = 1
			}
			profiles = append(profiles, DNAProfile{
				AgentID:               a.AgentID,
				BaselineCostPerRun:    0.05,
				BaselineLatencyMs:     150.0,
				BaselineTokenUsage:    800,
				ToolUsageDistribution: toolDist,
				AnomalyScore:          anomalyScore,
				DriftDetected:         driftDetected,
				LastUpdated:           a.UpdatedAt.Format(time.RFC3339),
				RunCount:              a.CurrentTokens / 100,
				AvgCost:               a.CurrentCost,
				AvgLatency:            a.LatencyMs,
				P95Latency:            a.LatencyMs * 2,
			})
		}
		json.NewEncoder(w).Encode(profiles)
	}).Methods("GET", "OPTIONS")

	// --- MCP Server (Claude Web + Claude Desktop + Cursor integration) ---
	// The MCP server lets any MCP client connect to ARGUS as a tool server.
	// Claude Web connects via OAuth 2.1 Bearer token (real connection).
	// Claude Desktop connects via SSE session (config-based).
	// Every tool call is intercepted, metered for cost, and streamed to the
	// Next.js Control Plane via WebSocket.
	mcpServer := mcp.NewMCPServerHTTP(logger, ".")

	// --- Vigil 2.0 governance stack ---
	// Builds the governance engine, recovery actions, model router, audit
	// ledger, and decision pipeline, then puts the pipeline on the tool-call
	// hot path. Before this the engine and its plugins existed but were
	// referenced only from tests.
	vigilStack := buildStack(logger, budgetLimit)
	mcpServer.Core().SetFirewall(vigilStack.mcpAdapter())
	// vigil_agent_dna reports what the firewall has actually observed for a
	// session, rather than the fixed demo fingerprint it used to return.
	// Session-control routes mutate enforcement state, so they take the same
	// operator guard as the kill switch.
	mcpServer.SetControlGuard(requireControlAuth)
	mcpServer.Core().SetBehaviour(func(sessionID string) any {
		return vigilStack.fw.Behaviour(sessionID)
	})
	vigilStack.registerRoutes(api, mcpServer.Core(), budgetLimit)

	// Now that mcpServer exists, wire up the OAuth token-minted callback.
	// Called when Claude Web completes OAuth and gets a Bearer token — pre-registers the session.
	onTokenMinted = func(sessionID string, budget float64, clientName string) {
		mcpServer.Core().PutSession(mcp.ClientSession{
			ID:            sessionID,
			ClientName:    clientName,
			ClientVersion: "claude-web",
			ConnectedAt:   time.Now(),
			BudgetLimit:   budget,
		})
		agentTracker.UpsertAgent(&state.AgentState{
			AgentID:  sessionID,
			Status:   state.StatusRunning,
			LastTool: "connected",
		})
		// The budget the user approved during consent becomes the session's
		// policy budget, so cost enforcement and the consent screen agree.
		vigilStack.policies.Set(policy.Default(sessionID, budget))
		wsHub.BroadcastMessage(map[string]interface{}{
			"type":  "MCP_EVENT",
			"event": "mcp_client_connected",
			"data": map[string]interface{}{
				"client_id":   sessionID,
				"client_name": clientName,
				"budget":      budget,
				"source":      "claude-web",
			},
			"timestamp": time.Now(),
		})
		// Emit a real span for the OAuth connection
		telemetry.RecordSessionConnect(context.Background(), sessionID, clientName, budget)
		logger.InfoContext(context.Background(), "argus oauth: Claude Web session activated",
			slog.String("session_id", sessionID),
			slog.Float64("budget", budget),
			slog.String("client", clientName),
		)
	}

	// Wire the cost firewall: every MCP tool call reports cost to ARGUS
	mcpServer.Core().SetCostCallback(func(agentID string, toolCost, sessionTotal float64, tool string) {
		fleetBurn := costFirewall.Add(toolCost)
		agentTracker.UpsertAgent(&state.AgentState{
			AgentID:       agentID,
			Status:        state.StatusRunning,
			CurrentCost:   sessionTotal, // this session's own spend, not the fleet total
			CurrentTokens: 0,
			LatencyMs:     0,
			LastTool:      tool,
		})
		logger.InfoContext(context.Background(), "argus mcp: tool call cost tracked",
			slog.String("agent", agentID),
			slog.String("tool", tool),
			slog.Float64("cost", toolCost),
			slog.Float64("session_total", sessionTotal),
			slog.Float64("fleet_burn", fleetBurn),
			slog.Float64("budget", costFirewall.BudgetLimit),
		)

		// Emit a real OTel span to whatever OTLP endpoint is configured
		telemetry.RecordMCPToolCall(context.Background(), agentID, tool, toolCost, sessionTotal)

		// Broadcast via WebSocket so the frontend updates in real-time
		wsHub.BroadcastMessage(map[string]interface{}{
			"type":      "MCP_TOOL_CALL",
			"agent_id":  agentID,
			"tool":      tool,
			"cost":      toolCost,
			"total":     sessionTotal,
			"budget":    costFirewall.BudgetLimit,
			"timestamp": time.Now(),
		})
	})

	// Wire the event stream: MCP connect/disconnect/block events go to frontend
	mcpServer.Core().SetEventCallback(func(eventType string, data any) {
		wsHub.BroadcastMessage(map[string]interface{}{
			"type":      "MCP_EVENT",
			"event":     eventType,
			"data":      data,
			"timestamp": time.Now(),
		})
	})

	// Mount MCP routes on the API subrouter
	mcpServer.RegisterRoutes(api)

	// --- OAuth 2.1 AS routes (enables Claude Web real connection) ---
	// Mounts: /.well-known/*, /register, /authorize, /token on root router
	// Mounts: /api/v1/vigil/oauth/* consent API on api subrouter
	vigilOAuth.RegisterRoutes(r, api, oauthStore, onTokenMinted)

	// --- Override the MCP POST handler to authenticate Bearer tokens from Claude Web ---
	// When Claude Web connects via OAuth 2.1 it sends Authorization: Bearer rmt_at_...
	// We resolve that token to a ClientSession and proceed normally.
	api.HandleFunc("/mcp/bearer", func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")

		if req.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
			w.WriteHeader(http.StatusNoContent)
			return
		}

		// Extract Bearer token
		authHeader := req.Header.Get("Authorization")
		rawToken := strings.TrimPrefix(authHeader, "Bearer ")
		rawToken = strings.TrimPrefix(rawToken, "bearer ")
		if rawToken == "" || rawToken == authHeader {
			w.WriteHeader(http.StatusUnauthorized)
			w.Header().Set("WWW-Authenticate", `Bearer resource_metadata="`+vigilOAuth.PublicBase()+`/.well-known/oauth-protected-resource"`)
			json.NewEncoder(w).Encode(map[string]string{"error": "missing bearer token"})
			return
		}

		tok := oauthStore.GetByBearerToken(rawToken)
		if tok == nil {
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid or expired token"})
			return
		}

		// Route to the MCP core handler using the session ID as client ID
		body, err := io.ReadAll(req.Body)
		if err != nil {
			http.Error(w, `{"error":"read error"}`, http.StatusBadRequest)
			return
		}
		response := mcpServer.Core().HandleRequest(req.Context(), body, tok.SessionID)
		if response == nil {
			w.WriteHeader(http.StatusAccepted)
			w.Write([]byte(`{}`))
			return
		}
		json.NewEncoder(w).Encode(response)
	}).Methods("POST", "OPTIONS")

	logger.InfoContext(context.Background(), "argus: OAuth 2.1 AS initialized",
		slog.String("authorize", "/authorize"),
		slog.String("token", "/token"),
		slog.String("register", "/register"),
		slog.String("discovery", "/.well-known/oauth-authorization-server"),
	)

	logger.InfoContext(context.Background(), "argus: MCP server initialized",
		slog.String("endpoint", "/api/v1/mcp"),
	)

	// --- WebSocket ---
	api.HandleFunc("/vigil/ws", func(w http.ResponseWriter, r *http.Request) {
		state.ServeWs(w, r)
	})

	api.HandleFunc("/vigil/agent-ws", func(w http.ResponseWriter, r *http.Request) {
		state.ServeAgentWs(w, r)
	})

	// --- Agent Management ---
	api.HandleFunc("/vigil/agents", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		agents := agentTracker.GetAllAgents()
		if agents == nil {
			agents = []state.AgentState{}
		}
		json.NewEncoder(w).Encode(agents)
	}).Methods("GET", "OPTIONS")

	for _, action := range []string{"kill", "pause", "resume"} {
		a := action
		api.HandleFunc("/vigil/agents/{id}/"+a, requireControlAuth(func(w http.ResponseWriter, r *http.Request) {
			id := mux.Vars(r)["id"]
			switch a {
			case "kill":
				agentTracker.UpdateStatus(id, state.StatusDead)
				agentHub.SendCommand(id, "KILL")
			case "pause":
				agentTracker.UpdateStatus(id, state.StatusPaused)
				agentHub.SendCommand(id, "PAUSE")
			case "resume":
				agentTracker.UpdateStatus(id, state.StatusRunning)
				agentHub.SendCommand(id, "RESUME")
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"status": "ok", "agent_id": id, "action": a})
		})).Methods("POST", "OPTIONS")
	}

	return &http.Server{
		Addr:        addr,
		Handler:     legacyPathRewrite(r),
		ReadTimeout: 15 * time.Second,
		// WriteTimeout must exceed the firewall's judge budget (10s by default,
		// VIGIL_JUDGE_BUDGET_SECONDS). If it does not, a tool call that escalates
		// to the model has its connection closed mid-decision — the agent sees a
		// dropped socket instead of a BLOCK, which is a fail-open wearing a
		// network error's clothes.
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
}

// legacyPathRewrite maps the pre-rename /api/v1/argus/* paths onto their
// canonical /api/v1/vigil/* equivalents before routing.
//
// Deployments provisioned before the ARGUS → Vigil rename (and any dashboard
// build not yet redeployed) still call the old paths. Rewriting here rather
// than registering every route twice keeps the alias in one place and makes it
// trivial to delete once no old clients remain.
func legacyPathRewrite(next http.Handler) http.Handler {
	const legacy, canonical = "/api/v1/argus/", "/api/v1/vigil/"
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, legacy) {
			r.URL.Path = canonical + strings.TrimPrefix(r.URL.Path, legacy)
		}
		next.ServeHTTP(w, r)
	})
}
