package graph

import (
	"context"

	"fmt"
	"github.com/Aaditya1273/Vigil/internal/audit"
	"sort"
	"strings"
	"time"
)

// Data model (one graph per tenant):
//
//	(:Agent)-[:RAN]->(:Session)-[:MADE]->(:Call)-[:INVOKED]->(:Tool)-[:REQUIRES]->(:Capability)
//	(:Call)-[:DECIDED]->(:Decision)-[:PREV]->(:Decision)        hash chain
//	(:Tool)-[:THEN {agent, count}]->(:Tool)                     behavior
//	(:Tool)-[:HAS_VERSION]->(:ToolVersion)-[:SUPERSEDES]->(:ToolVersion)
//	(:Call)-[:READ | :ARG_CONTAINS]->(:Value {hash, sensitive, trust})
//	(:Policy)-[:DENIES]->(:Capability | :EntityType)
//	(:Service | :Package)-[:DEPENDS_ON]->(:Package)
//	(:Maintainer)-[:MAINTAINS]->(:Package)
//	(:Package)-[:TYPOSQUAT_OF]->(:Package)
//	(:Person)-[:SAME_AS]-(:Person)-[:IS_A]->(:EntityType)
//	(:Fact)-[:SUPERSEDES | :DERIVED_FROM]->(:Fact)
//	(:Document)-[:CONTRADICTS]->(:Document)
//
// Shared threat_intel graph: (:Hash {value, kind, first_seen, tenants}).

// Triplet, ChunkRelation and GraphContext keep the JSON shape the dashboard's
// EntityGraph component renders, so a query's edges draw directly.
type Entity struct {
	ID   string `json:"entity_id"`
	Name string `json:"name"`
	Type string `json:"type,omitempty"`
}

type Relation struct {
	Predicate string `json:"canonical_predicate"`
	Context   string `json:"context,omitempty"`
}

type Triplet struct {
	Source   Entity   `json:"source"`
	Relation Relation `json:"relation"`
	Target   Entity   `json:"target"`
}

type ChunkRelation struct {
	Triplets []Triplet `json:"triplets"`
}

type GraphContext struct {
	ChunkRelations []ChunkRelation `json:"chunk_relations"`
}

func contextOf(ts []Triplet) GraphContext {
	if len(ts) == 0 {
		return GraphContext{ChunkRelations: []ChunkRelation{}}
	}
	return GraphContext{ChunkRelations: []ChunkRelation{{Triplets: ts}}}
}

// Path renders an edge the way audit records and the dashboard print it.
func (t Triplet) Path() string {
	return fmt.Sprintf("%s --[%s]--> %s", t.Source.Name, t.Relation.Predicate, t.Target.Name)
}

func Paths(ts []Triplet) []string {
	out := make([]string, 0, len(ts))
	for _, t := range ts {
		out = append(out, t.Path())
	}
	return out
}

func triplets(rows Rows) []Triplet {
	out := make([]Triplet, 0, len(rows))
	for _, r := range rows {
		if len(r) < 5 {
			continue
		}
		out = append(out, Triplet{
			Source:   Entity{ID: Str(r[1]) + ":" + Str(r[0]), Name: Str(r[0]), Type: strings.ToUpper(Str(r[1]))},
			Relation: Relation{Predicate: Str(r[2])},
			Target:   Entity{ID: Str(r[4]) + ":" + Str(r[3]), Name: Str(r[3]), Type: strings.ToUpper(Str(r[4]))},
		})
	}
	return out
}

func (c *Client) edges(ctx context.Context, cypher string, params map[string]any) ([]Triplet, error) {
	rows, err := c.Query(ctx, cypher, params)
	if err != nil {
		return nil, err
	}
	return triplets(rows), nil
}

func ms(start time.Time) float64 { return float64(time.Since(start).Microseconds()) / 1000 }

// =============================================================================
// Writes: every decision becomes history
// =============================================================================

