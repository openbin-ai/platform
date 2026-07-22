package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
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

	// Windows ships a .zip containing openbin.exe; Unix ships a .tar.gz
	// containing openbin. Pick the archive + inner binary name for the
	// running platform so `openbin update` self-replaces correctly on each.
	binName := "openbin"
	asset := fmt.Sprintf("openbin-%s-%s.tar.gz", runtime.GOOS, runtime.GOARCH)
	if runtime.GOOS == "windows" {
		binName = "openbin.exe"
		asset = fmt.Sprintf("openbin-%s-%s.zip", runtime.GOOS, runtime.GOARCH)
	}
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

	// Stage the new binary next to the current one so the final swap is an
	// atomic same-filesystem rename (no EXDEV), and a partial download never
	// clobbers a working binary.
	dir := filepath.Dir(exe)
	tmp, err := os.CreateTemp(dir, ".openbin-update-*")
	if err != nil {
		return fmt.Errorf("create staging file in %s: %w (no write permission? re-run the installer)", dir, err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op after a successful rename

	if runtime.GOOS == "windows" {
		err = extractZipBinary(resp.Body, binName, tmp)
	} else {
		err = extractTarGzBinary(resp.Body, binName, tmp)
	}
	tmp.Close()
	if err != nil {
		return err
	}
	if err := os.Chmod(tmpName, 0o755); err != nil {
		return fmt.Errorf("chmod new binary: %w", err)
	}

	if err := swapBinary(tmpName, exe); err != nil {
		return err
	}

	fmt.Printf("Updated openbin at %s\n", exe)
	if v, ok := latestReleaseVersion(5 * time.Second); ok && v != "" {
		fmt.Printf("Now on %s. Run `openbin --version` to confirm.\n", v)
	}
	return nil
}

// extractTarGzBinary streams a .tar.gz from r and copies the entry whose
// base name equals binName into dst. 200 MB ceiling guards a malformed entry.
func extractTarGzBinary(r io.Reader, binName string, dst io.Writer) error {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return fmt.Errorf("gunzip release: %w", err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("read release tarball: %w", err)
		}
		if hdr.Typeflag == tar.TypeReg && filepath.Base(hdr.Name) == binName {
			if _, err := io.Copy(dst, io.LimitReader(tr, 200<<20)); err != nil {
				return fmt.Errorf("extract new binary: %w", err)
			}
			return nil
		}
	}
	return fmt.Errorf("release archive did not contain a %s binary", binName)
}

// extractZipBinary reads a .zip (Windows release) and copies the entry whose
// base name equals binName into dst. zip.NewReader needs a ReaderAt+size, so
// the (small, ~10 MB) archive is buffered into memory first.
func extractZipBinary(r io.Reader, binName string, dst io.Writer) error {
	buf, err := io.ReadAll(io.LimitReader(r, 200<<20))
	if err != nil {
		return fmt.Errorf("read release zip: %w", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf), int64(len(buf)))
	if err != nil {
		return fmt.Errorf("open release zip: %w", err)
	}
	for _, f := range zr.File {
		if filepath.Base(f.Name) == binName {
			rc, err := f.Open()
			if err != nil {
				return fmt.Errorf("open %s in zip: %w", binName, err)
			}
			defer rc.Close()
			if _, err := io.Copy(dst, io.LimitReader(rc, 200<<20)); err != nil {
				return fmt.Errorf("extract new binary: %w", err)
			}
			return nil
		}
	}
	return fmt.Errorf("release archive did not contain a %s binary", binName)
}

// swapBinary replaces the running executable at exe with the freshly-staged
// binary at tmpName. On Unix a plain rename works even while the file is
// executing. On Windows the running .exe is locked and cannot be overwritten
// or renamed onto, so we first move the running file aside to a sibling
// ".old" name (permitted while it runs), then rename the new binary into
// place. The stale .old is cleaned up best-effort on the next launch.
func swapBinary(tmpName, exe string) error {
	if runtime.GOOS != "windows" {
		if err := os.Rename(tmpName, exe); err != nil {
			return fmt.Errorf("replace %s: %w (check write permission on that directory)", exe, err)
		}
		return nil
	}
	old := exe + ".old"
	_ = os.Remove(old) // clear any leftover from a previous update
	if err := os.Rename(exe, old); err != nil {
		return fmt.Errorf("move current binary aside: %w (close any other openbin process and retry)", err)
	}
	if err := os.Rename(tmpName, exe); err != nil {
		// Roll back so the user isn't left with no working binary.
		_ = os.Rename(old, exe)
		return fmt.Errorf("install new binary at %s: %w", exe, err)
	}
	return nil
}

// cleanupStaleUpdate removes the ".old" binary left behind by a Windows
// self-update (the previous exe couldn't be deleted while it was running).
// Best-effort and silent — called once at startup.
func cleanupStaleUpdate() {
	if runtime.GOOS != "windows" {
		return
	}
	if exe, err := os.Executable(); err == nil {
		_ = os.Remove(exe + ".old")
	}
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
