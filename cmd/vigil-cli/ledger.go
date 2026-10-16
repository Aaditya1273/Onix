package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/Aaditya1273/Vigil/internal/graph"
	"github.com/spf13/cobra"
)

// exportLedgerCmd writes the underwriting ledger for one tenant straight from
// FalkorDB: every sealed decision in the window, with its graph evidence.
func exportLedgerCmd() *cobra.Command {
	var days int
	var out string
	cmd := &cobra.Command{
		Use:   "export-ledger",
		Short: "Export the hash-chained decision ledger from FalkorDB (VIGIL_FALKORDB_URL, VIGIL_ORG_ID)",
		RunE: func(cmd *cobra.Command, args []string) error {
			g := graph.NewFromEnv(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})))
			if g == nil {
				return fmt.Errorf("VIGIL_FALKORDB_URL not set")
			}
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			to := time.Now()
			l, err := g.ExportLedger(ctx, to.Add(-time.Duration(days)*24*time.Hour), to)
			if err != nil {
				return err
			}
			raw, _ := json.MarshalIndent(l, "", "  ")
			if err := os.WriteFile(out, append(raw, '\n'), 0o644); err != nil {
				return err
			}
			fmt.Printf("wrote %s: %d decisions, %d risk snapshots (tenant %s)\n", out, len(l.Entries), len(l.Risk), l.Tenant)
			return nil
		},
	}
	cmd.Flags().IntVar(&days, "days", 7, "window, in days back from now")
	cmd.Flags().StringVar(&out, "out", "vigil-ledger.json", "output file")
	return cmd
}

// verifyLedgerCmd recomputes an exported ledger's hash chain, offline.
func verifyLedgerCmd() *cobra.Command {
	return &cobra.Command{
		Use:          "verify-ledger <file>",
		Short:        "Recompute an exported ledger's hash chain and report the first break",
		Args:         cobra.ExactArgs(1),
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			raw, err := os.ReadFile(args[0])
			if err != nil {
				return err
			}
			var l graph.Ledger
			if err := json.Unmarshal(raw, &l); err != nil {
				return fmt.Errorf("not a ledger: %w", err)
			}
			if l.Format != graph.LedgerFormat {
				return fmt.Errorf("unknown ledger format %q", l.Format)
			}
			r := graph.VerifyLedger(l)
			if !r.OK {
				fmt.Printf("BROKEN at decision %d of %d: %s\n", r.FailedAt, len(l.Entries), r.Reason)
				return fmt.Errorf("ledger verification failed")
			}
			fmt.Printf("OK: %d decisions, hash chain intact\n", r.Count)
			return nil
		},
	}
}
