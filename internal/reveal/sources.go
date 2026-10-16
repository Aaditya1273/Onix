// Package reveal reads an agent's local history (Claude Code, Codex, Gemini
// CLI session logs), replays every tool call through the firewall in time
// order, and leaves the result in a graph. Nothing is uploaded: files are
// read from disk and written only to the FalkorDB you point it at.
package reveal

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Event is one tool call as the harness recorded it.
type Event struct {
	Source    string // claude-code | codex | gemini-cli: the agent identity trust is earned under
	Session   string
	Cwd       string
	Tool      string
	Input     map[string]any
	Output    string // the result as text
	Result    any    // the structured result, when the harness kept one
	HasResult bool
	IsError   bool
	At        time.Time // when the call was made
	Done      time.Time // when its result arrived (zero if unknown)
}

// entry is an Event's place in the time-ordered index. Claude Code calls are
// loaded from disk when replayed (offsets); the small formats are inline.
type entry struct {
	at     time.Time
	file   int
	useOff int64
	block  int
	id     string
	resOff int64 // -1: no result recorded
	resAt  time.Time
	inline *Event
}

// Scan is what discovery found.
type Scan struct {
	Dirs    []string           `json:"dirs"`  // where it looked
	Found   map[string]int     `json:"found"` // source -> files
	Calls   int                `json:"calls"` // tool calls in the window
	Skipped int                `json:"skipped_before_window"`
	Costs   map[string]float64 `json:"-"` // raw session id -> recorded cost (USD)

	files   []string
	entries []entry
}

// Discover indexes every session log under home, keeping calls made at or
// after since. Lines are streamed; only call and result lines are decoded.
func Discover(home string, since time.Time) (*Scan, error) {
	s := &Scan{Found: map[string]int{}, Costs: map[string]float64{}}
	claude := filepath.Join(home, ".claude", "projects")
	codex := filepath.Join(home, ".codex", "sessions")
	gemini := filepath.Join(home, ".gemini", "tmp")
	s.Dirs = []string{claude, codex, gemini}

	if err := walk(claude, ".jsonl", func(p string) error {
		s.Found["claude-code"]++
		return s.indexClaude(p, since)
	}); err != nil {
		return nil, err
	}
	if err := walk(codex, ".jsonl", func(p string) error {
		s.Found["codex"]++
		evs, err := parseCodex(p)
		s.addInline(evs, since)
		return err
	}); err != nil {
		return nil, err
	}
	if err := walk(gemini, ".json", func(p string) error {
		if !strings.Contains(filepath.ToSlash(p), "/chats/") {
			return nil
		}
		s.Found["gemini-cli"]++
		evs, err := parseGemini(p)
		s.addInline(evs, since)
		return err
	}); err != nil {
		return nil, err
	}
	sort.SliceStable(s.entries, func(i, j int) bool { return s.entries[i].at.Before(s.entries[j].at) })
	s.Calls = len(s.entries)
	return s, nil
}

func walk(root, ext string, fn func(string) error) error {
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // unreadable entries are skipped, not fatal
		}
		if !d.IsDir() && strings.HasSuffix(p, ext) {
			if err := fn(p); err != nil {
				return fmt.Errorf("%s: %w", p, err)
			}
		}
		return nil
	})
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func (s *Scan) addInline(evs []Event, since time.Time) {
	for i := range evs {
		if evs[i].At.Before(since) {
			s.Skipped++
			continue
		}
		s.entries = append(s.entries, entry{at: evs[i].At, resOff: -1, inline: &evs[i]})
	}
}

// --- Claude Code: ~/.claude/projects/<project>/<session>.jsonl --------------

type claudeLine struct {
	Type          string    `json:"type"`
	Timestamp     time.Time `json:"timestamp"`
	SessionID     string    `json:"sessionId"`
	Cwd           string    `json:"cwd"`
	TotalCostUSD  *float64  `json:"totalCostUSD"`
	ToolUseResult any       `json:"toolUseResult"`
	Message       struct {
		Content json.RawMessage `json:"content"`
	} `json:"message"`
}

type claudeBlock struct {
	Type      string          `json:"type"`
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Input     map[string]any  `json:"input"`
	ToolUseID string          `json:"tool_use_id"`
	Content   json.RawMessage `json:"content"`
	IsError   bool            `json:"is_error"`
}

func blocks(raw json.RawMessage) []claudeBlock {
	var bs []claudeBlock
	if len(raw) > 0 && raw[0] == '[' {
		json.Unmarshal(raw, &bs)
	}
	return bs
}

