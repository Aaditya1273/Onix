package firewall

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/Aaditya1273/Vigil/internal/graph"
	"github.com/Aaditya1273/Vigil/internal/vigil"
)

// Scan-time reputation from outside scanners (CraftedTrust, Dominion
// Observatory), ingested as EXTERNAL facts on the tool's current version. A
// low score raises scrutiny on the call; no score, however high, earns
// anything: earned autonomy is computed from this tenant's own clean history
// (USER_HISTORY) and never reads these facts.

var reputationClient = &http.Client{Timeout: 5 * time.Second}

var defaultReputationURLs = map[string]string{
	"craftedtrust": "https://craftedtrust.com",
	"dominion":     "https://dominionobservatory.com",
}

// reputationURLs is Deps.ReputationURLs, else VIGIL_CRAFTEDTRUST_URL and
// VIGIL_DOMINION_URL over the public defaults; "off" disables a source.
func (f *Firewall) reputationURLs() map[string]string {
	if f.deps.ReputationURLs != nil {
		return f.deps.ReputationURLs
	}
	out := map[string]string{}
	for name, def := range defaultReputationURLs {
		u := vigil.Env(strings.ToUpper(name) + "_URL")
		if u == "" {
			u = def
		}
		if u != "off" {
			out[name] = strings.TrimRight(u, "/")
		}
	}
	return out
}

// mcpServerName is the server part of mcp__server__tool.
func mcpServerName(tool string) string {
	if rest, ok := strings.CutPrefix(tool, "mcp__"); ok {
		server, _, _ := strings.Cut(rest, "__")
		return server
	}
	return tool
}

// sameServer matches a scanner's name for a server against ours exactly,
// after dropping an npm scope and the usual mcp affixes. Search results are
// fuzzy; attaching a score to the wrong server would be worse than none.
// ponytail: matches by name, so two servers sharing a name are confused; pin
// by package URL at tool registration if that ambiguity starts to matter.
func sameServer(ours, theirs string) bool {
	norm := func(s string) string {
		s = strings.ToLower(strings.TrimSpace(s))
		if i := strings.LastIndex(s, "/"); i >= 0 {
			s = s[i+1:]
		}
		for _, a := range []string{"mcp-server-", "server-", "mcp-"} {
			s = strings.TrimPrefix(s, a)
		}
		for _, a := range []string{"-mcp-server", "-server", "-mcp"} {
			s = strings.TrimSuffix(s, a)
		}
		return s
	}
	return ours != "" && norm(ours) == norm(theirs)
}

func getJSON(ctx context.Context, rawURL string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	resp, err := reputationClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(v)
}

// GET {base}/api/v1/search?q= → results[].{name, url, trustScore, grade, trustLabel}
func craftedTrust(ctx context.Context, base, server string) (graph.ExternalScore, bool, error) {
	var body struct {
		Results []struct {
			Name       string   `json:"name"`
			URL        string   `json:"url"`
			TrustScore *float64 `json:"trustScore"`
			Grade      string   `json:"grade"`
			TrustLabel string   `json:"trustLabel"`
		} `json:"results"`
	}
	if err := getJSON(ctx, base+"/api/v1/search?q="+url.QueryEscape(server), &body); err != nil {
		return graph.ExternalScore{}, false, err
	}
	for _, r := range body.Results {
		if sameServer(server, r.Name) || sameServer(server, path.Base(r.URL)) {
			s := graph.ExternalScore{Score: -1, Label: strings.TrimSpace(r.Grade + " " + r.TrustLabel), URL: r.URL}
			if r.TrustScore != nil {
				s.Score = *r.TrustScore
			}
			return s, true, nil
		}
	}
	return graph.ExternalScore{}, false, nil
}

// GET {base}/api/trust?url= → {found, name, rating, trust_score|null, server_url}.
// An UNRATED server's static_metadata_score is, in Dominion's own words, not a
// measured trust score, so it is not stored as one.
func dominion(ctx context.Context, base, server string) (graph.ExternalScore, bool, error) {
	var body struct {
		Found      bool     `json:"found"`
		Name       string   `json:"name"`
		Rating     string   `json:"rating"`
		TrustScore *float64 `json:"trust_score"`
		ServerURL  string   `json:"server_url"`
	}
	if err := getJSON(ctx, base+"/api/trust?url="+url.QueryEscape(server), &body); err != nil {
		return graph.ExternalScore{}, false, err
	}
	if !body.Found || !(sameServer(server, body.Name) || sameServer(server, path.Base(body.ServerURL))) {
		return graph.ExternalScore{}, false, nil
	}
	s := graph.ExternalScore{Score: -1, Label: body.Rating, URL: body.ServerURL}
	if body.TrustScore != nil {
		s.Score = *body.TrustScore
	}
	return s, true, nil
}

// IngestReputation asks each scanner about the tool's MCP server and stores
// what it says on the tool's current version. A scanner that is down, slow,
// or does not know the server is skipped and listed in unavailable: scan-time
// reputation is optional evidence and its absence changes no decision.
func (f *Firewall) IngestReputation(ctx context.Context, tool string) (stored []graph.ExternalScore, unavailable []string) {
	if !f.deps.Graph.Configured() {
		return nil, nil
	}
	server := mcpServerName(tool)
	for name, base := range f.reputationURLs() {
		var (
			s     graph.ExternalScore
			found bool
			err   error
		)
		switch name {
		case "craftedtrust":
			s, found, err = craftedTrust(ctx, base, server)
		case "dominion":
			s, found, err = dominion(ctx, base, server)
		default:
			continue
		}
		if err != nil {
			f.deps.Logger.WarnContext(ctx, "vigil: reputation source unavailable", slog.String("source", name), slog.String("error", err.Error()))
			unavailable = append(unavailable, name+": "+err.Error())
			continue
		}
		if !found {
			unavailable = append(unavailable, name+": no exact match for "+server)
			continue
		}
		s.Source, s.Server, s.Trust = name, server, "EXTERNAL"
		ok, err := f.deps.Graph.RecordReputation(ctx, tool, s)
		switch {
		case err != nil:
			f.warnGraph(ctx, "record reputation", err)
			unavailable = append(unavailable, name+": graph write failed")
		case !ok:
			unavailable = append(unavailable, name+": "+tool+" has no registered version to attach a score to")
		default:
			stored = append(stored, s)
		}
	}
	sort.Slice(stored, func(i, j int) bool { return stored[i].Source < stored[j].Source })
	sort.Strings(unavailable)
	return stored, unavailable
}

// checkReputation is a scrutiny signal: an outside scanner rated this tool's
// current version below graph.LowReputation.
func (f *Firewall) checkReputation(ctx context.Context, tool string) (low bool, gf graphFinding) {
	if !f.deps.Graph.Configured() {
		return false, gf
	}
	start := time.Now()
	ctx, cancel := context.WithTimeout(ctx, graphTimeout)
	defer cancel()
	scores, err := f.deps.Graph.Reputation(ctx, tool)
	gf.ms = msSince(start)
	if err != nil {
		f.warnGraph(ctx, "reputation lookup", err)
		return false, gf
	}
	gf.queried = true
	for _, s := range scores {
		if s.Low() {
			low = true
			gf.paths = append(gf.paths, fmt.Sprintf("Fact{trust:EXTERNAL, %s %.0f/100} --[ABOUT]--> %s ToolVersion", s.Source, s.Score, tool))
		}
	}
	return low, gf
}
