package main

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"
)

var (
	decompileArch            string
	decompileName            string
	decompileImage           string
	decompileFork            bool
	decompileNoDedup         bool
	decompileTimeout         int
	decompileAnalysisTimeout int
	decompileBundle          string
)

var decompileCmd = &cobra.Command{
	Use:   "decompile <binary | directory> [more binaries...]",
	Short: "Decompile native binaries locally and upload the result",
	Long: `Pulls the Ghidra worker Docker image, runs it on your machine against
the given binary, and POSTs the decompiled JSON to your OpenBin account
as a new project. The binary bytes never leave your laptop — only the
decompiled JSON (function listings, strings, imports, metadata) is uploaded.

Bundles (multiple binaries as one sample):
    Point decompile at a DIRECTORY, pass SEVERAL files, or add --bundle NAME to
    group the results under one bundle — one entry in your projects list that
    opens a repo-style overview of every binary inside it. Each file is still
    its own project (its own analysis, fork, publish), just grouped.

        openbin decompile ./evilminer-sample/     # sweep a folder → one bundle
        openbin decompile a.so b.so c.dll         # several files → one bundle
        openbin decompile --bundle evilminer x.so # append x.so to "evilminer"

    A directory sweep finds ELF / PE / Mach-O files by magic (skipping anything
    else), recursively, up to 100 files. The bundle is named after the folder
    unless you pass --bundle. Re-running the same command appends to the same
    bundle instead of duplicating it. Dedup/fork prompts are skipped in bundle
    mode so a sweep runs unattended.

Large binaries:
    The worker caps the whole run at 25 minutes (Ghidra auto-analysis + the
    decompile pass). On a very large or heavily-obfuscated binary the decompile
    pass may run out of that budget — when it does, the analysis is NOT lost:
    every function is still listed, and the ones that couldn't be decompiled in
    time are marked as stubs you can open on demand (a partial result instead of
    a failure). To give a huge binary more room, raise the cap:

        openbin decompile --timeout 3600 huge-miner.elf     # 60-minute wall

    --analysis-timeout tunes just the Ghidra auto-analysis phase and must stay
    below --timeout so the decompile pass keeps some of the budget.

Examples:
    openbin decompile firmware.elf
    openbin decompile --arch x86_64 windows-malware.exe
    openbin decompile --name "Acme Firmware v2.3" fw.bin
    openbin decompile --timeout 3600 --analysis-timeout 2400 big-stripped.so
`,
	Args: cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		// Best-effort "you're out of date" nudge after the run finishes.
		defer checkForUpdate()

		cfg := loadConfig()

		// Verify the user is logged in BEFORE the long Ghidra run so they
		// don't waste 20 minutes only to discover they're not authenticated.
		// The token is thrown away here — a 30-minute decompile outlives the
		// access token's lifetime; each backend hit refreshes via tokenLookup.
		if _, err := ensureValidAccessToken(cfg); err != nil {
			return err
		}

		// Optional timeout overrides for large binaries. Zero = worker default.
		if decompileAnalysisTimeout > 0 && decompileTimeout > 0 &&
			decompileAnalysisTimeout >= decompileTimeout {
			return fmt.Errorf("--analysis-timeout (%ds) must be less than --timeout (%ds)",
				decompileAnalysisTimeout, decompileTimeout)
		}
		limits := workerLimits{
			AnalyzeTimeoutSec: decompileTimeout,
			PerFileTimeoutSec: decompileAnalysisTimeout,
		}

		arch := decompileArch
		if arch == "" {
			arch = "auto"
		}
		image := decompileImage
		if image == "" {
			image = envOr("OPENBIN_GHIDRA_IMAGE", ghidraWorkerImage)
		}

		tokenLookup := func() (string, error) {
			tok, err := ensureValidAccessToken(cfg)
			if err != nil {
				return "", fmt.Errorf("refresh access token: %w", err)
			}
			return tok, nil
		}

		// Resolve the file list + whether this is a bundle run.
		files, bundleName, err := resolveDecompileTargets(args)
		if err != nil {
			return err
		}

		// Standalone single-file decompile — the original behavior, unchanged.
		if len(files) == 1 && bundleName == "" {
			name := decompileName
			if name == "" {
				name = filepath.Base(files[0])
			}
			url, err := decompileOne(cfg, tokenLookup, files[0], name, arch, image, limits, "", true)
			if err != nil {
				return err
			}
			fmt.Println("Done!", url)
			return nil
		}

		// Bundle run: get-or-create the bundle, then decompile each file into
		// it. --name applies a single name to every file, so it's rejected here
		// (each file keeps its own filename).
		if decompileName != "" {
			return fmt.Errorf("--name applies to a single project; omit it for a bundle (each file keeps its filename)")
		}
		bundleID, err := resolveBundleID(cfg, tokenLookup, bundleName)
		if err != nil {
			return err
		}
		fmt.Printf("Bundle %q — %d binar%s to decompile.\n",
			bundleName, len(files), plural(int64(len(files)), "y", "ies"))

		var okCount int
		var failed []string
		for i, f := range files {
			fmt.Printf("\n[%d/%d] %s\n", i+1, len(files), filepath.Base(f))
			url, err := decompileOne(cfg, tokenLookup, f, filepath.Base(f), arch, image, limits, bundleID, false)
			if err != nil {
				// Continue the sweep — one bad binary shouldn't abort the rest.
				fmt.Fprintf(os.Stderr, "  failed: %v\n", err)
				failed = append(failed, filepath.Base(f))
				continue
			}
			okCount++
			fmt.Println("  ok:", url)
		}

		fmt.Printf("\nBundle done: %d/%d succeeded", okCount, len(files))
		if len(failed) > 0 {
			fmt.Printf(" (failed: %v)", failed)
		}
		fmt.Println()
		fmt.Println("View bundle:", bundleWebURL(cfg, bundleID))
		if okCount == 0 {
			return fmt.Errorf("no binaries were ingested into the bundle")
		}
		return nil
	},
}

