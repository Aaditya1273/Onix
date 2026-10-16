package firewall

import (
	"context"
	"encoding/json"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/Aaditya1273/Vigil/internal/graph"
)

// Shadow execution, firewall side: predict what an allowed call will touch
// (from its arguments and the tool's history in the graph), and after it runs
// record what the harness reports it did. The graph diffs the two
// (effect_diff.cypher).
//
// Known limit: "observed" is what the tool or harness reports in its
// structured response, not a syscall trace. A tool that writes a file and
// says nothing about it is not caught here (eBPF-level tracing would be).

const maxEffects = 100

var (
	// Argument keys that name a file the call works on.
	fileArgKeys = keySet("path", "file_path", "filePath", "notebook_path", "paths", "files", "file", "dir", "directory", "target", "destination", "dest", "output", "out")
	// Structured response keys a tool or harness uses to report what it did.
	fileReportKeys = keySet("filePath", "file_path", "path", "paths", "files", "files_written", "files_modified", "files_created", "files_deleted", "written", "modified", "created", "deleted")
	hostReportKeys = keySet("url", "urls", "host", "hosts", "hosts_contacted", "endpoint", "endpoints")
	pkgReportKeys  = keySet("packages", "packages_installed", "installed")
	envReportKeys  = keySet("env", "env_vars", "env_read")

	envRefRe  = regexp.MustCompile(`\$\{?([A-Z_][A-Z0-9_]*)`)
	fileExtRe = regexp.MustCompile(`^[\w.\-]+\.\w{1,6}$`)
)

func keySet(ks ...string) map[string]bool {
	m := make(map[string]bool, len(ks))
	for _, k := range ks {
		m[k] = true
	}
	return m
}

type effectSet struct {
	seen map[string]bool
	list []graph.EffectRef
}

func (s *effectSet) add(kind, name string) {
	name = strings.TrimSpace(name)
	if name == "" || len(s.list) >= maxEffects {
		return
	}
	switch kind {
	case "file":
		name = path.Clean(name)
	case "host":
		if u, err := url.Parse(name); err == nil && u.Host != "" {
			name = u.Hostname()
		}
		name = strings.ToLower(name)
	}
	if s.seen == nil {
		s.seen = map[string]bool{}
	}
	if k := kind + "\x00" + name; !s.seen[k] {
		s.seen[k] = true
		s.list = append(s.list, graph.EffectRef{Kind: kind, Name: name})
	}
}

func eachString(v any, fn func(string)) {
	switch x := v.(type) {
	case string:
		fn(x)
	case []any:
		for _, e := range x {
			eachString(e, fn)
		}
	case map[string]any:
		for _, e := range x {
			eachString(e, fn)
		}
	}
}

// predictFromArgs is what the call says it will touch.
func predictFromArgs(tool string, args map[string]any) []graph.EffectRef {
	var s effectSet
	for k, v := range args {
		if fileArgKeys[k] {
			eachString(v, func(p string) { s.add("file", p) })
		}
		eachString(v, func(str string) {
			for _, u := range urlRe.FindAllString(str, maxEffects) {
				s.add("host", u)
			}
		})
	}
	if tool == "run_command" {
		cmd, _ := args["command"].(string)
		if pkg := extractPackageName(cmd); pkg != "" {
			s.add("package", pkg)
		}
		for _, m := range envRefRe.FindAllStringSubmatch(cmd, maxEffects) {
			s.add("env", m[1])
		}
		for _, tok := range argSplitRe.Split(cmd, -1) {
			if strings.Contains(tok, "://") || strings.HasPrefix(tok, "-") {
				continue
			}
			if strings.ContainsRune(tok, '/') || strings.HasPrefix(tok, "~") || fileExtRe.MatchString(tok) {
				s.add("file", tok)
			}
		}
	}
	return s.list
}

// observedFromResponse is what the tool or harness reports it did, read only
// from structured fields (free-text output is too noisy to call an effect).
func observedFromResponse(tool string, args map[string]any, response any) []graph.EffectRef {
	var s effectSet
	if tool == "write_file" { // the harness wrote it: that is an observation
		eachString(args["path"], func(p string) { s.add("file", p) })
	}
	var walk func(any)
	walk = func(v any) {
		switch x := v.(type) {
		case map[string]any:
			for k, e := range x {
				switch {
				case fileReportKeys[k]:
					eachString(e, func(p string) { s.add("file", p) })
				case hostReportKeys[k]:
					eachString(e, func(h string) { s.add("host", h) })
				case pkgReportKeys[k]:
					eachString(e, func(p string) { s.add("package", p) })
				case envReportKeys[k]:
					eachString(e, func(p string) { s.add("env", p) })
				default:
					walk(e)
				}
			}
		case []any:
			for _, e := range x {
				walk(e)
			}
		}
	}
	walk(response)
	return s.list
}

// predict is the call's own effects plus what the tool has done before.
func (f *Firewall) predict(ctx context.Context, c Call) []graph.EffectRef {
	var s effectSet
	for _, e := range predictFromArgs(c.Tool, c.Args) {
		s.add(e.Kind, e.Name)
	}
	if f.deps.Graph.Configured() {
		ctx, cancel := context.WithTimeout(ctx, graphTimeout)
		defer cancel()
		hist, err := f.deps.Graph.EffectHistory(ctx, c.Tool)
		if err != nil {
			f.warnGraph(ctx, "effect history", err)
		}
		for _, e := range hist {
			s.add(e.Kind, e.Name)
		}
	}
	sort.Slice(s.list, func(i, j int) bool {
		return s.list[i].Kind+s.list[i].Name < s.list[j].Kind+s.list[j].Name
	})
	return s.list
}

// checkHiddenEffects is a behavior signal: this agent's recent calls of this
// tool did things nobody predicted.
func (f *Firewall) checkHiddenEffects(ctx context.Context, agent, tool string) (n int64, gf graphFinding) {
	if !f.deps.Graph.Configured() {
		return 0, gf
	}
	start := time.Now()
	ctx, cancel := context.WithTimeout(ctx, graphTimeout)
	defer cancel()
	n, err := f.deps.Graph.HiddenRecent(ctx, agent, tool)
	gf.ms = msSince(start)
	if err != nil {
		f.warnGraph(ctx, "hidden effect lookup", err)
		return 0, gf
	}
	gf.queried = true
	if n > 0 {
		gf.paths = []string{agent + " --[" + tool + " had a hidden side effect in " + itoa(n) + " of its last 20 calls]--> ObservedEffect"}
	}
	return n, gf
}

// ObserveEffects records what an executed call actually did. response is the
// tool's structured result (the hook's tool_response, or MCP output parsed as
// JSON when it is JSON).
func (f *Firewall) ObserveEffects(sessionID, tool string, args map[string]any, response any) {
	if !f.deps.Graph.Configured() {
		return
	}
	f.deps.Graph.RecordObserved(sessionID, tool, observedFromResponse(tool, args, response))
}

// ParseResponse turns text output into structured data when it is JSON.
func ParseResponse(output string) any {
	var v any
	if json.Unmarshal([]byte(strings.TrimSpace(output)), &v) == nil {
		return v
	}
	return nil
}

func itoa(n int64) string {
	b, _ := json.Marshal(n)
	return string(b)
}
