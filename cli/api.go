package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// --- v2.0 S3 ingest -------------------------------------------------------
//
// Old flow (1.0): CLI POSTs the entire Ghidra worker JSON to /ingest as one
// application/json body. Backend buffers it, Jackson builds a JsonNode tree,
// heap grows 5-10x the payload size, Postgres gets a 100MB JSONB row.
//
// New flow (2.0): CLI gzips the JSON to disk, calls /ingest/initiate to mint
// a presigned S3 PUT URL, streams the gzipped file to S3 directly, then calls
// /ingest/finalize. Backend never holds the body in memory; Postgres stores
// only an S3 key + ETag + size.
//
// Retries:
//   - initiate/finalize: 3 attempts on 5xx / network error, exp backoff.
//   - S3 PUT: 3 attempts. The presigned URL is single-key/single-method but
//     reusable until its TTL, so a fresh PUT is safe.

type initiateRequest struct {
	Name             string `json:"name"`
	OriginalFilename string `json:"originalFilename"`
	ArchHint         string `json:"archHint,omitempty"`
	SizeBytes        int64  `json:"sizeBytes"`
	Sha256           string `json:"sha256"`
	SchemaVersion    string `json:"schemaVersion"`
	Source           string `json:"source"`
	UploadSizeBytes  int64  `json:"uploadSizeBytes"`
	// Optional bundle membership — set on sweep / --bundle runs. Empty for a
	// standalone decompile.
	BundleID string `json:"bundleId,omitempty"`
}

type initiateResponse struct {
	ProjectID        string            `json:"projectId"`
	UploadURL        string            `json:"uploadUrl"`
	UploadKey        string            `json:"uploadKey"`
	ExpiresInSeconds int               `json:"expiresInSeconds"`
	RequiredHeaders  map[string]string `json:"requiredHeaders"`
}

type finalizeRequest struct {
	ProjectID string `json:"projectId"`
}

// ingestResponse is the legacy + finalize response. Kept loose so the
// frontend URL field can evolve without breaking older CLIs.
type ingestResponse struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

