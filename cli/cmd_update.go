package main

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

// `openbin update` self-replaces the running binary with the latest release.
// It downloads the same slim per-platform tarball the install.sh one-liner
// uses (openbin-<os>-<arch>.tar.gz from releases/latest/download) and renames
// the new binary over the current executable. No curl/tar dependency, no
// registry — pure Go + the stable GitHub "latest" asset URL.
//
// Note: this updates the CLI binary. The heavy worker Docker images are
// versioned separately (see ghidraWorkerImage); the next decompile after an
// update pulls a newer worker automatically if its pinned tag changed.
var updateCmd = &cobra.Command{
	Use:   "update",
	Short: "Update the openbin CLI to the latest release",
	Long: `Downloads the latest openbin release and replaces the current binary
in place — the same thing re-running the install one-liner does, but without
needing to remember it:

    openbin update

If a newer worker image is required for new features, the next
` + "`openbin decompile`" + ` / ` + "`openbin apk`" + ` run pulls it automatically.`,
	Args: cobra.NoArgs,
	RunE: func(_ *cobra.Command, _ []string) error {
		return selfUpdate()
	},
}

func init() {
	rootCmd.AddCommand(updateCmd)
}

func selfUpdate() error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate current executable: %w", err)
	}
	// Resolve symlinks so we replace the real file (e.g. a Homebrew/symlinked
	// install), not the link.
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}

	asset := fmt.Sprintf("openbin-%s-%s.tar.gz", runtime.GOOS, runtime.GOARCH)
	url := releaseBase() + "/" + asset

	// Report what we're moving from -> to, when discoverable.
	if latest, ok := latestReleaseVersion(5 * time.Second); ok && latest != "" {
		if latest == version {
			fmt.Printf("Already on the latest release (%s).\n", version)
			return nil
		}
		fmt.Printf("Updating openbin %s -> %s ...\n", version, latest)
	} else {
		fmt.Println("Updating openbin to the latest release ...")
	}

	client := &http.Client{Timeout: 10 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return fmt.Errorf("download %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("download %s returned %d (is there a published release?)", url, resp.StatusCode)
	}

	gz, err := gzip.NewReader(resp.Body)
	if err != nil {
		return fmt.Errorf("gunzip release: %w", err)
	}
	defer gz.Close()

	// Stage the new binary next to the current one so the final rename is an
	// atomic same-filesystem swap (no EXDEV), and a partial download never
	// clobbers a working binary.
	dir := filepath.Dir(exe)
	tmp, err := os.CreateTemp(dir, ".openbin-update-*")
	if err != nil {
		return fmt.Errorf("create staging file in %s: %w (no write permission? re-run the install one-liner)", dir, err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op after a successful rename

	tr := tar.NewReader(gz)
	found := false
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			tmp.Close()
			return fmt.Errorf("read release tarball: %w", err)
		}
		if hdr.Typeflag == tar.TypeReg && filepath.Base(hdr.Name) == "openbin" {
			// 200 MB ceiling guards against a malformed/huge entry.
			if _, err := io.Copy(tmp, io.LimitReader(tr, 200<<20)); err != nil {
				tmp.Close()
				return fmt.Errorf("extract new binary: %w", err)
			}
			found = true
			break
		}
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("release tarball %s did not contain an openbin binary", asset)
	}
	if err := os.Chmod(tmpName, 0o755); err != nil {
		return fmt.Errorf("chmod new binary: %w", err)
	}
	if err := os.Rename(tmpName, exe); err != nil {
		return fmt.Errorf("replace %s: %w (check write permission on that directory)", exe, err)
	}

	fmt.Printf("Updated openbin at %s\n", exe)
	if v, ok := latestReleaseVersion(5 * time.Second); ok && v != "" {
		fmt.Printf("Now on %s. Run `openbin --version` to confirm.\n", v)
	}
	return nil
}

// latestReleaseVersion fetches the tiny VERSION marker the release workflow
// publishes (releases/latest/download/VERSION). Returns the release version
// string and ok=false on any error / non-200 / empty body. Bounded by the
// caller's timeout so it never hangs a command.
func latestReleaseVersion(timeout time.Duration) (string, bool) {
	client := &http.Client{Timeout: timeout}
	resp, err := client.Get(releaseBase() + "/VERSION")
	if err != nil || resp.StatusCode != 200 {
		if resp != nil {
			resp.Body.Close()
		}
		return "", false
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 256))
	if err != nil {
		return "", false
	}
	v := strings.TrimSpace(string(b))
	if v == "" {
		return "", false
	}
	return v, true
}

// checkForUpdate prints a one-line nudge to stderr when a newer release is
// available. Best-effort and non-fatal: silent on dev builds, offline, or any
// error. Called at the end of the long-running commands (decompile / apk) so
// the ~2s probe never delays the actual work.
func checkForUpdate() {
	if version == "dev" || version == "" {
		return
	}
	latest, ok := latestReleaseVersion(2 * time.Second)
	if !ok || latest == version {
		return
	}
	fmt.Fprintf(os.Stderr,
		"\n\033[33m==>\033[0m A newer openbin is available: %s (you have %s).\n"+
			"    Run \033[36mopenbin update\033[0m to get the latest features.\n",
		latest, version)
}
