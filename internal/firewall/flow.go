package firewall

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
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
	// credentials files, and most config. A match is only a candidate; see
	// secretValues.
	assignmentRe = regexp.MustCompile(`(?m)^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.\-]*)\s*([=:])\s*["']?([^\s"'#]{8,})`)
	// Key segments (split on _ . - and case changes) that name a secret.
	secretKeyRe = regexp.MustCompile(`(?i)^(key|apikey|secret|secrets|token|password|passwd|pass|pwd|credential|credentials|private|auth|cookie|signing|signature|salt|dsn)$`)
	keySplitRe  = regexp.MustCompile(`[_.\-]+|([a-z])([A-Z])`)
	plainWordRe = regexp.MustCompile(`^[a-z]+[:.,;]*$`)
	hexRe       = regexp.MustCompile(`^(0x)?[0-9a-fA-F]+$`)
	// A URL that carries credentials: scheme://user:pass@host.
	credURLRe = regexp.MustCompile(`^[a-z][a-z0-9+.\-]*://[^/@\s]+:[^/@\s]+@`)
	// Credentials with a recognizable prefix, wherever they appear.
	tokenRe = regexp.MustCompile(`\b(?:sk-|sk_live_|ghp_|gho_|github_pat_|AKIA|xox[abprs]-|AIza|glpat-)[A-Za-z0-9_\-]{8,}`)
	urlRe   = regexp.MustCompile(`https?://[^\s"'<>()\[\]{}\\]+`)
	// Documented example values are public by definition: AWS's own docs key
	// is AKIAIOSFODNN7EXAMPLE, and READMEs say your_api_key_here.
	placeholderRe = regexp.MustCompile(`(?i)example|sample|dummy|placeholder|changeme|your[_-]?(api[_-]?)?(key|token|secret)|x{6,}|\*{4,}|<[^>]*>`)
	// Argument tokens keep URL and token punctuation, split on the rest.
	argSplitRe = regexp.MustCompile(`[\s"'=&?,;|()<>\[\]{}\\` + "`" + `]+`)
)

// valueKey keys every value digest (VIGIL_VALUE_KEY). With it the graph holds
// HMACs: a stolen graph dump can't be checked against a guessed secret,
// because the key lives with this process and never enters the graph. Without
// it, digests are plain SHA-256, as before.
var valueKey = []byte(os.Getenv("VIGIL_VALUE_KEY"))

// canonValue is the form a value is compared in, so the same secret quoted,
// padded or followed by punctuation is still the same value.
func canonValue(v string) string {
	v = strings.Trim(strings.TrimSpace(v), "\"'`")
	return strings.ToLower(strings.TrimRight(v, ".,;:"))
}

func valueHash(v string) string {
	c := canonValue(v)
	if len(valueKey) == 0 {
		return graph.Hash("value", c)
	}
	m := hmac.New(sha256.New, valueKey)
	m.Write([]byte("value:" + c))
	return hex.EncodeToString(m.Sum(nil))
}

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

// secretValues are the values in text that are secrets. An assignment counts
// when its key names a secret (API_KEY=…, password: …) and the value is not a
// plain word, or, for KEY=value, when the value looks like a credential: a URL
// with credentials, or 20+ characters mixing letters and digits that are not
// just hex (addresses, hashes and commit ids are public). Without this, any
// "status: expected" line in a command's output made "expected" a secret, and
// every later command containing the word looked like exfiltration (found by
// replaying real history with vigil-cli reveal).
func secretValues(text string) []string {
	var out []string
	for _, m := range assignmentRe.FindAllStringSubmatch(text, maxValues) {
		key, sep, val := m[1], m[2], m[3]
		if (secretKey(key) && !plainWordRe.MatchString(val)) || (sep == "=" && looksSecret(val)) {
			out = append(out, val)
		}
	}
	out = append(out, tokenRe.FindAllString(text, maxValues)...)
	kept := out[:0]
	for _, v := range out {
		cred := v
		if credURLRe.MatchString(v) { // postgres://app:pw@db.example.com: only the credentials count
			cred = v[:strings.Index(v, "@")]
		}
		if !placeholderRe.MatchString(cred) {
			kept = append(kept, v)
		}
	}
	return kept
}

func secretKey(key string) bool {
	for _, seg := range strings.Fields(keySplitRe.ReplaceAllString(key, "$1 $2")) {
		if secretKeyRe.MatchString(seg) {
			return true
		}
	}
	return false
}

