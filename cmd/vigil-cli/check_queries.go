package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/Aaditya1273/Vigil/internal/graph"
	"github.com/Aaditya1273/Vigil/internal/vigil"
	"github.com/spf13/cobra"
)

// checkQueriesCmd executes every file in internal/graph/queries against a
// live FalkorDB, on a throwaway tenant seeded with the demo graph, using the
// sample params in each file's header. Any error fails the command.
func checkQueriesCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "check-queries",
		Short: "Execute every Cypher query file against FalkorDB (VIGIL_FALKORDB_URL)",
		RunE: func(cmd *cobra.Command, args []string) error {
			url := vigil.Env("FALKORDB_URL")
			if url == "" {
				return fmt.Errorf("VIGIL_FALKORDB_URL not set")
			}
			logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
			g, err := graph.New(url, fmt.Sprintf("querycheck_%d", time.Now().UnixNano()), logger)
			if err != nil {
				return err
			}
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			defer g.Delete(context.Background())
			if err := g.Seed(ctx); err != nil {
				return fmt.Errorf("seed: %w", err)
			}
			failed := 0
			all := graph.Queries()
			for _, qy := range all {
				if err := g.RunQuery(qy, qy.Params); err != nil {
					failed++
					fmt.Printf("FAIL %-24s %v\n", qy.Name, err)
					continue
				}
				fmt.Printf("ok   %s\n", qy.Name)
			}
			fmt.Printf("%d/%d queries executed without error\n", len(all)-failed, len(all))
			if failed > 0 {
				return fmt.Errorf("%d queries failed", failed)
			}
			return nil
		},
	}
}
