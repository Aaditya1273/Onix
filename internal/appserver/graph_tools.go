package appserver

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/Aaditya1273/Vigil/internal/graph"
	"github.com/Aaditya1273/Vigil/internal/mcp"
)

// registerGraphTools exposes the graph's algorithms to agents as MCP tools:
// an agent about to install a package can ask for its blast radius itself,
// and every answer carries the path that produced it. They run on the same
// governed path as every other tool (firewall first, then the handler).
func (st *stack) registerGraphTools(s *mcp.MCPServer) {
	if !st.graph.Configured() {
		return
	}
	str := func(args map[string]any, k string) string { v, _ := args[k].(string); return strings.TrimSpace(v) }
	schema := func(prop, desc string) mcp.InputSchema {
		return mcp.InputSchema{
			Type:       "object",
			Properties: map[string]any{prop: map[string]any{"type": "string", "description": desc}},
			Required:   []string{prop},
		}
	}
	answer := func(summary string, v any) (*mcp.CallToolResult, error) {
		raw, _ := json.MarshalIndent(v, "", "  ")
		return mcp.NewTextResult(summary + "\n\n" + string(raw)), nil
	}
	timeout := func(ctx context.Context) (context.Context, context.CancelFunc) {
		return context.WithTimeout(ctx, 10*time.Second)
	}

	s.RegisterTool(mcp.Tool{
		Name: "vigil_blast_radius",
		Description: "Before installing a package, ask the dependency graph what it would expose: every package and service " +
			"that depends on it (reverse DEPENDS_ON closure, 4 hops), its maintainers ranked by the PageRank of everything they " +
			"control, and whether it is a typosquat of a known package.",
		InputSchema: schema("package", "Package name, e.g. express or reqeusts"),
	}, func(ctx context.Context, args map[string]any) (*mcp.CallToolResult, error) {
		pkg := str(args, "package")
		if pkg == "" {
			return mcp.NewErrorResult("package is required"), nil
		}
		ctx, cancel := timeout(ctx)
		defer cancel()
		br, err := st.graph.GetBlastRadius(ctx, pkg)
		if err != nil {
			return mcp.NewErrorResult("graph query failed: " + err.Error()), nil
		}
		verdict := "no typosquat edge"
		if br.SquatOf != "" {
			verdict = "TYPOSQUAT of " + br.SquatOf + ", do not install"
		}
		return answer(fmt.Sprintf("%s: %d dependent(s), services exposed %v, %s.", pkg, br.Dependents, br.ExposedServices, verdict), map[string]any{
			"dependents": br.Dependents, "exposed_services": br.ExposedServices, "typosquat_of": br.SquatOf,
			"known_typosquats": br.Typosquats, "maintainer_risk": br.MaintainerRisk, "paths": br.Paths,
		})
	})

	s.RegisterTool(mcp.Tool{
		Name: "vigil_entity_lookup",
		Description: "Resolve a person's name through the identity graph (SAME_AS aliases), the entity types they are, and the " +
			"policies that deny sharing with them. Ask before sending or sharing anything with someone.",
		InputSchema: schema("name", "A person's name or alias, e.g. Sam or J. Blake"),
	}, func(ctx context.Context, args map[string]any) (*mcp.CallToolResult, error) {
		name := str(args, "name")
		if name == "" {
			return mcp.NewErrorResult("name is required"), nil
		}
		ctx, cancel := timeout(ctx)
		defer cancel()
		p, err := st.graph.GetEntityProfile(ctx, name)
		if err != nil {
			return mcp.NewErrorResult("graph query failed: " + err.Error()), nil
		}
		summary := fmt.Sprintf("%s is not in the identity graph.", name)
		if len(p.EntityTypes) > 0 || len(p.Aliases) > 0 {
			summary = fmt.Sprintf("%s resolves to %v, entity type %v.", name, p.Aliases, p.EntityTypes)
			if len(p.DeniedBy) > 0 {
				summary += fmt.Sprintf(" Sharing is DENIED by %v.", p.DeniedBy)
			}
		}
		return answer(summary, map[string]any{
			"aliases": p.Aliases, "entity_types": p.EntityTypes, "denied_by": p.DeniedBy,
			"paths": append(graph.Paths(p.AliasEdges), graph.Paths(p.PolicyEdges)...),
		})
	})

	s.RegisterTool(mcp.Tool{
		Name: "vigil_fact",
		Description: "Look up what memory says about a subject: the current fact, the facts it superseded, and each one's " +
			"authority (the lowest trust of everything it was derived from). Answers NOT_IN_HISTORY when nothing was ever " +
			"recorded, instead of guessing.",
		InputSchema: schema("subject", "What the fact is about, e.g. on-call engineer"),
	}, func(ctx context.Context, args map[string]any) (*mcp.CallToolResult, error) {
		subject := str(args, "subject")
		if subject == "" {
			return mcp.NewErrorResult("subject is required"), nil
		}
		ctx, cancel := timeout(ctx)
		defer cancel()
		facts, err := st.graph.Facts(ctx, subject)
		if err != nil {
			return mcp.NewErrorResult("graph query failed: " + err.Error()), nil
		}
		summary := "NOT_IN_HISTORY: nothing about " + subject + " was ever recorded."
		for _, f := range facts {
			if f.Current() {
				summary = fmt.Sprintf("%s (trust %s, authority %s).", f.Text, f.Trust, f.Authority)
			}
		}
		return answer(summary, facts)
	})

	s.RegisterTool(mcp.Tool{
		Name: "vigil_threat_check",
		Description: "Ask the threat graph shared across every tenant whether anyone has already blocked this package. Only " +
			"hashes are shared, never content.",
		InputSchema: schema("package", "Package name"),
	}, func(ctx context.Context, args map[string]any) (*mcp.CallToolResult, error) {
		pkg := str(args, "package")
		if pkg == "" {
			return mcp.NewErrorResult("package is required"), nil
		}
		ctx, cancel := timeout(ctx)
		defer cancel()
		t, err := st.graph.ThreatLookup(ctx, "package", pkg)
		if err != nil {
			return mcp.NewErrorResult("graph query failed: " + err.Error()), nil
		}
		if t == nil {
			return mcp.NewTextResult(pkg + ": no tenant has blocked it."), nil
		}
		return answer(fmt.Sprintf("%s: BLOCKED by %d tenant(s).", pkg, t.Tenants), t)
	})

	s.RegisterTool(mcp.Tool{
		Name: "vigil_autonomy",
		Description: "What autonomy has been earned: every agent, repo, tool and capability shape with enough clean " +
			"history since its last incident to skip the human prompt, plus this week's decisions.",
		InputSchema: mcp.InputSchema{Type: "object", Properties: map[string]any{}},
	}, func(ctx context.Context, args map[string]any) (*mcp.CallToolResult, error) {
		ctx, cancel := timeout(ctx)
		defer cancel()
		d, err := st.graph.GetDigest(ctx, time.Now().Add(-7*24*time.Hour).UnixNano(), st.fw.TrustThreshold())
		if err != nil {
			return mcp.NewErrorResult("graph query failed: " + err.Error()), nil
		}
		return answer(fmt.Sprintf("%d call shape(s) have earned autonomy; %d decisions this week, %.0f%% without a model.",
			len(d.Autonomy), d.Decisions, d.ModelFree*100), d)
	})
}
