package main

import "github.com/spf13/cobra"

var rootCmd = &cobra.Command{
	Use:   "openapk",
	Short: "OpenAPK CLI — run binary decompiles locally and push results to the cloud",
	Long: `OpenAPK CLI runs Ghidra on your own machine and POSTs the decompiled JSON
to your account on the OpenAPK web app. Cloud compute is reserved for APK
decompiles; native binary RE happens locally so you don't burn credits and
your sample never leaves your laptop.

Quick start:
    openapk login              # one-time auth via your browser
    openapk decompile foo.elf  # local Ghidra → uploads result → opens browser

Override default endpoints via env vars:
    OPENAPK_API_URL    (default http://localhost:8081)
    OPENAPK_AUTH_URL   (default http://localhost:8080)
`,
	SilenceUsage:  true,
	SilenceErrors: true,
}