// resolveDecompileTargets turns the CLI args into a concrete file list plus the
// bundle name to group them under (empty = standalone single file). Rules:
//   - one directory arg          → sweep it; bundle name = --bundle or basename
//   - one file arg, no --bundle  → standalone (bundleName "")
//   - one file arg, --bundle set → that file joins the named bundle
//   - multiple file args         → bundle; name = --bundle or parent-dir basename
func resolveDecompileTargets(args []string) (files []string, bundleName string, err error) {
	if len(args) == 1 {
		info, statErr := os.Stat(args[0])
		if statErr != nil {
			return nil, "", fmt.Errorf("stat %s: %w", args[0], statErr)
		}
		if info.IsDir() {
			swept, skipped, sweepErr := sweepBinaries(args[0])
			if sweepErr != nil {
				return nil, "", fmt.Errorf("scan %s: %w", args[0], sweepErr)
			}
			if len(swept) == 0 {
				return nil, "", fmt.Errorf("no ELF/PE/Mach-O binaries found under %s", args[0])
			}
			if skipped > 0 {
				fmt.Fprintf(os.Stderr,
					"note: %d binaries beyond the %d-file cap were skipped\n", skipped, maxBundleFiles)
			}
			name := decompileBundle
			if name == "" {
				name = dirBaseName(args[0])
			}
			return swept, name, nil
		}
		// Single file. Bundle only if --bundle was given.
		return []string{args[0]}, decompileBundle, nil
	}

	// Multiple args — every one must be a file.
	for _, a := range args {
		info, statErr := os.Stat(a)
		if statErr != nil {
			return nil, "", fmt.Errorf("stat %s: %w", a, statErr)
		}
		if info.IsDir() {
			return nil, "", fmt.Errorf("%s is a directory — pass a single directory to sweep it, or a list of files", a)
		}
		files = append(files, a)
	}
	name := decompileBundle
	if name == "" {
		name = dirBaseName(filepath.Dir(args[0]))
	}
	return files, name, nil
}