// CallRecord is one firewall decision.
type CallRecord struct {
	ID, Agent, Session, Tool string
	Repo                     string   // scope trust is earned in; "" when unknown
	Caps                     []string // capabilities this call needs, from policy.Categories
	Decision, Stage, Reason  string
	Model                    string      // judge model consulted, "" when the graph or rules decided
	GraphMS                  float64     // time this decision spent in graph queries
	Egress                   []string    // hashes of known Values this call's arguments carried
	CutEdges                 []string    // edges the min-cut severed ("terminal", "arg:<key>")
	CutCost                  int64       // FalkorDB's max-flow value for this call's network
	Paths                    []string    // the graph paths that justified the decision
	Predicted                []EffectRef // what an allowed call is expected to touch
	Package                  string      // the package an install-shaped call installs
	Label                    string      // a redacted human-readable summary; set only by a replay of local history
	Audit                    audit.Event // the sealed audit record, mirrored so the ledger can be exported from the graph
	Hash, PrevHash           string      // the audit ledger's chain, mirrored
	At                       time.Time
}

// CapsKey is the canonical form of a capability set: trust is earned per
// (agent, tool, capability shape), so `run_command ls` and `run_command rm`
// do not share history.
func CapsKey(caps []string) string {
	c := append([]string(nil), caps...)
	sort.Strings(c)
	return strings.Join(c, ",")
}

// RecordCall writes the Call, its Decision, and the PREV edge of the hash
// chain. Asynchronous, in order.
func (c *Client) RecordCall(r CallRecord) {
	if c == nil {
		return
	}
	params := map[string]any{
		"id": r.ID, "agent": r.Agent, "session": r.Session, "tool": r.Tool, "repo": r.Repo,
		"caps": CapsKey(r.Caps), "capList": r.Caps, "model": r.Model, "graphMs": r.GraphMS, "egress": r.Egress, "cutEdges": nonNilStrings(r.CutEdges), "cutCost": r.CutCost, "paths": nonNilStrings(r.Paths), "predicted": effectParams(r.Predicted), "package": r.Package, "label": r.Label,
		"auditId": r.Audit.ID, "auditTs": auditTS(r.Audit), "auditNs": r.Audit.Timestamp.UnixNano(), "auditAgent": r.Audit.AgentID,
		"argsHash": r.Audit.ArgsHash, "cost": r.Audit.Cost,
		"decision": r.Decision, "stage": r.Stage, "reason": r.Reason,
		// Nanoseconds: a refusal and a clean call in the same millisecond
		// must still order, or trust resets miscount.
		"hash": r.Hash, "prev": r.PrevHash, "ts": r.At.UnixNano(),
	}
	c.enqueue(func(ctx context.Context) error {
		return c.Exec(ctx, q("record_call"), params)
	})
}

// RecordOutcome marks the session's latest allowed call of tool as executed
// (ok or failed) and strengthens the prev->tool behavior edge for agent.
func (c *Client) RecordOutcome(agent, session, prevTool, tool string, ok bool, cost float64) {
	if c == nil {
		return
	}
	params := map[string]any{"agent": agent, "session": session, "prev": prevTool, "tool": tool, "ok": ok, "cost": cost}
	c.enqueue(func(ctx context.Context) error {
		if err := c.Exec(ctx, q("record_outcome"), params); err != nil {
			return err
		}
		if prevTool == "" {
			return nil
		}
		return c.Exec(ctx, q("record_transition"), params)
	})
}

// =============================================================================
// Pillar 1: earned autonomy
// =============================================================================

// Trust is how much clean history an agent has with one tool+capability shape.
type Trust struct {
	Clean        int64 // allowed and executed OK since the last incident
	Total        int64
	LastIncident int64 // unix ns of the latest non-ALLOW decision, 0 if none
}

// EarnedTrust: any refused call resets the count, and so does a change to
// the tool's description (a rug pull); only executed, successful calls after
// both count as evidence. Trust is scoped to one repo.
func (c *Client) EarnedTrust(ctx context.Context, agent, repo, tool string, caps []string) (Trust, error) {
	rows, err := c.Query(ctx, q("earned_trust"),
		map[string]any{"agent": agent, "repo": repo, "tool": tool, "caps": CapsKey(caps)})
	if err != nil || len(rows) == 0 {
		return Trust{}, err
	}
	return Trust{Clean: Int(rows[0][0]), Total: Int(rows[0][1]), LastIncident: Int(rows[0][2])}, nil
}

// PolicyDenials returns every org policy that denies one of caps.
func (c *Client) PolicyDenials(ctx context.Context, caps []string) ([]Triplet, error) {
	if len(caps) == 0 {
		return nil, nil
	}
	return c.edges(ctx, q("policy_denials"), map[string]any{"caps": caps})
}

