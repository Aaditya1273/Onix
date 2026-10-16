package firewall

import (
	"context"
	"fmt"
	"regexp"
	"sort"
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

// flowVerdict is what the value-flow stage decided, from FalkorDB's cut.
type flowVerdict struct {
	decision     Decision // "" when the call may proceed (no cut, or a redact cut)
	stage        string
	reason       string
	egress       []string // hashes of sensitive values the call carried
	cut          graph.Cut
	redactTokens []string // the literal tainted values to scrub from a redacted call
}

// checkFlows matches the values in a call's arguments against everything the
// tenant has read, in any session. If any sensitive value is headed somewhere
// it can leave, or external content is headed into a shell, the decision is
// FalkorDB's: VIGIL builds the call's influence network and the min cut of
// that network (algo.maxFlow) says what to do. A terminal cut blocks (or, for
// external content only, asks a human); an argument cut redacts exactly those
// arguments and lets the rewritten call through.
func (f *Firewall) checkFlows(ctx context.Context, c Call, caps []string, callID string) (fv flowVerdict, gf graphFinding) {
	if !f.deps.Graph.Configured() || !egressCapable(c.Tool, caps) {
		return fv, gf
	}
	keys := make([]string, 0, len(c.Args))
	for k := range c.Args {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	perArg := map[string][]string{} // arg key -> its tokens
	byHash := map[string]string{}   // hash -> literal token
	var all []string
	for _, k := range keys {
		toks := argTokens(map[string]any{k: c.Args[k]})
		perArg[k] = toks
		for _, t := range toks {
			byHash[valueHash(t)] = t
		}
		all = append(all, toks...)
	}
	if len(all) == 0 {
		return fv, gf
	}

	start := time.Now()
	ctx, cancel := context.WithTimeout(ctx, graphTimeout)
	defer cancel()
	defer func() { gf.ms = msSince(start) }()
	hits, err := f.deps.Graph.Flows(ctx, hashAll(all))
	if err != nil {
		f.warnGraph(ctx, "value flow lookup", err)
		return fv, gf
	}
	gf.queried = true

	// Which values may not reach this call: secrets anywhere they can leave,
	// external content only into a shell.
	exec := hasCap(caps, policy.CatExec)
	tainted := map[string]bool{}
	sensitive := false
	var first *graph.ValueHit
	for i, h := range hits {
		gf.paths = append(gf.paths, fmt.Sprintf("session %s --[READ by %s]--> value#%s --[ARG_CONTAINS]--> %s", h.Session, h.Tool, h.Hash[:12], c.Tool))
		if h.Sensitive || (exec && h.TrustRank == int64(graph.TrustRank["EXTERNAL"])) {
			tainted[h.Hash] = true
			if h.Sensitive {
				sensitive = true
				fv.egress = append(fv.egress, h.Hash)
			}
			if first == nil || (h.Sensitive && !first.Sensitive) {
				first = &hits[i]
			}
		}
	}
	if len(tainted) == 0 {
		return fv, gf
	}

	args := make([]graph.CutArg, 0, len(keys))
	for _, k := range keys {
		a := graph.CutArg{Key: k, Fixed: destinationKeys[k]}
		for _, h := range hashAll(perArg[k]) {
			if tainted[h] {
				a.Hashes = append(a.Hashes, h)
			}
		}
		args = append(args, a)
	}
	cut, err := f.deps.Graph.ComputeCut(ctx, callID, c.Tool, args)
	if err != nil {
		// Fail closed on a secret; external content only pauses.
		f.warnGraph(ctx, "min-cut", err)
		fv.decision, fv.stage = Pause, StageProvenance
		if sensitive {
			fv.decision, fv.stage = Block, StageExfil
		}
		fv.reason = "a tainted value is in this call's arguments and the cut could not be computed: " + err.Error()
		return fv, gf
	}
	fv.cut = cut
	gf.paths = append(gf.paths, fmt.Sprintf("FalkorDB algo.maxFlow over %s's influence network = %d; cut: %s", c.Tool, cut.MaxFlow, strings.Join(cut.Edges(), ", ")))

	origin := fmt.Sprintf("%s in session %s", first.Tool, first.Session)
	switch {
	case cut.Terminal && sensitive:
		fv.decision, fv.stage = Block, StageExfil
		fv.reason = fmt.Sprintf("a sensitive value read by %s is in this %s call's arguments; every argument carries it, so the min cut (cost %d) severs the call itself", origin, c.Tool, cut.MaxFlow)
	case cut.Terminal:
		fv.decision, fv.stage = Pause, StageProvenance
		fv.reason = fmt.Sprintf("this command carries content fetched from outside by %s; external content cannot authorize a shell command (min cut cost %d severs the call)", origin, cut.MaxFlow)
	default:
		for _, k := range cut.Redact {
			for _, t := range perArg[k] {
				if tainted[valueHash(t)] {
					fv.redactTokens = append(fv.redactTokens, byHash[valueHash(t)])
				}
			}
		}
	}
	return fv, gf
}

// destinationKeys name where a call sends data. Redacting one leaves a call
// with nowhere to go, so a tainted destination blocks instead.
var destinationKeys = keySet("url", "uri", "endpoint", "host", "hostname", "domain", "webhook", "webhook_url")

// Redacted is the placeholder a cut argument's tainted values become.
const Redacted = "[REDACTED by VIGIL]"

// Redact returns a deep copy of args with every occurrence of the given
// literal values replaced, in any string at any depth. Used to rewrite a call
// to what the min cut allows.
func Redact(args map[string]any, values []string) map[string]any {
	var walk func(any) any
	walk = func(v any) any {
		switch x := v.(type) {
		case string:
			for _, val := range values {
				if val != "" {
					x = strings.ReplaceAll(x, val, Redacted)
				}
			}
			return x
		case map[string]any:
			out := make(map[string]any, len(x))
			for k, e := range x {
				out[k] = walk(e)
			}
			return out
		case []any:
			out := make([]any, len(x))
			for i, e := range x {
				out[i] = walk(e)
			}
			return out
		}
		return v
	}
	out, _ := walk(args).(map[string]any)
	return out
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
