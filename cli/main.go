package main

import (
	"fmt"
	"os"
)

func main() {
	// Clear any ".old" binary a prior Windows self-update left behind (the
	// running exe couldn't be deleted at update time). No-op off Windows.
	cleanupStaleUpdate()
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}