// =============================================================================
// Behavior: how often has this agent gone from prev to tool
// =============================================================================

type Transition struct {
	Count, Total int64
}

func (t Transition) P() float64 {
	if t.Total == 0 {
		return 0
	}
	return float64(t.Count) / float64(t.Total)
}

func (c *Client) Transition(ctx context.Context, agent, prev, tool string) (Transition, error) {
	rows, err := c.Query(ctx, q("transition"), map[string]any{"agent": agent, "prev": prev})
	if err != nil {
		return Transition{}, err
	}
	var t Transition
	for _, r := range rows {
		n := Int(r[1])
		t.Total += n
		if Str(r[0]) == tool {
			t.Count = n
		}
	}
	return t, nil
}

// =============================================================================
// Pillar 4: packages: typosquats, blast radius, maintainers
// =============================================================================

type Ranked struct {
	Name  string  `json:"name"`
	Score float64 `json:"score"`
}

type BlastRadius struct {
	Package           string       `json:"package"`
	MaintainerRisk    []Ranked     `json:"maintainer_risk"` // PageRank mass each maintainer controls
	SquatOf           string       `json:"squat_of,omitempty"`
	Dependents        int          `json:"dependents"`
	ExposedServices   []string     `json:"exposed_services"`
	SharedMaintainers []string     `json:"maintainer_shared"`
	Typosquats        []string     `json:"typosquats"`
	Dependency        GraphContext `json:"dependency_graph"`
	Maintainer        GraphContext `json:"maintainer_graph"`
	Typosquat         GraphContext `json:"typosquat_graph"`
	Paths             []string     `json:"entity_paths"`
	QueryTimeMS       float64      `json:"blast_radius_time_ms"`
}

// GetBlastRadius runs three traversals: who depends on pkg (up to 4 hops),
// who maintains it and what else they maintain, and typosquat edges in
// either direction.
func (c *Client) GetBlastRadius(ctx context.Context, pkg string) (BlastRadius, error) {
	start := time.Now()
	p := map[string]any{"pkg": strings.ToLower(pkg)}
	br := BlastRadius{Package: pkg, ExposedServices: []string{}, SharedMaintainers: []string{}, Typosquats: []string{}}

	deps, err := c.edges(ctx, q("blast_dependents"), p)
	if err != nil {
		return br, err
	}
	maint, err := c.edges(ctx, q("blast_maintainers"), p)
	if err != nil {
		return br, err
	}
	squat, err := c.edges(ctx, q("blast_typosquats"), p)
	if err != nil {
		return br, err
	}

	seen := map[string]bool{}
	for _, t := range deps {
		if !seen[t.Source.Name] {
			seen[t.Source.Name] = true
			br.Dependents++
			if t.Source.Type == "SERVICE" {
				br.ExposedServices = append(br.ExposedServices, t.Source.Name)
			}
		}
	}
	perMaint := map[string]int{}
	for _, t := range maint {
		perMaint[t.Source.Name]++
	}
	for m, n := range perMaint {
		if n > 1 {
			br.SharedMaintainers = append(br.SharedMaintainers, m)
		}
	}
	sort.Strings(br.SharedMaintainers)
	for _, t := range squat {
		if strings.EqualFold(t.Source.Name, pkg) {
			br.SquatOf = t.Target.Name
		} else {
			br.Typosquats = append(br.Typosquats, t.Source.Name)
		}
	}
	if br.SquatOf != "" {
		br.Typosquats = append(br.Typosquats, pkg)
	}

	// Maintainer risk: the PageRank (over DEPENDS_ON) of everything each of
	// this package's maintainers controls. One account takeover reaches all
	// of it. ponytail: PageRank recomputed per call over the whole package
	// graph; cache it per ingest if the graph grows past ~100k packages.
	rows, err := c.Query(ctx, q("maintainer_pagerank"), p)
	if err != nil {
		return br, err
	}
	br.MaintainerRisk = []Ranked{}
	for _, r := range rows {
		br.MaintainerRisk = append(br.MaintainerRisk, Ranked{Name: Str(r[0]), Score: Float(r[1])})
	}

	br.Dependency, br.Maintainer, br.Typosquat = contextOf(deps), contextOf(maint), contextOf(squat)
	br.Paths = append(append(Paths(deps), Paths(maint)...), Paths(squat)...)
	br.QueryTimeMS = ms(start)
	return br, nil
}