// decompileOne runs the full local-decompile → ingest flow for one binary and
// returns the finished project's URL. allowDedup enables the interactive
// pre-decompile fork offer; it's off in bundle mode so a sweep never blocks on
// a prompt. bundleID (may be "") tags the ingest.
func decompileOne(cfg config, tokenLookup func() (string, error),
	binaryPath, displayName, arch, image string, limits workerLimits,
	bundleID string, allowDedup bool) (string, error) {

	filename := filepath.Base(binaryPath)

	// Hash before the long decompile — failures here are quick to surface and
	// the digest ships alongside the result for dedup / audit.
	fmt.Println("Hashing...")
	sha, size, err := fileSha256(binaryPath)
	if err != nil {
		return "", err
	}

	// Pre-decompile hash dedup: if a public analysis of this exact binary
	// exists, offer to fork it instead of burning minutes locally. Skipped in
	// bundle mode (allowDedup=false) to keep sweeps non-interactive, and by
	// --no-dedup.
	if allowDedup && !decompileNoDedup {
		if forkURL := offerForkOnDedup(cfg, tokenLookup, sha, decompileFork); forkURL != "" {
			return forkURL, nil
		}
	}

	fmt.Printf("Decompiling %s (%.1f MB, sha256=%s) locally...\n",
		filename, float64(size)/(1024*1024), sha[:12])
	start := time.Now()
	workerJSON, err := runLocalGhidra(binaryPath, arch, image, limits)
	if err != nil {
		return "", err
	}
	fmt.Printf("Local decompile finished in %s. Uploading...\n",
		roundDuration(time.Since(start)))

	ir, err := ingestProjectV2(cfg, tokenLookup, displayName, filename, arch, sha, size, workerJSON, bundleID)
	if err != nil {
		return "", err
	}

	projectURL := ir.URL
	if projectURL == "" {
		projectURL = projectWebURL(cfg, projectKindBin, ir.ID)
	}
	return projectURL, nil
}

// dirBaseName returns a friendly bundle name for a directory path, cleaning up
// "." and trailing slashes to something usable.
func dirBaseName(dir string) string {
	abs, err := filepath.Abs(dir)
	if err != nil {
		abs = dir
	}
	base := filepath.Base(filepath.Clean(abs))
	if base == "." || base == string(filepath.Separator) || base == "" {
		return "bundle"
	}
	return base
}

func init() {
	decompileCmd.Flags().StringVar(&decompileArch, "arch", "",
		"architecture hint (auto|x86_64|x86|arm64|arm); default auto")
	decompileCmd.Flags().StringVar(&decompileName, "name", "",
		"project display name (single-file only; default: binary filename)")
	decompileCmd.Flags().StringVar(&decompileImage, "image", "",
		"override the ghidra-worker Docker image (default: built-in)")
	decompileCmd.Flags().BoolVar(&decompileFork, "fork", false,
		"if a public analysis of this binary already exists, fork it instead of decompiling (no prompt)")
	decompileCmd.Flags().BoolVar(&decompileNoDedup, "no-dedup", false,
		"skip the pre-decompile hash-dedup check and always decompile locally")
	decompileCmd.Flags().IntVar(&decompileTimeout, "timeout", 0,
		"hard cap in seconds for the whole local decompile (default: worker built-in 1500s/25m). Raise for very large binaries.")
	decompileCmd.Flags().IntVar(&decompileAnalysisTimeout, "analysis-timeout", 0,
		"cap in seconds for Ghidra's auto-analysis phase (default: worker built-in 1200s/20m). Must be < --timeout.")
	decompileCmd.Flags().StringVar(&decompileBundle, "bundle", "",
		"group the result(s) into a bundle with this name or id (created if it doesn't exist)")
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
