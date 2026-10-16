// Package graph is Vigil's memory: every decision, call, tool, package, person
// and fact lives in FalkorDB, one graph per tenant (tenant_<org>) plus one
// shared threat_intel graph. The firewall asks it questions in Cypher; see
// model.go for every query the product runs on.
//
// A nil *Client is a safe no-op everywhere (Configured() reports false), so a
// deployment without VIGIL_FALKORDB_URL still enforces intent and cost — it
// just has no memory.
package graph

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/Aaditya1273/Vigil/internal/vigil"
	"github.com/redis/go-redis/v9"
)

// ThreatGraph is the graph shared by every tenant: hashes only, never content.
const ThreatGraph = "threat_intel"

// Client talks to FalkorDB over the Redis protocol with GRAPH.QUERY.
type Client struct {
	// downUntil (unix ns) short-circuits every call after a connection
	// failure, so an outage costs the request path one failed dial, not one
	// per graph check per call.
	downUntil atomic.Int64
	rdb       *redis.Client
	tenant    string
	graph     string
	logger    *slog.Logger
	writes    chan func(context.Context) error
}

// New connects to url (redis://host:port) for tenant. Writes go through a
// single ordered writer so the Decision hash chain lands in order and the
// request path never waits on a write.
func New(url, tenant string, logger *slog.Logger) (*Client, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("graph: bad FalkorDB url: %w", err)
	}
	// RESP2: FalkorDB's compact result format is specified against it.
	opt.Protocol = 2
	opt.DialTimeout = time.Second
	opt.MaxRetries = 1
	if logger == nil {
		logger = slog.Default()
	}
	if tenant == "" {
		tenant = "default"
	}
	c := &Client{
		rdb:    redis.NewClient(opt),
		tenant: tenant,
		graph:  "tenant_" + tenant,
		logger: logger,
		// ponytail: one writer goroutine, bounded queue; shard per session if
		// write throughput ever becomes the bottleneck.
		writes: make(chan func(context.Context) error, 4096),
	}
	go c.writer()
	return c, nil
}

// NewFromEnv returns nil when VIGIL_FALKORDB_URL is unset.
func NewFromEnv(logger *slog.Logger) *Client {
	url := vigil.Env("FALKORDB_URL")
	if url == "" {
		return nil
	}
	c, err := New(url, vigil.EnvOr("ORG_ID", "default"), logger)
	if err != nil {
		logger.Error("vigil: FalkorDB disabled", slog.String("error", err.Error()))
		return nil
	}
	return c
}

func (c *Client) Configured() bool { return c != nil }

// Graph is the tenant graph name, e.g. tenant_default.
func (c *Client) Graph() string { return c.graph }

func (c *Client) Ping(ctx context.Context) error { return c.rdb.Ping(ctx).Err() }

// Rows is a query result: one []any per row, values already typed
// (nil, string, int64, float64, bool, []any).
type Rows [][]any

// Query runs a read-only query on the tenant graph.
func (c *Client) Query(ctx context.Context, cypher string, params map[string]any) (Rows, error) {
	return c.run(ctx, c.graph, "GRAPH.RO_QUERY", cypher, params)
}

// Exec runs a write on the tenant graph synchronously.
func (c *Client) Exec(ctx context.Context, cypher string, params map[string]any) error {
	_, err := c.run(ctx, c.graph, "GRAPH.QUERY", cypher, params)
	return err
}

// ErrDown is returned without a round trip while the breaker is open.
var ErrDown = errors.New("graph: FalkorDB unreachable, retrying shortly")

func (c *Client) run(ctx context.Context, graph, cmd, cypher string, params map[string]any) (Rows, error) {
	if time.Now().UnixNano() < c.downUntil.Load() {
		return nil, ErrDown
	}
	raw, err := c.rdb.Do(ctx, cmd, graph, encodeParams(params)+cypher, "--compact").Result()
	if err != nil {
		var serverErr redis.Error
		if !errors.As(err, &serverErr) {
			// ponytail: one breaker for the whole client, fixed 5s; per-graph
			// state and backoff if partial outages ever matter.
			c.downUntil.Store(time.Now().Add(5 * time.Second).UnixNano())
		}
		// A graph nothing has been written to yet has no history: that is
		// zero rows, not a failure.
		if cmd == "GRAPH.RO_QUERY" && strings.Contains(err.Error(), "empty key") {
			return nil, nil
		}
		return nil, err
	}
	return parseCompact(raw)
}

// enqueue hands a write to the ordered writer. A full queue drops the write
// and says so: losing graph history is bad, stalling every agent is worse.
func (c *Client) enqueue(w func(context.Context) error) {
	select {
	case c.writes <- w:
	default:
		c.logger.Warn("vigil: graph write queue full, dropping write")
	}
}

// Flush blocks until every write enqueued before it has run.
func (c *Client) Flush() {
	if c == nil {
		return
	}
	done := make(chan struct{})
	c.writes <- func(context.Context) error { close(done); return nil }
	<-done
}

func (c *Client) writer() {
	for w := range c.writes {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := w(ctx); err != nil {
			c.logger.Warn("vigil: graph write failed", slog.String("error", err.Error()))
		}
		cancel()
	}
}

