package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

func main() {
	var rootCmd = &cobra.Command{
		Use:   "vigil-cli",
		Short: "VIGIL CLI - AI Runtime Governance and Utility System",
		Long:  `A command line tool for Vigil: install the Claude Code hook, seed the graph, and verify the audit chain.`,
	}

	rootCmd.AddCommand(auditCmd())
	rootCmd.AddCommand(graphSeedCmd())
	rootCmd.AddCommand(hookCmd())
	rootCmd.AddCommand(initCmd())
	rootCmd.AddCommand(checkQueriesCmd())
	rootCmd.AddCommand(exportLedgerCmd())
	rootCmd.AddCommand(verifyLedgerCmd())

	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