// =============================================================================
// Pillar 5: herd immunity, the shared threat graph
// =============================================================================

type Threat struct {
	Kind      string `json:"kind"`
	FirstSeen int64  `json:"first_seen"`
	Tenants   int64  `json:"tenants"`
}

// ThreatLookup asks the shared graph whether any tenant has blocked this.
func (c *Client) ThreatLookup(ctx context.Context, kind, value string) (*Threat, error) {
	rows, err := c.run(ctx, ThreatGraph, "GRAPH.RO_QUERY",
		q("threat_lookup"),
		map[string]any{"h": Hash(kind, value)})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return &Threat{Kind: Str(rows[0][0]), FirstSeen: Int(rows[0][1]), Tenants: Int(rows[0][2])}, nil
}

// ThreatPublish shares a block: the hash, never the content, plus an
// anonymized tenant marker so the count means distinct tenants.
func (c *Client) ThreatPublish(kind, value string) {
	if c == nil {
		return
	}
	params := map[string]any{"h": Hash(kind, value), "kind": kind, "ts": time.Now().UnixMilli(), "tenant": Hash("tenant", c.tenant)[:16]}
	c.enqueue(func(ctx context.Context) error {
		_, err := c.run(ctx, ThreatGraph, "GRAPH.QUERY", q("threat_publish"), params)
		return err
	})
}

// =============================================================================
// Identity: who is this person, and may we share with them
// =============================================================================

type EntityProfile struct {
	Name        string
	Aliases     []string
	EntityTypes []string
	DeniedBy    []string // policies denying an entity type this person resolves to
	AliasEdges  []Triplet
	PolicyEdges []Triplet
	QueryTimeMS float64
}

// GetEntityProfile resolves name through SAME_AS (3 hops, either direction),
// then follows IS_A to entity types and DENIES back to policies.
func (c *Client) GetEntityProfile(ctx context.Context, name string) (EntityProfile, error) {
	start := time.Now()
	prof := EntityProfile{Name: name, Aliases: []string{}, EntityTypes: []string{}, DeniedBy: []string{}}
	p := map[string]any{"name": strings.ToLower(strings.TrimSpace(name))}

	alias, err := c.edges(ctx, q("entity_aliases"), p)
	if err != nil {
		return prof, err
	}
	policy, err := c.edges(ctx, q("entity_policy"), p)
	if err != nil {
		return prof, err
	}

	seen := map[string]bool{strings.ToLower(name): true}
	for _, t := range alias {
		for _, n := range []string{t.Source.Name, t.Target.Name} {
			if !seen[strings.ToLower(n)] {
				seen[strings.ToLower(n)] = true
				prof.Aliases = append(prof.Aliases, n)
			}
		}
	}
	types := map[string]bool{}
	for _, t := range policy {
		switch t.Relation.Predicate {
		case "IS_A":
			if !types[t.Target.Name] {
				types[t.Target.Name] = true
				prof.EntityTypes = append(prof.EntityTypes, t.Target.Name)
			}
		case "DENIES":
			prof.DeniedBy = append(prof.DeniedBy, t.Source.Name)
		}
	}
	prof.AliasEdges, prof.PolicyEdges = alias, policy
	prof.QueryTimeMS = ms(start)
	return prof, nil
}

// Neighborhood returns the edges around one named node, or the identity and
// policy backbone of the whole graph when name is empty.
func (c *Client) Neighborhood(ctx context.Context, name string) ([]Triplet, error) {
	if name == "" {
		return c.edges(ctx, q("ontology_backbone"), nil)
	}
	return c.edges(ctx, q("ontology_neighborhood"), map[string]any{"name": strings.ToLower(strings.TrimSpace(name))})
}

// =============================================================================
// Pillar 2: facts with validity and provenance authority
// =============================================================================

// Trust lattice, lowest to highest. A fact inherits the minimum rank of
// everything it was derived from.
var TrustRank = map[string]int{"EXTERNAL": 0, "TOOL": 1, "USER_HISTORY": 2, "USER_CONFIRMED": 3}

type Fact struct {
	ID        string `json:"id"`
	Subject   string `json:"subject"`
	Text      string `json:"text"`
	Trust     string `json:"trust"`
	Authority string `json:"authority"` // min trust over DERIVED_FROM ancestors
	ValidFrom int64  `json:"valid_from"`
	ValidTo   int64  `json:"valid_to,omitempty"`
}

