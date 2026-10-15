package firewall

import (
	"context"
	"regexp"
	"strings"

	"github.com/Aaditya1273/Vigil/internal/graph"
)

// shareVerbRe pulls a recipient name out of a file-sharing-shaped shell
// command: "share the report with Sam", "email the export to S. Ratnaparkhi",
// "send the file to Jordan Blake". Same caveat as extractPackageName in
// graph.go: heuristic string matching on a shell command, raises scrutiny,
// is not a parser.
var shareVerbRe = regexp.MustCompile(`(?i)\b(?:share|send|email|mail)\b.*?\b(?:with|to)\s+([A-Z][a-zA-Z.'-]*(?:\s+[A-Z][a-zA-Z.'-]*){0,2})`)

func extractShareTarget(c Call) string {
	// A dedicated share_file-shaped tool (if one exists) names the
	// recipient directly — check that first, since it needs no guessing.
	for _, key := range []string{"recipient", "share_with", "to"} {
		if v, ok := c.Args[key].(string); ok && v != "" {
			return v
		}
	}
	if c.Tool != "run_command" {
		return ""
	}
	cmd, _ := c.Args["command"].(string)
	m := shareVerbRe.FindStringSubmatch(cmd)
	if len(m) < 2 {
		return ""
	}
	return strings.TrimSpace(m[1])
}

// EntityPolicyReport explains an entity-policy decision: not just "blocked",
// but "this name resolves to a Customer through these aliases, and this
// policy denies sharing with Customers".
type EntityPolicyReport struct {
	Name            string   `json:"name"`
	ResolvedAliases []string `json:"resolved_aliases"`
	EntityType      string   `json:"entity_type,omitempty"`
	DeniedBy        []string `json:"denied_by,omitempty"`
	PolicyPaths     []string `json:"policy_paths"`
	QueryTimeMS     float64  `json:"query_time_ms"`
}

// checkEntityPolicy resolves a share recipient through SAME_AS aliases to
// the entity types they are, and blocks when a policy DENIES one of them.
//
// No graph, or a name the graph has never seen, is not a block: this check
// tightens a decision, it is not a complete access-control system. It
// composes with the declared-intent check, it does not replace it.
func (f *Firewall) checkEntityPolicy(ctx context.Context, c Call) (blocked bool, report *EntityPolicyReport) {
	name := extractShareTarget(c)
	if name == "" || !f.deps.Graph.Configured() {
		return false, nil
	}
	ctx, cancel := context.WithTimeout(ctx, graphTimeout)
	defer cancel()
	// The recipient regex can over-capture ("Jordan Blake today"), so try
	// word prefixes, longest first, and keep the first the graph knows.
	var profile graph.EntityProfile
	words := strings.Fields(name)
	for n := len(words); n >= 1; n-- {
		p, err := f.deps.Graph.GetEntityProfile(ctx, strings.Join(words[:n], " "))
		if err != nil {
			f.warnGraph(ctx, "entity profile", err)
			return false, nil
		}
		profile = p
		if len(p.EntityTypes) > 0 || len(p.Aliases) > 0 {
			name = p.Name
			break
		}
	}
	rep := &EntityPolicyReport{
		Name:            name,
		ResolvedAliases: profile.Aliases,
		DeniedBy:        profile.DeniedBy,
		PolicyPaths:     append(graph.Paths(profile.AliasEdges), graph.Paths(profile.PolicyEdges)...),
		QueryTimeMS:     profile.QueryTimeMS,
	}
	if len(profile.EntityTypes) > 0 {
		rep.EntityType = profile.EntityTypes[0]
	}
	return len(profile.DeniedBy) > 0, rep
}
