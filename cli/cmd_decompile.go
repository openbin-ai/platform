package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"
)

var (
	decompileArch    string
	decompileName    string
	decompileImage   string
	decompileFork    bool
	decompileNoDedup bool
)

var decompileCmd = &cobra.Command{
	Use:   "decompile <binary>",
	Short: "Decompile a native binary locally and upload the result",
	Long: `Pulls the Ghidra worker Docker image, runs it on your machine against
the given binary, and POSTs the decompiled JSON to your OpenBin account
as a new project. The binary bytes never leave your laptop — only the
decompiled JSON (function listings, strings, imports, metadata) is uploaded.

Examples:
    openbin decompile firmware.elf
    openbin decompile --arch x86_64 windows-malware.exe
    openbin decompile --name "Acme Firmware v2.3" fw.bin
`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		// Best-effort "you're out of date" nudge after the run finishes.
		defer checkForUpdate()
		binaryPath := args[0]
		info, err := os.Stat(binaryPath)
		if err != nil {
			return fmt.Errorf("stat binary: %w", err)
		}
		if info.IsDir() {
			return errors.New("expected a binary file, got a directory")
		}

		cfg := loadConfig()

		// Verify the user is logged in BEFORE the long Ghidra run so they
		// don't waste 20 minutes only to discover they're not authenticated.
		// We deliberately throw the token away here — Ghidra can run for
		// 30+ minutes and the access token's lifetime (5–15 min typically)
		// won't survive that. A fresh ensureValidAccessToken() right before
		// the upload below picks up a refreshed token from the on-disk
		// credentials file.
		if _, err := ensureValidAccessToken(cfg); err != nil {
			return err
		}

		filename := filepath.Base(binaryPath)
		name := decompileName
		if name == "" {
			name = filename
		}
		arch := decompileArch
		if arch == "" {
			arch = "auto"
		}
		image := decompileImage
		if image == "" {
			image = envOr("OPENBIN_GHIDRA_IMAGE", ghidraWorkerImage)
		}

		// Hash before the long decompile — failures here are quick to surface
		// (typically file not readable) and the digest gets shipped alongside
		// the result so the backend can dedupe / audit uploads.
		fmt.Println("Hashing...")
		sha, size, err := fileSha256(binaryPath)
		if err != nil {
			return err
		}

		// Token resolver, shared by the dedup check + both ingest calls. It's
		// re-invoked before each backend hit because a slow decompile or S3
		// PUT can outlast a 5-min access token.
		tokenLookup := func() (string, error) {
			tok, err := ensureValidAccessToken(cfg)
			if err != nil {
				return "", fmt.Errorf("refresh access token: %w", err)
			}
			return tok, nil
		}

		// Pre-decompile hash dedup (Slice 7): if a public analysis of this
		// exact binary already exists, offer to fork it over its shared
		// analysis blob instead of burning minutes on a local Ghidra run.
		// --no-dedup skips the check; --fork auto-takes the top match without
		// prompting (handy in scripts). Any failure falls through to decompiling.
		if !decompileNoDedup {
			if forkURL := offerForkOnDedup(cfg, tokenLookup, sha, decompileFork); forkURL != "" {
				fmt.Println("Done!", forkURL)
				return nil
			}
		}

		fmt.Printf("Decompiling %s (%.1f MB, sha256=%s) locally...\n",
			filename, float64(size)/(1024*1024), sha[:12])
		start := time.Now()
		workerJSON, err := runLocalGhidra(binaryPath, arch, image)
		if err != nil {
			return err
		}
		fmt.Printf("Local decompile finished in %s. Uploading...\n",
			roundDuration(time.Since(start)))

		// Schema-2.0 ingest: gzip the worker JSON, POST /initiate to get a
		// presigned S3 PUT URL, stream the gzip to S3 directly, POST
		// /finalize. The body never crosses our backend.
		ir, err := ingestProjectV2(cfg, tokenLookup, name, filename, arch, sha, size, workerJSON)
		if err != nil {
			return err
		}

		// Trim any trailing slash; prefer the backend-supplied URL when present.
		projectURL := ir.URL
		if projectURL == "" {
			projectURL = projectWebURL(cfg, projectKindBin, ir.ID)
		}
		fmt.Println("Done!", projectURL)
		return nil
	},
}

func init() {
	decompileCmd.Flags().StringVar(&decompileArch, "arch", "",
		"architecture hint (auto|x86_64|x86|arm64|arm); default auto")
	decompileCmd.Flags().StringVar(&decompileName, "name", "",
		"project display name (default: binary filename)")
	decompileCmd.Flags().StringVar(&decompileImage, "image", "",
		"override the ghidra-worker Docker image (default: built-in)")
	decompileCmd.Flags().BoolVar(&decompileFork, "fork", false,
		"if a public analysis of this binary already exists, fork it instead of decompiling (no prompt)")
	decompileCmd.Flags().BoolVar(&decompileNoDedup, "no-dedup", false,
		"skip the pre-decompile hash-dedup check and always decompile locally")
	rootCmd.AddCommand(decompileCmd)
}

// roundDuration trims fractional seconds for friendlier output.
func roundDuration(d time.Duration) time.Duration {
	switch {
	case d < time.Second:
		return d.Round(time.Millisecond)
	case d < time.Minute:
		return d.Round(time.Second)
	default:
		return d.Round(time.Second)
	}
}
