package firewall

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Aaditya1273/Vigil/internal/graph"
	"github.com/Aaditya1273/Vigil/internal/policy"
	"github.com/Aaditya1273/Vigil/internal/vigil"
)

// graphTimeout bounds every graph read on the request path. A local FalkorDB
// answers in milliseconds; an unreachable one must degrade to "the graph had
// nothing to say", never hang the call.
const graphTimeout = 2 * time.Second

// envTrustThreshold is how many clean executions of one tool+capability
// shape, since the agent's last incident, earn an auto-ALLOW outside declared
// intent. VIGIL_TRUST_THRESHOLD, default 20.
func envTrustThreshold() int64 {
	if n, err := strconv.ParseInt(vigil.Env("TRUST_THRESHOLD"), 10, 64); err == nil && n > 0 {
		return n
	}
	return 20
}

// packageInstallRe pulls the first package name out of an install command.
// Heuristic string matching on a shell command: it raises scrutiny, it is not
// a parser.
var packageInstallRe = regexp.MustCompile(`(?:pip3? install|uv pip install|uv add|npm (?:install|i|add)|pnpm (?:add|install|i)|yarn add|bun add)\s+(?:-\S+\s+)*([a-zA-Z0-9_.@/\-]+)`)

// blastRadiusTarget returns the package a call is about to install, or "".
func blastRadiusTarget(c Call) string {
	if c.Tool != "run_command" {
		return ""
	}
	cmd, _ := c.Args["command"].(string)
	return extractPackageName(cmd)
}

func extractPackageName(cmd string) string {
	m := packageInstallRe.FindStringSubmatch(strings.ToLower(cmd))
	if len(m) < 2 {
		return ""
	}
	return strings.TrimSpace(m[1])
}

// graphFinding is what one graph consult contributed to a decision, so the
// audit record and dashboard show the path, not just the verdict.
type graphFinding struct {
	paths   []string
	queried bool
	ms      float64
}

func (f *Firewall) warnGraph(ctx context.Context, what string, err error) {
	f.deps.Logger.WarnContext(ctx, "vigil: graph "+what+" failed, falling through", "error", err.Error())
}

// graphIntent adjudicates a call declared intent did not cover. An org policy
// denying one of its capabilities blocks it; enough clean history for this
// agent, tool and capability shape allows it (earned autonomy). Otherwise
// the question stays open for the judge.
func (f *Firewall) graphIntent(ctx context.Context, agent string, c Call, caps []string) (verdict string, gf graphFinding) {
	if !f.deps.Graph.Configured() {
		return "", gf
	}
	start := time.Now()
	defer func() { gf.ms = msSince(start) }()
	ctx, cancel := context.WithTimeout(ctx, graphTimeout)
	defer cancel()

	denials, err := f.deps.Graph.PolicyDenials(ctx, caps)
	if err != nil {
		f.warnGraph(ctx, "policy lookup", err)
		return "", gf
	}
	gf.queried = true
	if len(denials) > 0 {
		gf.paths = graph.Paths(denials)
		return "deny", gf
	}

	tr, err := f.deps.Graph.EarnedTrust(ctx, agent, c.Repo, c.Tool, caps)
	if err != nil {
		f.warnGraph(ctx, "trust lookup", err)
		return "", gf
	}
	gf.paths = []string{fmt.Sprintf("%s --[EXECUTED clean x%d of %d since last incident, need %d]--> %s(%s)",
		agent, tr.Clean, tr.Total, f.deps.TrustThreshold, c.Tool, graph.CapsKey(caps))}
	if tr.Clean >= f.deps.TrustThreshold {
		return "allow", gf
	}
	return "uncertain", gf
}

// graphPackage decides an install: blocked if any tenant already blocked it
// (shared threat graph) or if it is a typosquat of a known package. A block
// is published back to the shared graph so every other tenant inherits it.
func (f *Firewall) graphPackage(ctx context.Context, pkg string) (reason string, gf graphFinding) {
	if !f.deps.Graph.Configured() {
		return "", gf
	}
	start := time.Now()
	defer func() { gf.ms = msSince(start) }()
	ctx, cancel := context.WithTimeout(ctx, graphTimeout)
	defer cancel()
	name, _ := splitPkgVersion(pkg)

	threat, err := f.deps.Graph.ThreatLookup(ctx, "package", name)
	if err != nil {
		f.warnGraph(ctx, "threat lookup", err)
	} else if threat != nil {
		gf.queried = true
		gf.paths = []string{fmt.Sprintf("threat_intel --[BLOCKED_BY %d tenant(s)]--> %s", threat.Tenants, name)}
		return fmt.Sprintf("package %s was already blocked by %d tenant(s) in the shared threat graph", name, threat.Tenants), gf
	}

	br, err := f.deps.Graph.GetBlastRadius(ctx, name)
	if err != nil {
		f.warnGraph(ctx, "blast radius", err)
		return "", gf
	}
	gf.queried = true
	gf.paths = br.Paths
	if br.SquatOf == "" {
		return "", gf
	}
	if !isDry(ctx) {
		f.deps.Graph.ThreatPublish("package", name)
	}
	return fmt.Sprintf("package %s is a typosquat of %s", name, br.SquatOf), gf
}

// graphBehavior reports how familiar the step prev -> tool is for this agent.
// Context for the judge and the audit trail, not a verdict on its own.
func (f *Firewall) graphBehavior(ctx context.Context, agent, prev, tool string) (gf graphFinding) {
	if !f.deps.Graph.Configured() || prev == "" {
		return gf
	}
	start := time.Now()
	defer func() { gf.ms = msSince(start) }()
	ctx, cancel := context.WithTimeout(ctx, graphTimeout)
	defer cancel()
	t, err := f.deps.Graph.Transition(ctx, agent, prev, tool)
	if err != nil {
		f.warnGraph(ctx, "transition lookup", err)
		return gf
	}
	gf.queried = true
	if t.Count == 0 {
		gf.paths = []string{fmt.Sprintf("%s --[THEN never seen for %s, %d prior steps]--> %s", prev, agent, t.Total, tool)}
	} else {
		gf.paths = []string{fmt.Sprintf("%s --[THEN x%d of %d, p=%.2f]--> %s", prev, t.Count, t.Total, t.P(), tool)}
	}
	return gf
}

func (r *Result) addGraph(gf graphFinding) {
	r.GraphMS += gf.ms
	if gf.queried {
		r.GraphQueried = true
		r.GraphPaths = append(r.GraphPaths, gf.paths...)
	}
}

// EarnedTrust reports whether agent has earned autonomy for this call shape
// in repo, for integrations (the Claude Code hook) that turn it into "skip
// the permission prompt".
func (f *Firewall) EarnedTrust(ctx context.Context, agent, repo, tool string, args map[string]any) (graph.Trust, bool) {
	if !f.deps.Graph.Configured() {
		return graph.Trust{}, false
	}
	ctx, cancel := context.WithTimeout(ctx, graphTimeout)
	defer cancel()
	tr, err := f.deps.Graph.EarnedTrust(ctx, agent, repo, tool, policy.Categories(tool, args))
	if err != nil {
		f.warnGraph(ctx, "trust lookup", err)
		return tr, false
	}
	return tr, tr.Clean >= f.deps.TrustThreshold
}

// TrustThreshold is the clean-history count that earns autonomy.
func (f *Firewall) TrustThreshold() int64 { return f.deps.TrustThreshold }
