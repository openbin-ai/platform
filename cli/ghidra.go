package main

import (
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
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
	if err := ensureDockerImage(image); err != nil {
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

	if err := waitForHealth(port, 60*time.Second); err != nil {
		// On a health failure, dump the container logs so the user has
		// something to file a bug with instead of "it didn't work".
		dumpContainerLogs(containerID)
		return nil, err
	}

	body, err := postBinary(port, binaryPath, arch)
	if err != nil {
		dumpContainerLogs(containerID)
		return nil, err
	}
	return body, nil
}

func ensureDockerImage(image string) error {
	// `docker image inspect` returns exit 0 when the image is present
	// locally, non-zero when it's missing. Cheaper than `docker pull` when
	// the image is already cached (skips the network round-trip).
	inspect := exec.Command("docker", "image", "inspect", image)
	if err := inspect.Run(); err == nil {
		return nil
	}
	fmt.Fprintln(os.Stderr, "Pulling Ghidra worker image (first run only; ~2GB)...")
	pull := exec.Command("docker", "pull", image)
	pull.Stdout = os.Stderr
	pull.Stderr = os.Stderr
	if err := pull.Run(); err != nil {
		return fmt.Errorf("docker pull %s: %w (have you `aws ecr get-login-password ... | docker login` ed?)",
			image, err)
	}
	return nil
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
	// --rm so a successful run cleans itself up; we still defer stopContainer
	// for the abnormal-exit case. -d detaches so we can poll /health.
	cmd := exec.Command("docker", "run", "-d", "--rm",
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

func stopContainer(id string) {
	if id == "" {
		return
	}
	_ = exec.Command("docker", "stop", id).Run()
}

func dumpContainerLogs(id string) {
	if id == "" {
		return
	}
	out, err := exec.Command("docker", "logs", "--tail", "50", id).CombinedOutput()
	if err == nil && len(out) > 0 {
		fmt.Fprintln(os.Stderr, "---- ghidra-worker logs (last 50 lines) ----")
		fmt.Fprintln(os.Stderr, string(out))
		fmt.Fprintln(os.Stderr, "--------------------------------------------")
	}
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
