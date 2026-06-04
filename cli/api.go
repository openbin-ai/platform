package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// ingestRequest is the wire shape sent to POST /api/projects/ingest. The
// backend validates schemaVersion against its supported set and returns
// "please upgrade your CLI" if it doesn't match.
type ingestRequest struct {
	Name             string          `json:"name"`
	OriginalFilename string          `json:"originalFilename"`
	ArchHint         string          `json:"archHint,omitempty"`
	SizeBytes        int64           `json:"sizeBytes"`
	Sha256           string          `json:"sha256"`
	SchemaVersion    string          `json:"schemaVersion"`
	Source           string          `json:"source"` // always "cli"
	WorkerOutput     json.RawMessage `json:"workerOutput"`
}

// ingestResponse is whatever the backend returns. Kept loose so the
// frontend URL field can evolve without breaking older CLIs.
type ingestResponse struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

func ingestProject(cfg config, token, name, filename, archHint, sha256Hex string, sizeBytes int64, workerJSON []byte) (*ingestResponse, error) {
	req := ingestRequest{
		Name:             name,
		OriginalFilename: filename,
		ArchHint:         archHint,
		SizeBytes:        sizeBytes,
		Sha256:           sha256Hex,
		SchemaVersion:    ingestSchemaVersion,
		Source:           "cli",
		WorkerOutput:     workerJSON,
	}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	httpReq, _ := http.NewRequest("POST", cfg.apiBase+"/api/projects/ingest", bytes.NewReader(body))
	httpReq.Header.Set("Authorization", "Bearer "+token)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("ingest request: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return nil, fmt.Errorf("ingest failed: status=%d body=%s",
			resp.StatusCode, abbreviate(string(respBody), 500))
	}
	var ir ingestResponse
	if err := json.Unmarshal(respBody, &ir); err != nil {
		return nil, fmt.Errorf("parse ingest response: %w", err)
	}
	return &ir, nil
}
