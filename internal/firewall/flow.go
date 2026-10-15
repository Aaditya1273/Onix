package firewall

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/Aaditya1273/Vigil/internal/graph"
	"github.com/Aaditya1273/Vigil/internal/policy"
)

// Values that flow between calls, tracked by hash only.
//
// A secret read in session 3 and sent out in session 7 is one graph path:
// (:Call)-[:READ]->(:Value {sensitive})<-[:ARG_CONTAINS]-(:Call). A URL that
// arrived in a fetched web page and later appears in a shell command carries
// the web page's EXTERNAL authority with it.
//
// Known limit: only literal values are matched. A secret that is base64'd,
// split, or paraphrased before it leaves is not.

const maxValues = 300

var (
	// KEY=value, KEY: value, export KEY="value": the shape of .env files,
	// credentials files, and most config.
	assignmentRe = regexp.MustCompile(`(?m)^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.\-]*\s*[=:]\s*["']?([^\s"'#]{8,})`)
	// Credentials with a recognizable prefix, wherever they appear.
	tokenRe = regexp.MustCompile(`\b(?:sk-|sk_live_|ghp_|gho_|github_pat_|AKIA|xox[abprs]-|AIza|glpat-)[A-Za-z0-9_\-]{8,}`)
	urlRe   = regexp.MustCompile(`https?://[^\s"'<>()\[\]{}\\]+`)
	// Argument tokens keep URL and token punctuation, split on the rest.
	argSplitRe = regexp.MustCompile(`[\s"'=&?,;|()<>\[\]{}\\` + "`" + `]+`)
)

func valueHash(v string) string { return graph.Hash("value", strings.TrimRight(v, ".,;:")) }

func hashAll(vals []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(vals))
	for _, v := range vals {
		h := valueHash(v)
		if !seen[h] {
			seen[h] = true
			out = append(out, h)
		}
		if len(out) >= maxValues {
			break
		}
	}
	return out
}

func secretValues(text string) []string {
	var out []string
	for _, m := range assignmentRe.FindAllStringSubmatch(text, maxValues) {
		out = append(out, m[1])
	}
	return append(out, tokenRe.FindAllString(text, maxValues)...)
}

// argTokens are the candidate values a call's arguments carry.
func argTokens(args map[string]any) []string {
	var out []string
	var walk func(any)
	walk = func(v any) {
		switch x := v.(type) {
		case string:
			for _, t := range argSplitRe.Split(x, -1) {
				if len(t) >= 8 {
					out = append(out, t)
				}
			}
		case map[string]any:
			for _, e := range x {
				walk(e)
			}
		case []any:
			for _, e := range x {
				walk(e)
			}
		}
	}
	walk(args)
	return out
}

// Observe records what an executed call produced: secret values it read
// (sensitive) and URLs that arrived from outside (EXTERNAL authority).
func (f *Firewall) Observe(sessionID, tool string, args map[string]any, output string) {
	if !f.deps.Graph.Configured() || output == "" {
		return
	}
	caps := policy.Categories(tool, args)
	if hasCap(caps, policy.CatSecret) {
		f.deps.Graph.RecordValues(sessionID, tool, hashAll(secretValues(output)), true, "TOOL")
	}
	if hasCap(caps, policy.CatNetwork) {
		f.deps.Graph.RecordValues(sessionID, tool, hashAll(urlRe.FindAllString(output, maxValues)), false, "EXTERNAL")
	}
}

// egressCapable: a call that can carry a value off the machine. A tool this
// codebase has no capability model for (an arbitrary MCP tool posting to
// Slack) is assumed to be one.
func egressCapable(tool string, caps []string) bool {
	return hasCap(caps, policy.CatNetwork) || hasCap(caps, policy.CatExec) || !policy.KnownTool(tool)
}

// checkFlows matches the values in a call's arguments against everything the
// tenant has read, in any session. A sensitive value headed somewhere it can
// leave blocks; a URL from external content headed into a shell pauses for a
// human (an EXTERNAL-authority value cannot authorize an exec).
func (f *Firewall) checkFlows(ctx context.Context, c Call, caps []string) (d Decision, stage, reason string, egress []string, gf graphFinding) {
	if !f.deps.Graph.Configured() || !egressCapable(c.Tool, caps) {
		return "", "", "", nil, gf
	}
	toks := argTokens(c.Args)
	if len(toks) == 0 {
		return "", "", "", nil, gf
	}
	start := time.Now()
	ctx, cancel := context.WithTimeout(ctx, graphTimeout)
	defer cancel()
	hits, err := f.deps.Graph.Flows(ctx, hashAll(toks))
	gf.ms = msSince(start)
	if err != nil {
		f.warnGraph(ctx, "value flow lookup", err)
		return "", "", "", nil, gf
	}
	gf.queried = true
	for _, h := range hits {
		gf.paths = append(gf.paths, fmt.Sprintf("session %s --[READ by %s]--> value#%s --[ARG_CONTAINS]--> %s", h.Session, h.Tool, h.Hash[:12], c.Tool))
	}
	for _, h := range hits {
		if h.Sensitive {
			egress = append(egress, h.Hash)
		}
	}
	if len(egress) > 0 {
		h := hits[0]
		for _, x := range hits {
			if x.Sensitive {
				h = x
				break
			}
		}
		return Block, StageExfil, fmt.Sprintf("a sensitive value read by %s in session %s is in this %s call's arguments", h.Tool, h.Session, c.Tool), egress, gf
	}
	if hasCap(caps, policy.CatExec) {
		for _, h := range hits {
			if h.TrustRank == int64(graph.TrustRank["EXTERNAL"]) {
				return Pause, StageProvenance, fmt.Sprintf("this command carries content fetched from outside by %s in session %s; external content cannot authorize a shell command", h.Tool, h.Session), []string{h.Hash}, gf
			}
		}
	}
	return "", "", "", nil, gf
}

// checkToolDrift pauses the first call an agent makes to a tool whose
// description changed since it last used it, with the diff, so a human sees
// the rug pull before the agent acts under the new description.
func (f *Firewall) checkToolDrift(ctx context.Context, agent, tool string) (reason string, gf graphFinding) {
	if !f.deps.Graph.Configured() {
		return "", gf
	}
	start := time.Now()
	ctx, cancel := context.WithTimeout(ctx, graphTimeout)
	defer cancel()
	d, err := f.deps.Graph.ToolDrift(ctx, agent, tool)
	gf.ms = msSince(start)
	if err != nil {
		f.warnGraph(ctx, "tool drift lookup", err)
		return "", gf
	}
	gf.queried = true
	if d == nil {
		return "", gf
	}
	gf.paths = []string{fmt.Sprintf("%s --[HAS_VERSION]--> v2 --[SUPERSEDES]--> v1", tool)}
	return fmt.Sprintf("the description of %s changed since %s last used it; earned trust revoked. was: %q now: %q",
		tool, agent, clip(d.Old, 200), clip(d.New, 200)), gf
}

func hasCap(caps []string, c string) bool {
	for _, x := range caps {
		if x == c {
			return true
		}
	}
	return false
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

func msSince(t time.Time) float64 { return float64(time.Since(t).Microseconds()) / 1000 }
