package main

import (
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"sync"
	"time"
)

// runLocalJadx loads (if needed) the bundled jadx-worker image, starts it
// locally on a free port, POSTs the APK to /decompile, and streams the
// tar.gz response to a temp file on disk. Returns the temp file path —
// caller owns deletion. Mirrors runLocalGhidra; the differences are the
// worker endpoint shape (multipart `apk` field, tar.gz response instead of
// JSON) and that the response can be hundreds of MB, so it never lives in
// memory.
func runLocalJadx(apkPath, image string) (string, error) {
	if err := ensureDockerImage(image, jadxImageTarball); err != nil {
		return "", err
	}
	port, err := findFreePort()
	if err != nil {
		return "", fmt.Errorf("allocate port: %w", err)
	}

	containerID, err := startContainer(image, port)
	if err != nil {
		return "", err
	}
	defer stopContainer(containerID)

	streamCtx, cancelStream := context.WithCancel(context.Background())
	defer cancelStream()
	var streamWG sync.WaitGroup
	streamWG.Add(2)
	go func() { defer streamWG.Done(); streamContainerLogs(streamCtx, containerID, "[jadx] ") }()
	go func() { defer streamWG.Done(); heartbeat(streamCtx, "decompile") }()

	if err := waitForHealth(port, 60*time.Second); err != nil {
		dumpContainerLogs(containerID, "jadx-worker")
		return "", err
	}

	outPath, err := postApk(port, apkPath)
	cancelStream()
	streamWG.Wait()
	if err != nil {
		dumpContainerLogs(containerID, "jadx-worker")
		return "", err
	}
	return outPath, nil
}

// postApk uploads the APK to the local worker and streams the tar.gz
// response to a temp file. The request body is also streamed (io.Pipe) —
// game APKs run to hundreds of MB and never need to be in memory.
func postApk(port int, apkPath string) (string, error) {
	f, err := os.Open(apkPath)
	if err != nil {
		return "", fmt.Errorf("open apk: %w", err)
	}
	defer f.Close()

	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	go func() {
		part, err := mw.CreateFormFile("apk", filenameOnly(apkPath))
		if err != nil {
			pw.CloseWithError(err)
			return
		}
		if _, err := io.Copy(part, f); err != nil {
			pw.CloseWithError(fmt.Errorf("read apk: %w", err))
			return
		}
		pw.CloseWithError(mw.Close())
	}()

	req, _ := http.NewRequest("POST", fmt.Sprintf("http://127.0.0.1:%d/decompile", port), pr)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Accept", "application/gzip, application/json")

	// The worker's own wall-clock cap is 15m (JADX_TIMEOUT_SEC); go a touch
	// higher so we don't kill the request as it finalizes the tar stream.
	client := &http.Client{Timeout: 20 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("worker /decompile: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
		return "", fmt.Errorf("worker /decompile returned %d: %s",
			resp.StatusCode, abbreviate(string(body), 500))
	}

	out, err := os.CreateTemp("", "openbin-jadx-tree-*.tar.gz")
	if err != nil {
		return "", fmt.Errorf("create temp file: %w", err)
	}
	if _, err := io.Copy(out, resp.Body); err != nil {
		out.Close()
		os.Remove(out.Name())
		return "", fmt.Errorf("stream decompile tree: %w", err)
	}
	if err := out.Close(); err != nil {
		os.Remove(out.Name())
		return "", err
	}
	return out.Name(), nil
}