func (f Fact) Current() bool { return f.ValidTo == 0 }

var rankName = func() map[int64]string {
	m := map[int64]string{}
	for k, v := range TrustRank {
		m[int64(v)] = k
	}
	return m
}()

// Facts about subject, oldest first, each with its provenance authority.
// Zero rows is an answer: the graph has never recorded this.
func (c *Client) Facts(ctx context.Context, subject string) ([]Fact, error) {
	rows, err := c.Query(ctx, q("facts"), map[string]any{"subject": strings.ToLower(strings.TrimSpace(subject))})
	if err != nil {
		return nil, err
	}
	out := make([]Fact, 0, len(rows))
	for _, r := range rows {
		out = append(out, Fact{
			ID: Str(r[0]), Subject: Str(r[1]), Text: Str(r[2]), Trust: Str(r[3]),
			Authority: rankName[Int(r[4])], ValidFrom: Int(r[5]), ValidTo: Int(r[6]),
		})
	}
	return out, nil
}

// Timeline returns every fact matching any of words (all facts when words is
// empty), plus the SUPERSEDES and DERIVED_FROM edges between them.
func (c *Client) Timeline(ctx context.Context, words []string) ([]Fact, []Triplet, error) {
	p := map[string]any{"words": words}
	rows, err := c.Query(ctx, q("timeline_facts"), p)
	if err != nil {
		return nil, nil, err
	}
	facts := make([]Fact, 0, len(rows))
	for _, r := range rows {
		facts = append(facts, Fact{ID: Str(r[0]), Subject: Str(r[1]), Text: Str(r[2]), Trust: Str(r[3]), ValidFrom: Int(r[4]), ValidTo: Int(r[5])})
	}
	edges, err := c.edges(ctx, q("timeline_edges"), p)
	return facts, edges, err
}

// =============================================================================
// Pillars 2 and 3: values that flow between calls, across sessions
// =============================================================================

// RecordValues links hashed values a call produced (a secret it read, a URL
// a web page contained) to the session's latest call of tool. Only hashes are
// stored, never the values.
func (c *Client) RecordValues(session, tool string, hashes []string, sensitive bool, trust string) {
	if c == nil || len(hashes) == 0 {
		return
	}
	params := map[string]any{"session": session, "tool": tool, "hashes": hashes, "sensitive": sensitive, "trust": trust, "rank": TrustRank[trust]}
	c.enqueue(func(ctx context.Context) error {
		return c.Exec(ctx, q("record_values"), params)
	})
}

// ValueHit is a known value found in a call's arguments, with where it was
// first read.
type ValueHit struct {
	Hash      string
	Sensitive bool
	TrustRank int64
	Session   string
	Tool      string
	At        int64
}

// Flows finds which of hashes the graph has seen a call read, in any session
// of this tenant: the session boundary is just another edge.
func (c *Client) Flows(ctx context.Context, hashes []string) ([]ValueHit, error) {
	if len(hashes) == 0 {
		return nil, nil
	}
	rows, err := c.Query(ctx, q("value_flows"), map[string]any{"hashes": hashes})
	if err != nil {
		return nil, err
	}
	out := make([]ValueHit, 0, len(rows))
	for _, r := range rows {
		sens, _ := r[1].(bool)
		out = append(out, ValueHit{Hash: Str(r[0]), Sensitive: sens, TrustRank: Int(r[2]), Session: Str(r[3]), Tool: Str(r[4]), At: Int(r[5])})
	}
	return out, nil
}

// =============================================================================
// Pillar 4: tool versions (rug pulls)
// =============================================================================

// RecordToolVersion remembers a tool's description by hash. A description
// that differs from the last one seen supersedes it and stamps the tool's
// changed_at, which revokes every agent's earned trust in it.
func (c *Client) RecordToolVersion(ctx context.Context, tool, description string) (changed bool, err error) {
	h := Hash("tool", description)
	rows, err := c.Query(ctx, q("tool_version_current"), map[string]any{"tool": tool})
	if err != nil {
		return false, err
	}
	prev := ""
	if len(rows) > 0 {
		prev = Str(rows[0][0])
	}
	if prev == h {
		return false, nil
	}
	changed = prev != ""
	err = c.Exec(ctx, q("tool_version_record"),
		map[string]any{"tool": tool, "hash": h, "desc": description, "prev": prev, "ts": time.Now().UnixNano()})
	return changed, err
}

