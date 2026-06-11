package main

import (
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"time"
)

// uploadApkProject POSTs the APK and its locally-decompiled tree to the
// standard project upload endpoint as one multipart request:
//
//	POST /api/projects   file=<apk> kind=APK decompiledTree=<tree.tar.gz>
//
// The decompiledTree part is what lets the upload through the cloud-JADX
// sunset gate — the backend skips the worker (and charges no quota slot)
// and runs its post-decompile pipeline against the supplied tree.
//
// Both parts are streamed from disk via io.Pipe; the combined body can be
// several hundred MB and never lives in memory. Retried once on 5xx /
// network error (the pipe is rebuilt per attempt); 4xx — including the 503
// sunset text if the backend somehow rejects the tree — is surfaced as-is.
func uploadApkProject(cfg config, tokenLookup func() (string, error),
	apkPath, treePath string) (*ingestResponse, error) {

	const maxAttempts = 2
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		token, err := tokenLookup()
		if err != nil {
			return nil, err
		}

		resp, err := doUploadAttempt(cfg.apiBase+"/api/projects", token, apkPath, treePath)
		if err == nil {
			return resp, nil
		}
		lastErr = err
		if !isRetryable(err) || attempt == maxAttempts {
			return nil, err
		}
		backoff := time.Duration(attempt) * 3 * time.Second
		fmt.Fprintf(os.Stderr, "  upload failed (attempt %d/%d): %v; retrying in %s\n",
			attempt, maxAttempts, err, backoff)
		time.Sleep(backoff)
	}
	return nil, lastErr
}

// retryableError marks transport-level / 5xx failures worth one more shot.
type retryableError struct{ err error }

func (r retryableError) Error() string { return r.err.Error() }
func (r retryableError) Unwrap() error { return r.err }

func isRetryable(err error) bool {
	_, ok := err.(retryableError)
	return ok
}

func doUploadAttempt(url, token, apkPath, treePath string) (*ingestResponse, error) {
	apk, err := os.Open(apkPath)
	if err != nil {
		return nil, fmt.Errorf("open apk: %w", err)
	}
	defer apk.Close()
	tree, err := os.Open(treePath)
	if err != nil {
		return nil, fmt.Errorf("open decompiled tree: %w", err)
	}
	defer tree.Close()

	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	go func() {
		writePart := func(field, filename string, r io.Reader) error {
			part, err := mw.CreateFormFile(field, filename)
			if err != nil {
				return err
			}
			_, err = io.Copy(part, r)
			return err
		}
		if err := mw.WriteField("kind", "APK"); err != nil {
			pw.CloseWithError(err)
			return
		}
		if err := writePart("file", filenameOnly(apkPath), apk); err != nil {
			pw.CloseWithError(fmt.Errorf("stream apk: %w", err))
			return
		}
		if err := writePart("decompiledTree", "decompiled-tree.tar.gz", tree); err != nil {
			pw.CloseWithError(fmt.Errorf("stream tree: %w", err))
			return
		}
		pw.CloseWithError(mw.Close())
	}()

	req, _ := http.NewRequest("POST", url, pr)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Accept", "application/json")

	// Big tree + slow uplink: a 300MB body on a 10 Mbps connection is ~4
	// minutes; give it plenty.
	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return nil, retryableError{fmt.Errorf("POST %s: %w", url, err)}
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 500 {
		return nil, retryableError{fmt.Errorf("status=%d body=%s",
			resp.StatusCode, abbreviate(string(body), 500))}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("status=%d body=%s", resp.StatusCode, abbreviate(string(body), 800))
	}

	var out ingestResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("parse upload response: %w (body: %s)",
			err, abbreviate(string(body), 300))
	}
	return &out, nil
}
