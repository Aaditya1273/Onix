package graph

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"path"
	"sort"
	"strings"
	"time"
)

// Every Cypher query the product runs lives in queries/*.cypher, one per
// file, so the README, the code and `vigil-cli check-queries` all read the
// same text. A file starts with comment lines: a description, then
// `// params: {...}` with sample parameters the checker executes it with.
//
//go:embed queries/*.cypher
var queryFS embed.FS

type Query struct {
	Name   string
	Text   string         // the Cypher, header stripped
	Params map[string]any // sample parameters from the header
}

var queries = func() map[string]Query {
	entries, err := queryFS.ReadDir("queries")
	if err != nil {
		panic(err)
	}
	out := map[string]Query{}
	for _, e := range entries {
		raw, err := queryFS.ReadFile(path.Join("queries", e.Name()))
		if err != nil {
			panic(err)
		}
		qy := Query{Name: strings.TrimSuffix(e.Name(), ".cypher"), Params: map[string]any{}}
		var body []string
		header := true
		for _, line := range strings.Split(string(raw), "\n") {
			t := strings.TrimSpace(line)
			if header && strings.HasPrefix(t, "//") {
				if p, ok := strings.CutPrefix(t, "// params:"); ok {
					if err := json.Unmarshal([]byte(p), &qy.Params); err != nil {
						panic(fmt.Sprintf("graph: bad params header in %s: %v", e.Name(), err))
					}
				}
				continue
			}
			header = false
			body = append(body, line)
		}
		qy.Text = strings.TrimSpace(strings.Join(body, "\n"))
		out[qy.Name] = qy
	}
	return out
}()

// q returns a query's text. A missing name is a programming error.
func q(name string) string {
	qy, ok := queries[name]
	if !ok {
		panic("graph: no query named " + name)
	}
	return qy.Text
}

// Queries lists every query, sorted by name, for the checker and the docs.
func Queries() []Query {
	out := make([]Query, 0, len(queries))
	for _, qy := range queries {
		out = append(out, qy)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// RunQuery executes one named query on the tenant graph with its params,
// read-write, for the checker.
func (c *Client) RunQuery(qy Query, params map[string]any) error {
	ctx, cancel := contextWithTimeout()
	defer cancel()
	_, err := c.run(ctx, c.graph, "GRAPH.QUERY", qy.Text, params)
	return err
}

func contextWithTimeout() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 10*time.Second)
}