var (
	markUse    = []byte(`"tool_use"`)
	markResult = []byte(`"tool_result"`)
	markCost   = []byte(`"cost-state"`)
)

func (s *Scan) indexClaude(path string, since time.Time) error {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	fileIdx := len(s.files)
	s.files = append(s.files, path)
	pending := map[string]int{} // tool_use id -> entry index
	r := bufio.NewReaderSize(f, 1<<20)
	var off int64
	for {
		line, err := r.ReadBytes('\n')
		lineOff := off
		off += int64(len(line))
		if len(line) > 0 {
			isUse, isRes, isCost := bytes.Contains(line, markUse), bytes.Contains(line, markResult), bytes.Contains(line, markCost)
			if isUse || isRes || isCost {
				var l claudeLine
				if json.Unmarshal(line, &l) == nil {
					switch {
					case l.Type == "cost-state" && l.TotalCostUSD != nil:
						s.Costs[l.SessionID] = *l.TotalCostUSD
					case l.Type == "assistant":
						for i, b := range blocks(l.Message.Content) {
							if b.Type != "tool_use" {
								continue
							}
							if l.Timestamp.Before(since) {
								s.Skipped++
								continue
							}
							pending[b.ID] = len(s.entries)
							s.entries = append(s.entries, entry{at: l.Timestamp, file: fileIdx, useOff: lineOff, block: i, id: b.ID, resOff: -1})
						}
					case l.Type == "user":
						for _, b := range blocks(l.Message.Content) {
							if i, ok := pending[b.ToolUseID]; ok && b.Type == "tool_result" {
								s.entries[i].resOff, s.entries[i].resAt = lineOff, l.Timestamp
								delete(pending, b.ToolUseID)
							}
						}
					}
				}
			}
		}
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

func readLine(f *os.File, off int64) ([]byte, error) {
	return bufio.NewReaderSize(io.NewSectionReader(f, off, 1<<40), 1<<16).ReadBytes('\n')
}

// textOf flattens a tool_result's content: a string, or [{type:text,text}].
func textOf(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var parts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	json.Unmarshal(raw, &parts)
	var b strings.Builder
	for _, p := range parts {
		if p.Type == "text" {
			b.WriteString(p.Text)
			b.WriteByte('\n')
		}
	}
	return b.String()
}

// Each calls fn for every indexed call, oldest first, loading Claude Code
// calls from disk as it goes. At most a few hundred files are open at once.
func (s *Scan) Each(fn func(i int, e Event) error) error {
	open := map[int]*os.File{}
	defer func() {
		for _, f := range open {
			f.Close()
		}
	}()
	for i, en := range s.entries {
		if en.inline != nil {
			if err := fn(i, *en.inline); err != nil {
				return err
			}
			continue
		}
		f, ok := open[en.file]
		if !ok {
			if len(open) >= 256 {
				for k, of := range open {
					of.Close()
					delete(open, k)
				}
			}
			var err error
			if f, err = os.Open(s.files[en.file]); err != nil {
				continue
			}
			open[en.file] = f
		}
		ev, ok := loadClaude(f, en)
		if !ok {
			continue
		}
		if err := fn(i, ev); err != nil {
			return err
		}
	}
	return nil
}

func loadClaude(f *os.File, en entry) (Event, bool) {
	raw, err := readLine(f, en.useOff)
	if err != nil && len(raw) == 0 {
		return Event{}, false
	}
	var l claudeLine
	if json.Unmarshal(raw, &l) != nil {
		return Event{}, false
	}
	bs := blocks(l.Message.Content)
	if en.block >= len(bs) {
		return Event{}, false
	}
	b := bs[en.block]
	ev := Event{Source: "claude-code", Session: l.SessionID, Cwd: l.Cwd, Tool: b.Name, Input: b.Input, At: l.Timestamp}
	if ev.Input == nil {
		ev.Input = map[string]any{}
	}
	if en.resOff < 0 {
		return ev, true
	}
	if raw, err = readLine(f, en.resOff); err != nil && len(raw) == 0 {
		return ev, true
	}
	var rl claudeLine
	if json.Unmarshal(raw, &rl) != nil {
		return ev, true
	}
	for _, rb := range blocks(rl.Message.Content) {
		if rb.Type == "tool_result" && rb.ToolUseID == en.id {
			ev.HasResult, ev.IsError, ev.Done = true, rb.IsError, rl.Timestamp
			ev.Output = textOf(rb.Content)
			ev.Result = rl.ToolUseResult
		}
	}
	return ev, true
}

// --- Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl ---------------------
//
// {"timestamp", "type":"session_meta", "payload":{id, cwd}}, then
// {"type":"response_item","payload":{"type":"function_call", name, arguments, call_id}}
// and {"payload":{"type":"function_call_output", call_id, output}}. Older
// rollouts put the item at the top level without the envelope.

type codexItem struct {
	Type      string          `json:"type"`
	ID        string          `json:"id"`
	Cwd       string          `json:"cwd"`
	Name      string          `json:"name"`
	Arguments string          `json:"arguments"`
	Input     string          `json:"input"`
	CallID    string          `json:"call_id"`
	Output    json.RawMessage `json:"output"`
	Action    map[string]any  `json:"action"`
}

func parseCodex(path string) ([]Event, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, nil
	}
	defer f.Close()
	session := strings.TrimSuffix(filepath.Base(path), ".jsonl")
	cwd := ""
	var evs []Event
	byCall := map[string]int{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 64<<20)
	for sc.Scan() {
		var env struct {
			Timestamp time.Time       `json:"timestamp"`
			Type      string          `json:"type"`
			Payload   json.RawMessage `json:"payload"`
		}
		if json.Unmarshal(sc.Bytes(), &env) != nil {
			continue
		}
		var it codexItem
		if len(env.Payload) > 0 {
			json.Unmarshal(env.Payload, &it)
		} else {
			json.Unmarshal(sc.Bytes(), &it)
		}
		switch {
		case env.Type == "session_meta":
			if it.ID != "" {
				session = it.ID
			}
			cwd = it.Cwd
		case it.Type == "function_call" || it.Type == "custom_tool_call" || it.Type == "local_shell_call":
			in := map[string]any{}
			if it.Arguments != "" {
				json.Unmarshal([]byte(it.Arguments), &in)
			} else if it.Input != "" {
				in["input"] = it.Input
			}
			if it.Type == "local_shell_call" {
				in = it.Action
				it.Name = "local_shell"
			}
			byCall[it.CallID] = len(evs)
			evs = append(evs, Event{Source: "codex", Session: session, Cwd: cwd, Tool: it.Name, Input: in, At: env.Timestamp})
		case it.Type == "function_call_output" || it.Type == "custom_tool_call_output":
			if i, ok := byCall[it.CallID]; ok {
				out := textOf(it.Output)
				var wrapped struct {
					Output   string `json:"output"`
					Metadata struct {
						ExitCode *int `json:"exit_code"`
					} `json:"metadata"`
				}
				if json.Unmarshal([]byte(out), &wrapped) == nil && wrapped.Output != "" {
					out = wrapped.Output
					evs[i].IsError = wrapped.Metadata.ExitCode != nil && *wrapped.Metadata.ExitCode != 0
				}
				evs[i].Output, evs[i].HasResult, evs[i].Done = out, true, env.Timestamp
			}
		}
	}
	return evs, sc.Err()
}

// --- Gemini CLI: ~/.gemini/tmp/<project hash>/chats/session-*.json ------------

func parseGemini(path string) ([]Event, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, nil
	}
	var doc struct {
		SessionID   string `json:"sessionId"`
		ProjectHash string `json:"projectHash"`
		Messages    []struct {
			Timestamp time.Time `json:"timestamp"`
			ToolCalls []struct {
				Name      string         `json:"name"`
				Args      map[string]any `json:"args"`
				Status    string         `json:"status"`
				Timestamp time.Time      `json:"timestamp"`
				Result    []struct {
					FunctionResponse struct {
						Response map[string]any `json:"response"`
					} `json:"functionResponse"`
				} `json:"result"`
			} `json:"toolCalls"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, nil
	}
	var evs []Event
	for _, m := range doc.Messages {
		for _, tc := range m.ToolCalls {
			at := tc.Timestamp
			if at.IsZero() {
				at = m.Timestamp
			}
			ev := Event{Source: "gemini-cli", Session: doc.SessionID, Cwd: "gemini:" + doc.ProjectHash, Tool: tc.Name, Input: tc.Args, At: at}
			if ev.Input == nil {
				ev.Input = map[string]any{}
			}
			for _, r := range tc.Result {
				if o, ok := r.FunctionResponse.Response["output"].(string); ok {
					ev.Output += o
				}
				ev.Result, ev.HasResult = r.FunctionResponse.Response, true
			}
			ev.IsError = tc.Status == "error"
			evs = append(evs, ev)
		}
	}
	return evs, nil
}
