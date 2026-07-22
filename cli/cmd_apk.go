package main

import (
	"archive/tar"
	"compress/gzip"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

var apkImage string

var apkCmd = &cobra.Command{
	Use:   "apk <app.apk|app.xapk>",
	Short: "Decompile an APK or XAPK locally and upload the result",
	Long: `Runs the bundled jadx-worker Docker image on your machine against the
given APK, then uploads both the APK and the decompiled source tree to your
OpenAPK account as a new project. Decompilation happens entirely on your
own hardware — cloud APK decompile is sunset (see openapk.ai).

Split-APK containers (.xapk / .apks) are handled as one app: the worker
unpacks the container and feeds every inner split (base + config.*) to
JADX in a single run, so dex and resources merge into one project instead
of the inner APKs landing in resources/ as opaque blobs.

Examples:
    openbin apk app-release.apk
    openbin apk com.vendor.app.xapk
    openbin apk --image openapk/jadx-worker:dev suspicious.apk
`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		// Best-effort "you're out of date" nudge after the run finishes.
		defer checkForUpdate()
		apkPath := args[0]
		info, err := os.Stat(apkPath)
		if err != nil {
			return fmt.Errorf("stat apk: %w", err)
		}
		if info.IsDir() {
			return errors.New("expected an APK file, got a directory")
		}

		cfg := loadConfig()

		// Login check up front — same rationale as `decompile`: don't let
		// the user wait out a long JADX run only to hit an auth error. The
		// token itself is re-resolved right before the upload.
		if _, err := ensureValidAccessToken(cfg); err != nil {
			return err
		}

		image := apkImage
		if image == "" {
			image = envOr("OPENAPK_JADX_IMAGE", jadxWorkerImage)
		}

		filename := filepath.Base(apkPath)
		kindLabel := ""
		if isSplitContainer(filename) {
			kindLabel = "split container, "
		}
		fmt.Printf("Decompiling %s (%s%.1f MB) locally with JADX...\n",
			filename, kindLabel, float64(info.Size())/(1024*1024))
		start := time.Now()
		treePath, err := runLocalJadx(apkPath, image)
		if err != nil {
			return err
		}
		defer os.Remove(treePath)
		fmt.Printf("Local decompile finished in %s. Uploading...\n",
			roundDuration(time.Since(start)))

		tokenLookup := func() (string, error) {
			tok, err := ensureValidAccessToken(cfg)
			if err != nil {
				return "", fmt.Errorf("refresh access token: %w", err)
			}
			return tok, nil
		}
		// Count native libs in the tree BEFORE upload — the temp tar is
		// removed when we return, and the scan is a cheap header walk.
		nativeLibs := countTreeNativeLibs(treePath)

		ir, err := uploadApkProject(cfg, tokenLookup, apkPath, treePath)
		if err != nil {
			return err
		}

		projectURL := ir.URL
		if projectURL == "" {
			projectURL = projectWebURL(cfg, projectKindApk, ir.ID)
		}
		fmt.Println("Done!", projectURL)
		if nativeLibs > 0 {
			fmt.Printf("This app ships %d native librar%s — open the project's Native tab to decompile them with Ghidra.\n",
				nativeLibs, pluralIes(nativeLibs))
		}
		return nil
	},
}

// isSplitContainer reports whether the filename looks like a split-APK
// container. Detection proper happens by content in the worker; this only
// picks the progress-line label.
func isSplitContainer(filename string) bool {
	lower := strings.ToLower(filename)
	return strings.HasSuffix(lower, ".xapk") || strings.HasSuffix(lower, ".apks")
}

// countTreeNativeLibs walks the decompiled-tree tar.gz headers and counts
// resources/lib/<abi>/*.so entries — the libs the Native tab will offer to
// analyze. Never fails the run: a scan error just returns 0.
func countTreeNativeLibs(treePath string) int {
	f, err := os.Open(treePath)
	if err != nil {
		return 0
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return 0
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	count := 0
	for {
		hdr, err := tr.Next()
		if err != nil {
			return count // io.EOF or corrupt tail — report what we saw
		}
		name := strings.TrimPrefix(hdr.Name, "./")
		if hdr.Typeflag == tar.TypeReg &&
			strings.HasPrefix(name, "resources/lib/") &&
			strings.HasSuffix(name, ".so") {
			count++
		}
	}
}

func pluralIes(n int) string {
	if n == 1 {
		return "y"
	}
	return "ies"
}

func init() {
	apkCmd.Flags().StringVar(&apkImage, "image", "",
		"override the jadx-worker Docker image (default: built-in)")
	rootCmd.AddCommand(apkCmd)
}
