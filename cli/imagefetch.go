package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// releaseDownloadBase is GitHub's stable "latest release" asset path: a GET
// to <base>/<asset> 302-redirects to whatever the newest release's asset is,
// so the CLI never needs the GitHub API (no token, no rate limit, no jq).
// Overridable for testing / self-hosted mirrors via OPENBIN_RELEASE_BASE.
const releaseDownloadBase = "https://github.com/openbin-ai/platform/releases/latest/download"

func releaseBase() string {
	if v := os.Getenv("OPENBIN_RELEASE_BASE"); v != "" {
		return v
	}
	return releaseDownloadBase
}

// downloadWorkerImage streams the named image tarball from the latest release
// into dest (creating parent dirs). dest lives under the same cache dir
// findBundledImageTarball() searches, so once downloaded the image loads
// offline on every subsequent run. Writes to a .part file and renames on
// success so an interrupted download never looks complete.
func downloadWorkerImage(tarballName, dest string) error {
	url := releaseBase() + "/" + tarballName
	fmt.Fprintf(os.Stderr,
		"Worker image not found locally — downloading %s from the latest release\n"+
			"(first run only; cached at %s for next time)...\n", tarballName, dest)

	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return fmt.Errorf("create cache dir: %w", err)
	}

	// Large asset (hundreds of MB); no short timeout. A stalled connection is
	// surfaced by the OS-level read eventually; 60m is a generous ceiling.
	client := &http.Client{Timeout: 60 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("GET %s returned %d (is there a published release with this asset?)",
			url, resp.StatusCode)
	}

	part := dest + ".part"
	out, err := os.Create(part)
	if err != nil {
		return fmt.Errorf("create %s: %w", part, err)
	}
	pr := &progressReader{r: resp.Body, total: resp.ContentLength, label: tarballName}
	if _, err := io.Copy(out, pr); err != nil {
		out.Close()
		os.Remove(part)
		return fmt.Errorf("download %s: %w", tarballName, err)
	}
	if err := out.Close(); err != nil {
		os.Remove(part)
		return err
	}
	if err := os.Rename(part, dest); err != nil {
		os.Remove(part)
		return fmt.Errorf("finalize %s: %w", dest, err)
	}
	fmt.Fprintln(os.Stderr) // newline after the progress line
	return nil
}

// progressReader prints a single rewriting progress line to stderr every
// ~32 MB so a 700 MB pull doesn't look hung. ContentLength may be -1 (chunked
// / unknown) in which case we just show bytes transferred.
type progressReader struct {
	r        io.Reader
	total    int64
	read     int64
	label    string
	lastTick int64
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	p.read += int64(n)
	if p.read-p.lastTick >= 32<<20 || (err == io.EOF && p.read > 0) {
		p.lastTick = p.read
		if p.total > 0 {
			fmt.Fprintf(os.Stderr, "\r  %s: %.0f / %.0f MB (%.0f%%)   ",
				p.label,
				float64(p.read)/(1<<20), float64(p.total)/(1<<20),
				float64(p.read)*100/float64(p.total))
		} else {
			fmt.Fprintf(os.Stderr, "\r  %s: %.0f MB   ", p.label, float64(p.read)/(1<<20))
		}
	}
	return n, err
}
