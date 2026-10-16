package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/Aaditya1273/Vigil/internal/appserver"
	"github.com/Aaditya1273/Vigil/internal/audit"
	"github.com/Aaditya1273/Vigil/internal/firewall"
	"github.com/Aaditya1273/Vigil/internal/graph"
	"github.com/Aaditya1273/Vigil/internal/reveal"
	"github.com/spf13/cobra"
)

func revealCmd() *cobra.Command {
	var (
		since, falkor, tenant, home string
		port                        int
		noOpen, noReplay            bool
	)
	cmd := &cobra.Command{
		Use:   "reveal",
		Short: "Replay your local agent history through VIGIL and show what it would have done",
		Long: `Reads Claude Code (~/.claude/projects), Codex (~/.codex/sessions) and Gemini
CLI (~/.gemini/tmp) session logs, replays every tool call through the firewall
in the order it happened, and opens a local page with the result.

Nothing is uploaded. The graph is written to VIGIL_FALKORDB_URL (or --falkordb)
under the tenant "reveal", rebuilt on every run. With neither set, a temporary
FalkorDB 6.0.2 container is started on a loopback port and removed on exit.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			window, err := parseSince(since)
			if err != nil {
				return err
			}
			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
			defer stop()
			logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))

			if falkor == "" {
				falkor = os.Getenv("VIGIL_FALKORDB_URL")
			}
			if falkor == "" && noReplay {
				return fmt.Errorf("--no-replay serves an existing graph: pass --falkordb or set VIGIL_FALKORDB_URL")
			}
			if falkor == "" {
				url, cleanup, err := tempFalkorDB(ctx)
				if err != nil {
					return fmt.Errorf("no FalkorDB: set VIGIL_FALKORDB_URL, or install Docker so reveal can start a temporary one (%w)", err)
				}
				defer cleanup()
				falkor = url
			}
			g, err := graph.New(falkor, tenant, logger)
			if err != nil {
				return err
			}
			if noReplay { // reopen the page over the graph a previous run built
				return serveReveal(ctx, port, noOpen, logger, appserver.ReplayFirewall(logger, g, nil), g, nil)
			}
			if err := g.Delete(ctx); err != nil {
				return fmt.Errorf("reset tenant %s: %w", tenant, err)
			}
			if err := g.SeedTyposquats(ctx); err != nil {
				return err
			}

			start := time.Now()
			scan, err := reveal.Discover(home, window)
			if err != nil {
				return err
			}
			fmt.Fprintf(os.Stderr, "found %d tool calls in %s (since %s)\n", scan.Calls, describe(scan.Found), window.Format("2006-01-02"))

			dir := filepath.Join(home, ".vigil")
			os.MkdirAll(dir, 0o700)
			ledgerPath := filepath.Join(dir, "reveal-audit.jsonl")
			os.Remove(ledgerPath)
			ledger, err := audit.Open(ledgerPath)
			if err != nil {
				return err
			}
			fw := appserver.ReplayFirewall(logger, g, ledger)

			last := time.Now()
			err = reveal.Replay(ctx, scan, fw, g, home, func(done, total int) {
				if time.Since(last) < 500*time.Millisecond && done != total {
					return
				}
				last = time.Now()
				rate := float64(done) / time.Since(start).Seconds()
				fmt.Fprintf(os.Stderr, "\rreplaying %d / %d calls (%d%%), %.0f calls/s   ", done, total, 100*done/max(total, 1), rate)
			})
			fmt.Fprintln(os.Stderr)
			if err != nil {
				return err
			}
			sum, err := g.Reveal(ctx, fw.TrustThreshold())
			if err != nil {
				return err
			}
			fmt.Printf("%s (replayed in %s)\n", reveal.Summary(sum), time.Since(start).Round(time.Second))

			return serveReveal(ctx, port, noOpen, logger, fw, g, scan)
		},
	}
	h, _ := os.UserHomeDir()
	cmd.Flags().StringVar(&since, "since", "30d", "how far back to read: 30d, 12h, 90m, or all")
	cmd.Flags().StringVar(&falkor, "falkordb", "", "FalkorDB URL (default VIGIL_FALKORDB_URL, else a temporary Docker container)")
	cmd.Flags().StringVar(&tenant, "tenant", "reveal", "graph tenant to rebuild")
	cmd.Flags().StringVar(&home, "home", h, "home directory whose agent logs to read")
	cmd.Flags().IntVar(&port, "port", 7777, "local port for the page (0 picks one)")
	cmd.Flags().BoolVar(&noOpen, "no-open", false, "do not open a browser")
	cmd.Flags().BoolVar(&noReplay, "no-replay", false, "serve the graph a previous run built (needs --falkordb or VIGIL_FALKORDB_URL)")
	return cmd
}

func serveReveal(ctx context.Context, port int, noOpen bool, logger *slog.Logger, fw *firewall.Firewall, g *graph.Client, scan *reveal.Scan) error {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return err
	}
	page := fmt.Sprintf("http://%s/web/reveal.html", ln.Addr())
	fmt.Printf("open %s  (Ctrl-C to stop)\n", page)
	if !noOpen {
		openBrowser(page)
	}
	var info func() any
	if scan != nil {
		info = func() any { return scan }
	}
	return appserver.ServeLocal(ctx, ln, logger, fw, g, info)
}

func parseSince(s string) (time.Time, error) {
	if s == "all" || s == "0" {
		return time.Time{}, nil
	}
	if n, err := strconv.Atoi(strings.TrimSuffix(s, "d")); err == nil && strings.HasSuffix(s, "d") && n > 0 {
		return time.Now().Add(-time.Duration(n) * 24 * time.Hour), nil
	}
	d, err := time.ParseDuration(s)
	if err != nil || d <= 0 {
		return time.Time{}, fmt.Errorf("--since %q: use 30d, 12h, 90m or all", s)
	}
	return time.Now().Add(-d), nil
}

func describe(found map[string]int) string {
	if len(found) == 0 {
		return "no session files"
	}
	var parts []string
	for _, k := range []string{"claude-code", "codex", "gemini-cli"} {
		if n := found[k]; n > 0 {
			parts = append(parts, fmt.Sprintf("%d %s file(s)", n, k))
		}
	}
	return strings.Join(parts, ", ")
}

// tempFalkorDB starts FalkorDB in Docker on a loopback port and returns its
// URL and a function that removes it.
func tempFalkorDB(ctx context.Context) (string, func(), error) {
	out, err := exec.CommandContext(ctx, "docker", "run", "-d", "--rm", "-p", "127.0.0.1::6379", "falkordb/falkordb:6.0.2").Output()
	if err != nil {
		return "", nil, err
	}
	id := strings.TrimSpace(string(out))
	cleanup := func() { exec.Command("docker", "stop", id).Run() }
	addr, err := exec.CommandContext(ctx, "docker", "port", id, "6379/tcp").Output()
	if err != nil {
		cleanup()
		return "", nil, err
	}
	hostport := strings.TrimSpace(strings.Split(string(addr), "\n")[0])
	url := "redis://" + hostport
	for i := 0; i < 60; i++ { // wait for the module to load
		if c, err := net.DialTimeout("tcp", hostport, time.Second); err == nil {
			c.Close()
			if g, err := graph.New(url, "probe", nil); err == nil && g.EnsureSchema(ctx) == nil {
				g.Delete(ctx)
				fmt.Fprintf(os.Stderr, "started a temporary FalkorDB 6.0.2 at %s (removed on exit)\n", hostport)
				return url, cleanup, nil
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	cleanup()
	return "", nil, fmt.Errorf("temporary FalkorDB did not start")
}

func openBrowser(url string) {
	var c *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		c = exec.Command("open", url)
	case "windows":
		c = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		c = exec.Command("xdg-open", url)
	}
	c.Start()
}
