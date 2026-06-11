package main

import "github.com/spf13/cobra"

// version is overridden at build time via -ldflags "-X main.version=...".
// Defaults to "dev" for local builds. Surfaced through `openbin --version`.
var version = "dev"

var rootCmd = &cobra.Command{
	Use:     "openbin",
	Version: version,
	Short:   "OpenBin CLI — decompile native binaries locally, push results to the cloud",
	Long: `OpenBin CLI runs Ghidra on your own machine and POSTs the decompiled JSON
to your account on openbin.ai. Cloud compute is reserved for the shared
OpenAPK pipeline; native binary RE happens locally so you don't burn
credits and your sample never leaves your laptop.

Quick start:
    openbin login              # one-time auth via your browser
    openbin decompile foo.elf  # local Ghidra → uploads result → prints project URL

Override default endpoints via env vars:
    OPENBIN_API_URL    (default https://api.openapk.ai — shared backend)
    OPENBIN_AUTH_URL   (default https://auth.openapk.ai — shared Keycloak)
`,
	SilenceUsage:  true,
	SilenceErrors: true,
}
