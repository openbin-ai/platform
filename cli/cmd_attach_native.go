package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

var (
	attachNativeProjectID string
	attachNativeLibPath   string
	attachNativeArch      string
	attachNativeImage     string
)

// libPathRe mirrors the backend's InitiateNativeIngestRequest pattern —
// resources/lib/<abi>/<name>.so. Caught locally so a typo doesn't waste
// the user's Ghidra runtime.
var libPathRe = regexp.MustCompile(`^resources/lib/[^/]+/[^/]+\.so$`)

var attachNativeCmd = &cobra.Command{
	Use:   "attach-native <local.so>",
	Short: "Decompile a .so locally and attach the result to an OpenAPK project",
	Long: `Runs Ghidra on the supplied .so file and uploads the result to an
existing APK project's Native tab. Use this when the in-app "Decompile
this lib" button asks you to run the CLI — the OpenAPK UI gives you the
exact command, copy/paste, done.

Examples:
    openbin attach-native --project=8c12...e3 \
        --lib-path=resources/lib/arm64-v8a/libnative.so \
        ./libnative.so

    # OpenAPK pre-fills both flags in the modal; you typically just paste
    # the whole line.

Required flags:
    --project    UUID of the APK project to attach the result to.
    --lib-path   The .so's path inside the APK, of the form
                 resources/lib/<abi>/<name>.so. The OpenAPK UI shows this
                 next to the download link.
`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		// Best-effort "you're out of date" nudge after the run finishes.
		defer checkForUpdate()
		localPath := args[0]
		info, err := os.Stat(localPath)
		if err != nil {
			return fmt.Errorf("stat .so file: %w", err)
		}
		if info.IsDir() {
			return errors.New("expected a .so file, got a directory")
		}
		if attachNativeProjectID == "" {
			return errors.New("--project is required (UUID of the APK project)")
		}
		if attachNativeLibPath == "" {
			return errors.New("--lib-path is required (e.g. resources/lib/arm64-v8a/libnative.so)")
		}
		if !libPathRe.MatchString(attachNativeLibPath) {
			return fmt.Errorf("--lib-path must match resources/lib/<abi>/<name>.so; got %q",
				attachNativeLibPath)
		}

		cfg := loadConfig()

		// Pre-check auth before the long Ghidra run. Same rationale as in
		// `openbin decompile` — fail fast on logged-out state.
		if _, err := ensureValidAccessToken(cfg); err != nil {
			return err
		}

		filename := filepath.Base(localPath)
		arch := attachNativeArch
		if arch == "" {
			// .so files always carry their ABI in the OpenAPK lib path, so
			// derive a default hint from that instead of "auto" — Ghidra
			// usually figures it out anyway but the hint helps when the
			// file's headers are stripped.
			arch = inferArchFromLibPath(attachNativeLibPath)
			if arch == "" {
				arch = "auto"
			}
		}
		image := attachNativeImage
		if image == "" {
			image = envOr("OPENBIN_GHIDRA_IMAGE", ghidraWorkerImage)
		}

		fmt.Println("Hashing...")
		sha, size, err := fileSha256(localPath)
		if err != nil {
			return err
		}

		fmt.Printf("Decompiling %s (%.1f MB, sha256=%s) locally...\n",
			filename, float64(size)/(1024*1024), sha[:12])
		start := time.Now()
		workerJSON, err := runLocalGhidra(localPath, arch, image, workerLimits{})
		if err != nil {
			return err
		}
		fmt.Printf("Local decompile finished in %s. Uploading to OpenAPK...\n",
			roundDuration(time.Since(start)))

		tokenLookup := func() (string, error) {
			tok, err := ensureValidAccessToken(cfg)
			if err != nil {
				return "", fmt.Errorf("refresh access token: %w", err)
			}
			return tok, nil
		}
		_, err = ingestNativeLib(cfg, tokenLookup, attachNativeProjectID,
			attachNativeLibPath, arch, sha, size, workerJSON)
		if err != nil {
			return err
		}

		// attach-native always targets an APK project — link to its page
		// with the Native tab pre-selected.
		appURL := projectWebURL(cfg, projectKindApk, attachNativeProjectID) + "?tab=native"
		fmt.Println("Done!", appURL)
		return nil
	},
}

func init() {
	attachNativeCmd.Flags().StringVar(&attachNativeProjectID, "project", "",
		"UUID of the APK project to attach the result to (required)")
	attachNativeCmd.Flags().StringVar(&attachNativeLibPath, "lib-path", "",
		"path of the .so inside the APK (resources/lib/<abi>/<name>.so) (required)")
	attachNativeCmd.Flags().StringVar(&attachNativeArch, "arch", "",
		"architecture hint passed to Ghidra; defaults to the ABI in --lib-path")
	attachNativeCmd.Flags().StringVar(&attachNativeImage, "image", "",
		"override the ghidra-worker Docker image (default: built-in)")
	rootCmd.AddCommand(attachNativeCmd)
}

// inferArchFromLibPath maps an ABI directory name to the worker's arch hint.
// Returns "" when the ABI is unrecognized — caller falls back to "auto".
func inferArchFromLibPath(libPath string) string {
	parts := strings.Split(libPath, "/")
	if len(parts) < 3 {
		return ""
	}
	abi := parts[2]
	switch abi {
	case "arm64-v8a":
		return "arm64"
	case "armeabi-v7a":
		return "arm"
	case "x86":
		return "x86"
	case "x86_64":
		return "x86_64"
	default:
		return ""
	}
}
