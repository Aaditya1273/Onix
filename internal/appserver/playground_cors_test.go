package appserver

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// The dashboard's playground page calls the hosted playground from another
// origin: preflight answers without reaching the routes, and replies carry
// the header the browser checks.
func TestPlaygroundAllowsAnyOrigin(t *testing.T) {
	reached := false
	h := allowAnyOrigin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached = true }))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodOptions, "/api/v1/playground/attempt", nil))
	if rec.Code != http.StatusNoContent || reached || rec.Header().Get("Access-Control-Allow-Methods") == "" {
		t.Fatalf("preflight: %d reached=%v headers=%v", rec.Code, reached, rec.Header())
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/playground/stats", nil))
	if !reached || rec.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("get: reached=%v headers=%v", reached, rec.Header())
	}
}

func TestDashboardOriginsFromEnv(t *testing.T) {
	t.Setenv("VIGIL_ALLOWED_ORIGINS", " https://a.example/ ,https://b.example")
	t.Setenv("VIGIL_DASHBOARD_BASE", "https://c.example")
	got := dashboardOrigins()
	if len(got) != 3 || got[0] != "https://a.example" || got[1] != "https://b.example" || got[2] != "https://c.example" {
		t.Fatalf("origins: %q", got)
	}
}
