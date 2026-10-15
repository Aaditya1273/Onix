package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/Aaditya1273/Vigil/internal/graph"
	"github.com/spf13/cobra"
)

func graphSeedCmd() *cobra.Command {
	var reset bool
	cmd := &cobra.Command{
		Use:   "graph-seed",
		Short: "Load the demo graph into FalkorDB (VIGIL_FALKORDB_URL)",
		Long: `Creates the indexes and the demo world the firewall's graph checks run
against: the Northwind identity graph (Person, SAME_AS, IS_A, Policy DENIES),
an npm dependency graph with maintainers and typosquats, org policy on
capabilities, and facts with supersession and provenance.

Idempotent: every statement is a MERGE. Uses the same graph.Client the
running firewall uses, on the tenant graph tenant_<VIGIL_ORG_ID>.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
			g := graph.NewFromEnv(logger)
			if g == nil {
				return fmt.Errorf("VIGIL_FALKORDB_URL not set (e.g. redis://localhost:6379)")
			}
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			if reset {
				fmt.Printf("dropping %s...\n", g.Graph())
				if err := g.Delete(ctx); err != nil {
					return err
				}
			}
			if err := g.Seed(ctx); err != nil {
				return err
			}
			fmt.Printf("seeded %s\n", g.Graph())
			return nil
		},
	}
	cmd.Flags().BoolVar(&reset, "reset", false, "drop this tenant's graph first (history, trust and all); the shared threat_intel graph is untouched")
	return cmd
}
