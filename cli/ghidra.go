package main

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// runLocalGhidra pulls (if needed) the ghidra-worker image, starts it locally
// on a free port, POSTs the binary, captures the JSON response, and tears
// the container down. Returns the raw worker JSON ready to forward to the
// backend ingest endpoint.
//
// The image is the same one the cloud Ghidra worker uses — running it
// locally guarantees byte-identical decompile output to whatever the cloud
// pipeline would have produced, so the backend's ingest path doesn't need
// to discriminate between client- and worker-sourced submissions.
func runLocalGhidra(binaryPath, arch, image string) ([]byte, error) {
	if err := ensureDockerImage(image, ghidraImageTarball); err != nil {
		return nil, err
	}
	port, err := findFreePort()
	if err != nil {
		return nil, fmt.Errorf("allocate port: %w", err)
	}

	containerID, err := startContainer(image, port)
	if err != nil {
		return nil, err
	}
	defer stopContainer(containerID) // best-effort cleanup; ignore errors

	// Stream the worker's stdout/stderr to the user's terminal in the
	// background, plus a wall-clock heartbeat. Ghidra can go quiet for
	// minutes between analysis phases; without these the CLI looks frozen.
	streamCtx, cancelStream := context.WithCancel(context.Background())
	defer cancelStream()
	var streamWG sync.WaitGroup
	streamWG.Add(2)
	go func() { defer streamWG.Done(); streamContainerLogs(streamCtx, containerID, "[ghidra] ") }()
	go func() { defer streamWG.Done(); heartbeat(streamCtx, "decompile") }()

	if err := waitForHealth(port, 60*time.Second); err != nil {
		// On a health failure, dump the container logs so the user has
		// something to file a bug with instead of "it didn't work".
		dumpContainerLogs(containerID, "ghidra-worker")
		return nil, err
	}

	body, err := postBinary(port, binaryPath, arch)
	cancelStream()
	streamWG.Wait()
	if err != nil {
		dumpContainerLogs(containerID, "ghidra-worker")
		return nil, err
	}
	return body, nil
}

// streamContainerLogs pipes the worker's stdout/stderr to the CLI user's
// terminal so they can see what Ghidra is doing in real time. Lines are
// prefixed `[ghidra] ` to disambiguate them from the CLI's own messages.
// Exits when ctx is cancelled (which happens once the worker call returns
// or the run is otherwise torn down).
func streamContainerLogs(ctx context.Context, containerID, prefix string) {
	cmd := exec.CommandContext(ctx, "docker", "logs", "-f", "--tail", "0", containerID)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return
	}
	if err := cmd.Start(); err != nil {
		return
	}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); pipePrefixed(stdout, prefix) }()
	go func() { defer wg.Done(); pipePrefixed(stderr, prefix) }()
	wg.Wait()
	_ = cmd.Wait()
}

// heartbeat prints an elapsed-time tick every 30s so the user knows the
// CLI hasn't hung even during the long Ghidra phases that produce no
// container log output (stripped-symbol analysis can go silent for 5+ min).
func heartbeat(ctx context.Context, label string) {
	start := time.Now()
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			fmt.Fprintf(os.Stderr, "[%s] still working (%s elapsed)\n",
				label, time.Since(start).Round(time.Second))
		}
	}
}

func pipePrefixed(r io.ReadCloser, prefix string) {
	defer r.Close()
	scanner := bufio.NewScanner(r)
	// Buffer up to 1 MiB per line — Ghidra occasionally emits huge stack
	// traces that overflow the default 64 KiB scanner buffer and would
	// otherwise crash the goroutine mid-stream.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		fmt.Fprintln(os.Stderr, prefix+scanner.Text())
	}
}

// ensureDockerImage makes sure the local Docker daemon has the worker image
// loaded. Resolution order:
//   1. Image already loaded (cheap inspect; common after first run).
//   2. The named tarball (ghidra-worker.tar.gz / jadx-worker.tar.gz) found
//      next to the CLI binary, in the XDG cache dir, or the cwd — `docker
//      load` it. Covers offline installs and the fully-bundled release.
//   3. Lazy download: fetch the tarball from the latest GitHub release into
//      the XDG cache dir, then load it. The slim installer ships only the
//      binary, so this is the common first-run path. The cached tarball
//      makes every subsequent run an offline (2) hit.
//
// No `docker pull` and no registry auth — the image ships as a release asset
// and the CLI `docker load`s it.
func ensureDockerImage(image, tarballName string) error {
	if dockerImageExists(image) {
		return nil
	}
	if tarball, ok := findBundledImageTarball(tarballName); ok {
		return loadImageTarball(image, tarball, "Loading worker image from "+tarball+" (first run only)...")
	}
	dest := filepath.Join(xdgDataHome(), "openbin", tarballName)
	if err := downloadWorkerImage(tarballName, dest); err != nil {
		return fmt.Errorf("worker image %q not available locally and download failed: %w\n"+
			"You can also drop %s next to the openbin binary or in %s to install it offline.",
			image, err, tarballName, filepath.Dir(dest))
	}
	return loadImageTarball(image, dest, "Loading worker image (first run only)...")
}

