package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

var (
	decompileArch  string
	decompileName  string
	decompileImage string
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
		binaryPath := args[0]
		info, err := os.Stat(binaryPath)
		if err != nil {
			return fmt.Errorf("stat binary: %w", err)
		}
		if info.IsDir() {
			return errors.New("expected a binary file, got a directory")
		}

		cfg := loadConfig()

		// Resolve auth FIRST so the user finds out about a missing login
		// before the long Ghidra run, not after.
		token, err := ensureValidAccessToken(cfg)
		if err != nil {
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

		fmt.Printf("Decompiling %s (%.1f MB, sha256=%s) locally...\n",
			filename, float64(size)/(1024*1024), sha[:12])
		start := time.Now()
		workerJSON, err := runLocalGhidra(binaryPath, arch, image)
		if err != nil {
			return err
		}
		fmt.Printf("Local decompile finished in %s. Uploading...\n",
			roundDuration(time.Since(start)))

		ir, err := ingestProject(cfg, token, name, filename, arch, sha, size, workerJSON)
		if err != nil {
			return err
		}

		// Trim any trailing slash; prefer the backend-supplied URL when present.
		projectURL := ir.URL
		if projectURL == "" {
			projectURL = fmt.Sprintf("%s/projects/%s",
				strings.TrimRight(cfg.apiBase, "/"), ir.ID)
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