// ingestProjectV2 runs the two-step S3 ingest. Steps:
//  1. gzip the worker JSON to a temp file (so we can stream it to S3
//     without holding it in memory twice the way bytes.NewReader did).
//  2. POST /ingest/initiate to mint a presigned PUT URL.
//  3. PUT the gzip to S3 with the headers the backend specified.
//  4. POST /ingest/finalize to confirm + extract metadata.
//
// All steps refresh the access token first — initiate + finalize hit the
// backend (Bearer required); the S3 PUT itself doesn't need our token.
func ingestProjectV2(cfg config, tokenLookup func() (string, error),
	name, filename, archHint, sha256Hex string, sizeBytes int64,
	workerJSON []byte, bundleID string) (*ingestResponse, error) {

	// 1. Gzip to a temp file. We use a file rather than an in-memory buffer
	//    because a 200MB worker JSON gzipped is still 20-40MB, and tee'ing
	//    it through net/http's request body works better from a file
	//    handle than from a bytes.Buffer (Content-Length is set
	//    automatically, no double-buffering inside the http client).
	tmpFile, err := os.CreateTemp("", "openbin-worker-*.json.gz")
	if err != nil {
		return nil, fmt.Errorf("create temp gz: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	gzWriter := gzip.NewWriter(tmpFile)
	if _, err := gzWriter.Write(workerJSON); err != nil {
		tmpFile.Close()
		return nil, fmt.Errorf("gzip worker json: %w", err)
	}
	if err := gzWriter.Close(); err != nil {
		tmpFile.Close()
		return nil, fmt.Errorf("flush gzip: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		return nil, fmt.Errorf("close gz tmpfile: %w", err)
	}
	gzInfo, err := os.Stat(tmpPath)
	if err != nil {
		return nil, fmt.Errorf("stat gz tmpfile: %w", err)
	}
	gzSize := gzInfo.Size()
	fmt.Fprintf(os.Stderr, "Compressed: %.2f MB → %.2f MB (%.0f%% of original)\n",
		float64(len(workerJSON))/(1024*1024),
		float64(gzSize)/(1024*1024),
		float64(gzSize)*100/float64(len(workerJSON)))

	// 2. /ingest/initiate
	token, err := tokenLookup()
	if err != nil {
		return nil, fmt.Errorf("pre-initiate auth: %w", err)
	}
	initReq := initiateRequest{
		Name:             name,
		OriginalFilename: filename,
		ArchHint:         archHint,
		SizeBytes:        sizeBytes,
		Sha256:           sha256Hex,
		SchemaVersion:    ingestSchemaVersion,
		Source:           "cli",
		UploadSizeBytes:  gzSize,
		BundleID:         bundleID,
	}
	initResp, err := postJSONRetry(cfg.apiBase+"/api/projects/ingest/initiate", token, initReq)
	if err != nil {
		return nil, fmt.Errorf("initiate: %w", err)
	}
	var ir initiateResponse
	if err := json.Unmarshal(initResp, &ir); err != nil {
		return nil, fmt.Errorf("parse initiate response: %w", err)
	}

	// 3. S3 PUT.
	if err := putToS3Retry(ir.UploadURL, tmpPath, gzSize, ir.RequiredHeaders); err != nil {
		return nil, fmt.Errorf("s3 upload: %w", err)
	}

	// 4. /ingest/finalize. Refresh token again — initiate + S3 PUT can
	//    take several minutes for big binaries, the original token may
	//    have rotated out.
	token, err = tokenLookup()
	if err != nil {
		return nil, fmt.Errorf("pre-finalize auth: %w", err)
	}
	finalizeBody, err := postJSONRetry(cfg.apiBase+"/api/projects/ingest/finalize",
		token, finalizeRequest{ProjectID: ir.ProjectID})
	if err != nil {
		return nil, fmt.Errorf("finalize: %w", err)
	}
	var resp ingestResponse
	if err := json.Unmarshal(finalizeBody, &resp); err != nil {
		return nil, fmt.Errorf("parse finalize response: %w", err)
	}
	return &resp, nil
}

// --- v2.0 native-lib ingest -----------------------------------------------
//
// Mirrors ingestProjectV2 but targets the per-(APK project, .so) endpoints
// on the NativeAnalysisController instead of the top-level BIN ingest path.
// The CLI flow is identical from S3's perspective: gzip → presigned PUT →
// finalize. Differences:
//   - Initiate URL: /api/projects/{apkId}/native/ingest/initiate
//   - Finalize URL: /api/projects/{apkId}/native/ingest/finalize
//   - Initiate body carries libPath + sha256 (no name/originalFilename)
//   - Finalize body carries nativeAnalysisId, NOT projectId

type initiateNativeRequest struct {
	SchemaVersion   string `json:"schemaVersion"`
	LibPath         string `json:"libPath"`
	Sha256          string `json:"sha256"`
	UploadSizeBytes int64  `json:"uploadSizeBytes"`
	ArchHint        string `json:"archHint,omitempty"`
}

type initiateNativeResponse struct {
	NativeAnalysisID string            `json:"nativeAnalysisId"`
	UploadURL        string            `json:"uploadUrl"`
	S3Key            string            `json:"s3Key"`
	ExpiresInSeconds int               `json:"expiresInSeconds"`
	RequiredHeaders  map[string]string `json:"requiredHeaders"`
}

type finalizeNativeRequest struct {
	NativeAnalysisID string `json:"nativeAnalysisId"`
}

// ingestNativeLib uploads a Ghidra worker JSON for a single .so to an
// existing APK project. Returns the native analysis id on success so the
// caller can print a URL the user can click back to the OpenAPK Native tab.
func ingestNativeLib(cfg config, tokenLookup func() (string, error),
	apkProjectID, libPath, archHint, sha256Hex string, sizeBytes int64,
	workerJSON []byte) (string, error) {

	tmpFile, err := os.CreateTemp("", "openbin-native-*.json.gz")
	if err != nil {
		return "", fmt.Errorf("create temp gz: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	gzWriter := gzip.NewWriter(tmpFile)
	if _, err := gzWriter.Write(workerJSON); err != nil {
		tmpFile.Close()
		return "", fmt.Errorf("gzip worker json: %w", err)
	}
	if err := gzWriter.Close(); err != nil {
		tmpFile.Close()
		return "", fmt.Errorf("flush gzip: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		return "", fmt.Errorf("close gz tmpfile: %w", err)
	}
	gzInfo, err := os.Stat(tmpPath)
	if err != nil {
		return "", fmt.Errorf("stat gz tmpfile: %w", err)
	}
	gzSize := gzInfo.Size()
	fmt.Fprintf(os.Stderr, "Compressed: %.2f MB → %.2f MB (%.0f%% of original)\n",
		float64(len(workerJSON))/(1024*1024),
		float64(gzSize)/(1024*1024),
		float64(gzSize)*100/float64(len(workerJSON)))
	_ = sizeBytes // currently unused — backend infers .so size from the workspace
	_ = sha256Hex // sha256 is currently informational on the native ingest side

	token, err := tokenLookup()
	if err != nil {
		return "", fmt.Errorf("pre-initiate auth: %w", err)
	}
	initReq := initiateNativeRequest{
		SchemaVersion:   ingestSchemaVersion,
		LibPath:         libPath,
		Sha256:          sha256Hex,
		UploadSizeBytes: gzSize,
		ArchHint:        archHint,
	}
	initURL := cfg.apiBase + "/api/projects/" + apkProjectID + "/native/ingest/initiate"
	initBody, err := postJSONRetry(initURL, token, initReq)
	if err != nil {
		return "", fmt.Errorf("initiate: %w", err)
	}
	var ir initiateNativeResponse
	if err := json.Unmarshal(initBody, &ir); err != nil {
		return "", fmt.Errorf("parse initiate response: %w", err)
	}

	if err := putToS3Retry(ir.UploadURL, tmpPath, gzSize, ir.RequiredHeaders); err != nil {
		return "", fmt.Errorf("s3 upload: %w", err)
	}

	token, err = tokenLookup()
	if err != nil {
		return "", fmt.Errorf("pre-finalize auth: %w", err)
	}
	finURL := cfg.apiBase + "/api/projects/" + apkProjectID + "/native/ingest/finalize"
	if _, err := postJSONRetry(finURL, token,
		finalizeNativeRequest{NativeAnalysisID: ir.NativeAnalysisID}); err != nil {
		return "", fmt.Errorf("finalize: %w", err)
	}
	return ir.NativeAnalysisID, nil
}

// postJSONRetry POSTs a JSON body with a Bearer token, retrying on 5xx /
// network errors. Returns the response body on the first 2xx. 4xx responses
// are not retried — those are caller errors that won't get better.
func postJSONRetry(url, token string, body any) ([]byte, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	const maxAttempts = 3
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		req, _ := http.NewRequest("POST", url, bytes.NewReader(encoded))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			lastErr = err
			backoff := time.Duration(attempt) * 2 * time.Second
			fmt.Fprintf(os.Stderr, "  POST %s failed (attempt %d/%d): %v; retrying in %s\n",
				url, attempt, maxAttempts, err, backoff)
			time.Sleep(backoff)
			continue
		}
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return respBody, nil
		}
		// 4xx: caller error — no point retrying.
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			return nil, fmt.Errorf("status=%d body=%s",
				resp.StatusCode, abbreviate(string(respBody), 500))
		}
		lastErr = fmt.Errorf("status=%d body=%s",
			resp.StatusCode, abbreviate(string(respBody), 500))
		if attempt < maxAttempts {
			backoff := time.Duration(attempt) * 2 * time.Second
			fmt.Fprintf(os.Stderr, "  POST %s returned %d (attempt %d/%d); retrying in %s\n",
				url, resp.StatusCode, attempt, maxAttempts, backoff)
			time.Sleep(backoff)
		}
	}
	return nil, lastErr
}

// getJSONRetry GETs a URL with a Bearer token, retrying on 5xx / network
// errors (mirrors postJSONRetry's policy). Returns the response body on the
// first 2xx; 4xx is a caller error and isn't retried.
func getJSONRetry(url, token string) ([]byte, error) {
	const maxAttempts = 3
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		req, _ := http.NewRequest("GET", url, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Accept", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			lastErr = err
			backoff := time.Duration(attempt) * 2 * time.Second
			fmt.Fprintf(os.Stderr, "  GET %s failed (attempt %d/%d): %v; retrying in %s\n",
				url, attempt, maxAttempts, err, backoff)
			time.Sleep(backoff)
			continue
		}
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return respBody, nil
		}
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			return nil, fmt.Errorf("status=%d body=%s",
				resp.StatusCode, abbreviate(string(respBody), 500))
		}
		lastErr = fmt.Errorf("status=%d body=%s",
			resp.StatusCode, abbreviate(string(respBody), 500))
		if attempt < maxAttempts {
			backoff := time.Duration(attempt) * 2 * time.Second
			fmt.Fprintf(os.Stderr, "  GET %s returned %d (attempt %d/%d); retrying in %s\n",
				url, resp.StatusCode, attempt, maxAttempts, backoff)
			time.Sleep(backoff)
		}
	}
	return nil, lastErr
}