// loadImageTarball docker-loads a tarball and confirms the expected tag
// materialized. Shared by the bundled and downloaded paths.
func loadImageTarball(image, tarball, msg string) error {
	fmt.Fprintln(os.Stderr, msg)
	if err := dockerLoad(tarball); err != nil {
		return fmt.Errorf("docker load %s: %w", tarball, err)
	}
	if !dockerImageExists(image) {
		return fmt.Errorf("loaded %s but image %q still not found; report this to the maintainers",
			tarball, image)
	}
	return nil
}

func dockerImageExists(image string) bool {
	return exec.Command("docker", "image", "inspect", image).Run() == nil
}

func dockerLoad(tarball string) error {
	cmd := exec.Command("docker", "load", "-i", tarball)
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// findBundledImageTarball searches the standard install locations for the
// named worker image tarball. Resolution order, first match wins:
//   1. Next to the executable (the extracted-release layout, and the case
//      where a symlinked binary's target dir contains the tarball).
//   2. $XDG_DATA_HOME/openbin/ (~/.local/share/openbin/ when XDG_DATA_HOME
//      is unset) — where a PATH install puts shared assets per XDG.
//   3. /usr/local/share/openbin/ — the system-wide install location.
//   4. The current working directory — last-resort, lets users drop
//      both the binary and the tarball into any folder and `cd` in.
//
// The executable's path is fully resolved (symlinks followed) so an
// `ln -s ~/.local/share/openbin/openbin ~/.local/bin/openbin` style install
// finds the tarball next to the real file, not next to the symlink.
func findBundledImageTarball(tarballName string) (string, bool) {
	var candidates []string

	if exe, err := os.Executable(); err == nil {
		// EvalSymlinks may fail on Windows for paths containing reparse
		// points; fall back to the raw path in that case.
		resolved := exe
		if real, err := filepath.EvalSymlinks(exe); err == nil {
			resolved = real
		}
		candidates = append(candidates, filepath.Join(filepath.Dir(resolved), tarballName))
	}

	candidates = append(candidates, filepath.Join(xdgDataHome(), "openbin", tarballName))
	candidates = append(candidates, filepath.Join("/usr/local/share/openbin", tarballName))

	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(cwd, tarballName))
	}

	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c, true
		}
		// Any stat error (missing, permissions, etc.) — just try the next
		// candidate; a real "image not loadable" message lands at the
		// caller if none of them work.
	}
	return "", false
}

// xdgDataHome returns $XDG_DATA_HOME with the XDG-spec fallback to
// ~/.local/share. Mirrors how config.go resolves XDG_CONFIG_HOME, kept
// inline here so ghidra.go can stand on its own without a shared util file.
func xdgDataHome() string {
	if v := os.Getenv("XDG_DATA_HOME"); v != "" {
		return v
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".local", "share")
	}
	return ""
}