func looksSecret(v string) bool {
	if credURLRe.MatchString(v) {
		return true
	}
	if len(v) < 20 || hexRe.MatchString(v) || strings.Contains(v, "://") || strings.HasPrefix(v, "/") || strings.HasPrefix(v, ".") {
		return false
	}
	var letter, digit bool
	for _, r := range v {
		switch {
		case r >= '0' && r <= '9':
			digit = true
		case (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z'):
			letter = true
		}
	}
	return letter && digit
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

// argVariants are a value's reformatted shapes that splitting on whitespace
// would miss: a secret pasted with a line break mid-string (matched with all
// whitespace removed) and a URL-encoded one (matched decoded). Each maps to the
// literal actually present, so a redact cut scrubs what is really there: the
// whole string for a rejoined value, the encoded token for a decoded one.
func argVariants(v any) map[string]string {
	out := map[string]string{}
	var walk func(any)
	walk = func(v any) {
		switch x := v.(type) {
		case string:
			if j := strings.Join(strings.Fields(x), ""); j != x && len(j) >= 8 && len(x) <= 4096 {
				out[j] = x
			}
			for _, t := range argSplitRe.Split(x, -1) {
				if d, err := url.PathUnescape(t); err == nil && d != t && len(d) >= 8 {
					out[d] = t
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
	walk(v)
	return out
}

// fileNames are the values a file path is matched by: the path and its base
// name (".env", "credentials"), so a relative reference still matches. The
// "file:" prefix keeps them apart from literal values, which any shell
// command carrying them trips; a file name trips only a call that reaches
// the network.
// ponytail: base names collide across directories, resolve against the call's cwd if that over-matches.
func fileNames(p string) []string {
	p = strings.TrimRight(p, ".,;:")
	if len(p) < 4 {
		return nil
	}
	out := []string{"file:" + p}
	if b := filepath.Base(p); b != p && len(b) >= 4 {
		out = append(out, "file:"+b)
	}
	return out
}

// fileRefs are the path-like tokens of an argument (@.env, ~/.aws/credentials),
// matched by path and base name as Observe records them.
func fileRefs(v any) []string {
	x, _ := v.(string)
	var out []string
	for _, t := range argSplitRe.Split(x, -1) {
		if p := strings.TrimLeft(t, "@<"); strings.ContainsRune(p, '/') || strings.HasPrefix(p, ".") {
			out = append(out, fileNames(p)...)
		}
	}
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
		vals := secretValues(output)
		if len(vals) > 0 { // a file that held secrets is itself one: it can be sent by name
			for _, k := range []string{"path", "file_path"} {
				if p, ok := args[k].(string); ok {
					vals = append(vals, fileNames(p)...)
				}
			}
		}
		f.deps.Graph.RecordValues(sessionID, tool, hashAll(vals), true, "TOOL")
	}
	if hasCap(caps, policy.CatNetwork) {
		f.deps.Graph.RecordValues(sessionID, tool, hashAll(urlRe.FindAllString(output, maxValues)), false, "EXTERNAL")
		// Credential-shaped values in fetched content were public before any
		// session read them as secrets. Seen here first, they stay public: a
		// docs token later copied into .env is not a secret leaving.
		f.deps.Graph.RecordPublic(sessionID, tool, hashAll(secretValues(output)))
	}
}

// ObserveAuthority records the URLs in content whose authority the graph
// already computed, such as a memory read: a rule an agent wrote down
// (TOOL) that was derived from a web page (EXTERNAL) carries EXTERNAL, the
// minimum over its DERIVED_FROM ancestors. Laundering content through memory
// does not raise its authority.
func (f *Firewall) ObserveAuthority(sessionID, tool, content, authority string) {
	if !f.deps.Graph.Configured() || content == "" {
		return
	}
	if _, ok := graph.TrustRank[authority]; !ok {
		authority = "EXTERNAL"
	}
	f.deps.Graph.RecordValues(sessionID, tool, hashAll(urlRe.FindAllString(content, maxValues)), false, authority)
}

type preFixKey struct{}

// BeforeDestinationFix computes a call's min cut with the capacities VIGIL
// used before destination arguments became uncuttable (b23879e), so the
// playground can show the old verdict next to the new one. Nothing else sets it.
func BeforeDestinationFix(ctx context.Context) context.Context {
	return context.WithValue(ctx, preFixKey{}, true)
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
	net := hasCap(caps, policy.CatNetwork)
	for _, k := range keys {
		toks := argTokens(map[string]any{k: c.Args[k]})
		if net { // curl -d @.env: a file that held secrets, named in a call that reaches the network
			toks = append(toks, fileRefs(c.Args[k])...)
		}
		for _, t := range toks {
			byHash[valueHash(t)] = t
		}
		for v, lit := range argVariants(c.Args[k]) {
			if _, ok := byHash[valueHash(v)]; !ok {
				byHash[valueHash(v)] = lit
				toks = append(toks, v)
			}
		}
		perArg[k] = toks
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
		a := graph.CutArg{Key: k, Fixed: destinationKeys[k] && ctx.Value(preFixKey{}) == nil}
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