// putToS3Retry PUTs the gzip file at gzPath to the presigned URL with the
// headers the backend signed into the URL (Content-Type, Content-Encoding,
// x-amz-tagging). Reopens the file on each attempt because http.Client
// consumes the body. 4xx from S3 = signature mismatch → not retried.
func putToS3Retry(presignedURL, gzPath string, size int64, headers map[string]string) error {
	const maxAttempts = 3
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		f, err := os.Open(gzPath)
		if err != nil {
			return err
		}
		req, _ := http.NewRequest("PUT", presignedURL, f)
		req.ContentLength = size
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		// Long timeout: 200MB on a slow uplink can take 10+ min. Use a
		// per-request client so we don't trip the default 0 (no timeout)
		// surprise of http.DefaultClient.
		client := &http.Client{Timeout: 30 * time.Minute}
		resp, err := client.Do(req)
		f.Close()
		if err != nil {
			lastErr = err
			backoff := time.Duration(attempt) * 3 * time.Second
			fmt.Fprintf(os.Stderr, "  S3 PUT failed (attempt %d/%d): %v; retrying in %s\n",
				attempt, maxAttempts, err, backoff)
			time.Sleep(backoff)
			continue
		}
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return nil
		}
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			return fmt.Errorf("status=%d body=%s",
				resp.StatusCode, abbreviate(string(respBody), 500))
		}
		lastErr = fmt.Errorf("status=%d body=%s",
			resp.StatusCode, abbreviate(string(respBody), 500))
		if attempt < maxAttempts {
			backoff := time.Duration(attempt) * 3 * time.Second
			fmt.Fprintf(os.Stderr, "  S3 PUT returned %d (attempt %d/%d); retrying in %s\n",
				resp.StatusCode, attempt, maxAttempts, backoff)
			time.Sleep(backoff)
		}
	}
	if lastErr == nil {
		lastErr = errors.New("unknown s3 put error")
	}
	return lastErr
}