func findFreePort() (int, error) {
	// :0 → kernel picks a free port; we close immediately and reuse the
	// number for the container's -p mapping. There's a tiny TOCTOU window
	// where the port could be grabbed by another process between the
	// Listen here and the docker run below — acceptable for a single-user
	// CLI on the user's own laptop.
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func startContainer(image string, port int) (string, error) {
	// Note: we intentionally do NOT pass --rm. When Ghidra dies mid-request
	// (cgroup OOM, JVM crash, hang) we need the container to STAY around
	// long enough to grab `docker logs` + `docker inspect` post-mortem.
	// Cleanup is done by stopContainer() (defer in runLocalGhidra), which
	// removes the container after we've persisted its logs.
	cmd := exec.Command("docker", "run", "-d",
		"-p", fmt.Sprintf("127.0.0.1:%d:8000", port),
		image,
	)
	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("docker run failed: %s", strings.TrimSpace(string(ee.Stderr)))
		}
		return "", fmt.Errorf("docker run: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

// stopContainer best-effort tears the container down. Runs after
// dumpContainerLogs (defer order: LIFO) so logs are persisted before the
// container is removed.
func stopContainer(id string) {
	if id == "" {
		return
	}
	_ = exec.Command("docker", "stop", id).Run()
	_ = exec.Command("docker", "rm", "-f", id).Run()
}

// dumpContainerLogs persists the entire stdout+stderr of the container
// to a tempfile + prints the path. Also runs `docker inspect` to extract
// the post-mortem fields most useful for diagnosing why Ghidra died:
//   - State.OOMKilled  — true when cgroup-OOM'd
//   - State.ExitCode   — distinguishes clean exit from a kill signal
//   - State.Error      — Docker's own error message, if any
//   - State.FinishedAt — when it died (helps correlate with system events)
//
// Called on any worker-call failure (mid-stream EOF, non-2xx, timeout) so
// the user has actionable evidence to paste back.
func dumpContainerLogs(id, label string) {
	if id == "" {
		return
	}
	// 1. Container state via inspect. The four fields above are extracted
	//    with --format; the full inspect output is too verbose to dump.
	inspectFmt := `{{"OOMKilled="}}{{.State.OOMKilled}}{{"\n"}}` +
		`{{"ExitCode="}}{{.State.ExitCode}}{{"\n"}}` +
		`{{"Error="}}{{.State.Error}}{{"\n"}}` +
		`{{"FinishedAt="}}{{.State.FinishedAt}}{{"\n"}}`
	insOut, _ := exec.Command("docker", "inspect", "--format", inspectFmt, id).CombinedOutput()

	// 2. Full container logs to a tempfile so we don't drown the user's
	//    terminal in 5000 lines of Ghidra analyzer output. The path is
	//    printed at the bottom so they can `less` / paste it.
	tmpLog, err := os.CreateTemp("", "openbin-"+label+"-*.log")
	if err != nil {
		// Fall back to last-100-lines on stderr if tempfile creation fails.
		out, _ := exec.Command("docker", "logs", "--tail", "100", id).CombinedOutput()
		fmt.Fprintln(os.Stderr, "---- "+label+" logs (last 100 lines; tempfile failed) ----")
		fmt.Fprintln(os.Stderr, string(out))
		fmt.Fprintln(os.Stderr, "--------------------------------------------------------------")
		return
	}
	defer tmpLog.Close()
	// `docker logs` separates stdout/stderr; we combine via CombinedOutput
	// so the file matches what the user would see if they ran `docker logs`
	// themselves. No --tail — we want the whole thing.
	logsCmd := exec.Command("docker", "logs", id)
	logsCmd.Stdout = tmpLog
	logsCmd.Stderr = tmpLog
	_ = logsCmd.Run()

	fmt.Fprintln(os.Stderr, "")
	fmt.Fprintln(os.Stderr, "---- "+label+" post-mortem ----")
	fmt.Fprint(os.Stderr, string(insOut))
	fmt.Fprintln(os.Stderr, "full logs saved to: "+tmpLog.Name())
	fmt.Fprintln(os.Stderr, "  paste with:  cat "+tmpLog.Name())
	fmt.Fprintln(os.Stderr, "-----------------------------------")
}

func waitForHealth(port int, timeout time.Duration) error {
	url := fmt.Sprintf("http://127.0.0.1:%d/health", port)
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := http.Get(url)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				return nil
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("ghidra-worker did not become healthy within %s", timeout)
}

func postBinary(port int, path, arch string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open binary: %w", err)
	}
	defer f.Close()

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if err := mw.WriteField("arch", arch); err != nil {
		return nil, err
	}
	part, err := mw.CreateFormFile("binary", filenameOnly(path))
	if err != nil {
		return nil, err
	}
	if _, err := io.Copy(part, f); err != nil {
		return nil, fmt.Errorf("read binary: %w", err)
	}
	if err := mw.Close(); err != nil {
		return nil, err
	}

	req, _ := http.NewRequest("POST", fmt.Sprintf("http://127.0.0.1:%d/analyze", port), &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Accept", "application/json")

	// Ghidra can take 15+ minutes on a stripped library. The worker has its
	// own subprocess timeout (default 25m); we go a touch higher so we don't
	// kill the request just as the worker is finalizing the JSON write.
	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("worker /analyze: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read worker response: %w", err)
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("worker /analyze returned %d: %s",
			resp.StatusCode, abbreviate(string(body), 500))
	}
	return body, nil
}

func filenameOnly(p string) string {
	if i := strings.LastIndexAny(p, `/\`); i >= 0 {
		return p[i+1:]
	}
	return p
}