// Drift is a tool description change an agent has not acted under yet.
type Drift struct {
	Old, New  string
	ChangedAt int64
}

// ToolDrift reports a description change since this agent's last call of
// tool. Nil when the tool never changed, or the agent has no history with it
// (nothing was trusted under the old description), or it already called the
// tool since the change.
func (c *Client) ToolDrift(ctx context.Context, agent, tool string) (*Drift, error) {
	rows, err := c.Query(ctx, q("tool_drift"), map[string]any{"agent": agent, "tool": tool})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	r := rows[0]
	changed, last := Int(r[0]), Int(r[1])
	if last == 0 || last > changed {
		return nil, nil
	}
	return &Drift{Old: Str(r[2]), New: Str(r[3]), ChangedAt: changed}, nil
}

// =============================================================================
// Digest: what the firewall did, and what it costs to ask the graph
// =============================================================================

type Autonomy struct {
	Agent string `json:"agent"`
	Repo  string `json:"repo,omitempty"`
	Tool  string `json:"tool"`
	Caps  string `json:"capabilities"`
	Clean int64  `json:"clean_since_last_incident"`
}

type Digest struct {
	Since        int64            `json:"since"`
	Decisions    int64            `json:"decisions"`
	ByVerdict    map[string]int64 `json:"by_verdict"`
	ByStage      map[string]int64 `json:"by_stage"`
	ModelFree    float64          `json:"model_free_fraction"` // decisions no model was consulted for
	GraphQueried int64            `json:"graph_queried"`
	GraphMSP50   float64          `json:"graph_ms_p50"`
	GraphMSP95   float64          `json:"graph_ms_p95"`
	Autonomy     []Autonomy       `json:"autonomy"`
	ChainLinks   int64            `json:"chain_links"`
	ChainBroken  int64            `json:"chain_broken"`
}

// GetDigest summarizes decisions since sinceNs. Autonomy lists every
// (agent, repo, tool, capability shape) with at least minClean clean runs
// since its last incident.
func (c *Client) GetDigest(ctx context.Context, sinceNs, minClean int64) (Digest, error) {
	d := Digest{Since: sinceNs, ByVerdict: map[string]int64{}, ByStage: map[string]int64{}, Autonomy: []Autonomy{}}
	rows, err := c.Query(ctx, q("digest_decisions"), map[string]any{"since": sinceNs})
	if err != nil {
		return d, err
	}
	var free int64
	var lat []float64
	for _, r := range rows {
		d.Decisions++
		d.ByVerdict[Str(r[0])]++
		d.ByStage[Str(r[1])]++
		if Str(r[2]) == "" {
			free++
		}
		if ms := Float(r[3]); ms > 0 {
			lat = append(lat, ms)
		}
	}
	if d.Decisions > 0 {
		d.ModelFree = float64(free) / float64(d.Decisions)
	}
	d.GraphQueried = int64(len(lat))
	if len(lat) > 0 {
		sort.Float64s(lat)
		d.GraphMSP50, d.GraphMSP95 = lat[len(lat)/2], lat[(len(lat)*95)/100]
	}

	rows, err = c.Query(ctx, q("digest_autonomy"), map[string]any{"min": minClean})
	if err != nil {
		return d, err
	}
	for _, r := range rows {
		d.Autonomy = append(d.Autonomy, Autonomy{Agent: Str(r[0]), Repo: Str(r[1]), Tool: Str(r[2]), Caps: Str(r[3]), Clean: Int(r[4])})
	}

	links, broken, err := c.VerifyChain(ctx)
	d.ChainLinks, d.ChainBroken = links, broken
	return d, err
}

// VerifyChain walks the mirrored decision chain: every decision that names a
// predecessor must have a PREV edge to a node carrying exactly that hash.
func (c *Client) VerifyChain(ctx context.Context) (links, broken int64, err error) {
	rows, err := c.Query(ctx, q("verify_chain"), nil)
	if err != nil || len(rows) == 0 {
		return 0, 0, err
	}
	return Int(rows[0][0]), Int(rows[0][1]), nil
}

func nonNilStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func auditTS(e audit.Event) string {
	if e.Timestamp.IsZero() {
		return ""
	}
	return e.Timestamp.UTC().Format(time.RFC3339Nano)
}