// EnsureSchema creates the indexes every hot-path lookup relies on.
// Idempotent: an existing index is not an error.
func (c *Client) EnsureSchema(ctx context.Context) error {
	tenant := [][2]string{
		{"Agent", "id"}, {"Session", "id"}, {"Call", "id"}, {"Call", "tool"},
		{"Tool", "name"}, {"Capability", "name"}, {"Decision", "hash"},
		{"Package", "name"}, {"Maintainer", "name"}, {"Person", "name_lc"},
		{"Policy", "name"}, {"Fact", "subject_lc"}, {"Decision", "id"},
		{"FlowSource", "call"}, {"FlowSink", "call"}, {"Effect", "call"}, {"ArgSlot", "call"},
		{"FlowValue", "call"}, {"FlowRead", "call"}, {"Value", "hash"},
	}
	for _, ix := range tenant {
		if err := c.index(ctx, c.graph, ix[0], ix[1]); err != nil {
			return err
		}
	}
	return c.index(ctx, ThreatGraph, "Hash", "value")
}

func (c *Client) index(ctx context.Context, graph, label, prop string) error {
	_, err := c.run(ctx, graph, "GRAPH.QUERY", fmt.Sprintf("CREATE INDEX FOR (n:%s) ON (n.%s)", label, prop), nil)
	if err != nil && !strings.Contains(err.Error(), "already indexed") {
		return fmt.Errorf("graph: index %s.%s: %w", label, prop, err)
	}
	return nil
}

// Delete drops the tenant graph. Used only by the seed command's --reset.
func (c *Client) Delete(ctx context.Context) error {
	err := c.rdb.Do(ctx, "GRAPH.DELETE", c.graph).Err()
	if err != nil && strings.Contains(err.Error(), "empty key") {
		return nil
	}
	return err
}

// --- parameters ---------------------------------------------------------------

// encodeParams renders FalkorDB's "CYPHER k=v ..." header. Values are always
// passed as parameters, never spliced into the query text.
func encodeParams(params map[string]any) string {
	if len(params) == 0 {
		return ""
	}
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	b.WriteString("CYPHER ")
	for _, k := range keys {
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(literal(params[k]))
		b.WriteByte(' ')
	}
	return b.String()
}

func literal(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case string:
		return quote(x)
	case bool:
		return strconv.FormatBool(x)
	case int:
		return strconv.Itoa(x)
	case int64:
		return strconv.FormatInt(x, 10)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case []string:
		parts := make([]string, len(x))
		for i, s := range x {
			parts[i] = quote(s)
		}
		return "[" + strings.Join(parts, ",") + "]"
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			parts[i] = literal(e)
		}
		return "[" + strings.Join(parts, ",") + "]"
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, len(keys))
		for i, k := range keys {
			parts[i] = mapKey(k) + ":" + literal(x[k])
		}
		return "{" + strings.Join(parts, ",") + "}"
	default:
		return quote(fmt.Sprint(x))
	}
}

// mapKey renders a map key: bare when it is an identifier, backtick-quoted
// otherwise (backticks inside are doubled, as openCypher escapes them).
// FalkorDB does not parse that escape (FALKORDB_FINDINGS F5), so such a key
// fails loudly instead of being mangled; VIGIL's own keys never contain one.
func mapKey(k string) string {
	ident := k != ""
	for i, r := range k {
		if !(r == '_' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || i > 0 && r >= '0' && r <= '9') {
			ident = false
			break
		}
	}
	if ident {
		return k
	}
	return "`" + strings.ReplaceAll(k, "`", "``") + "`"
}

func quote(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '\\':
			b.WriteString(`\\`)
		case '"':
			b.WriteString(`\"`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r >= 0x20 {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}

// --- results ------------------------------------------------------------------

// parseCompact decodes a --compact reply: [header, rows, stats], or [stats]
// for a query with no RETURN.
func parseCompact(raw any) (Rows, error) {
	top, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("graph: unexpected reply %T", raw)
	}
	if len(top) < 3 {
		return nil, nil
	}
	rawRows, _ := top[1].([]any)
	rows := make(Rows, 0, len(rawRows))
	for _, rr := range rawRows {
		cells, _ := rr.([]any)
		row := make([]any, len(cells))
		for i, cell := range cells {
			row[i] = value(cell)
		}
		rows = append(rows, row)
	}
	return rows, nil
}

// Compact value types, per FalkorDB's result-set spec.
const (
	vtNull    = 1
	vtString  = 2
	vtInteger = 3
	vtBoolean = 4
	vtDouble  = 5
	vtArray   = 6
)

func value(cell any) any {
	pair, ok := cell.([]any)
	if !ok || len(pair) != 2 {
		return cell
	}
	t, _ := pair[0].(int64)
	switch t {
	case vtNull:
		return nil
	case vtString:
		return pair[1]
	case vtInteger:
		return pair[1]
	case vtBoolean:
		return pair[1] == "true"
	case vtDouble:
		f, _ := strconv.ParseFloat(fmt.Sprint(pair[1]), 64)
		return f
	case vtArray:
		items, _ := pair[1].([]any)
		out := make([]any, len(items))
		for i, it := range items {
			out[i] = value(it)
		}
		return out
	default:
		return pair[1]
	}
}

// Str, Int and Float read a cell with a zero value for null or a type miss.
func Str(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}

func Int(v any) int64 {
	switch x := v.(type) {
	case int64:
		return x
	case float64:
		return int64(x)
	}
	return 0
}

func Float(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case int64:
		return float64(x)
	}
	return 0
}

// Hash is the anonymized identity of a threat: shared across tenants without
// sharing what it is.
func Hash(kind, value string) string {
	sum := sha256.Sum256([]byte(kind + ":" + strings.ToLower(value)))
	return hex.EncodeToString(sum[:])
}
