package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Verifies the CLI's dedup + fork wire contract against the backend DTOs
// without needing Keycloak: an httptest server stands in for the API and we
// assert URL construction, JSON field tags, and response parsing.

func TestLookupDedupParsesMatches(t *testing.T) {
	var gotPath, gotQuery, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.Query().Get("sha256")
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `[
			{"projectId":"11111111-1111-1111-1111-111111111111","name":"libssl fork","ownerDisplayName":"alice","voteCount":7},
			{"projectId":"22222222-2222-2222-2222-222222222222","name":"libssl","ownerDisplayName":"bob","voteCount":0}
		]`)
	}))
	defer srv.Close()

	cfg := config{apiBase: srv.URL}
	matches, err := lookupDedup(cfg, "tok123", "abc+def/xyz")
	if err != nil {
		t.Fatalf("lookupDedup: %v", err)
	}
	if gotPath != "/api/projects/dedup" {
		t.Errorf("path = %q, want /api/projects/dedup", gotPath)
	}
	if gotQuery != "abc+def/xyz" {
		t.Errorf("sha256 query = %q, want abc+def/xyz (must be url-decoded intact)", gotQuery)
	}
	if gotAuth != "Bearer tok123" {
		t.Errorf("auth header = %q, want Bearer tok123", gotAuth)
	}
	if len(matches) != 2 {
		t.Fatalf("got %d matches, want 2", len(matches))
	}
	if matches[0].ProjectID != "11111111-1111-1111-1111-111111111111" ||
		matches[0].Name != "libssl fork" || matches[0].OwnerDisplayName != "alice" || matches[0].VoteCount != 7 {
		t.Errorf("match[0] mismapped: %+v", matches[0])
	}
}

func TestLookupDedupEmpty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `[]`)
	}))
	defer srv.Close()

	matches, err := lookupDedup(config{apiBase: srv.URL}, "tok", "deadbeef")
	if err != nil {
		t.Fatalf("lookupDedup: %v", err)
	}
	if len(matches) != 0 {
		t.Errorf("got %d matches, want 0", len(matches))
	}
}

func TestForkProjectPostsAndParsesID(t *testing.T) {
	var gotMethod, gotPath string
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusCreated)
		// ProjectResponse is much larger; we only consume "id".
		io.WriteString(w, `{"id":"33333333-3333-3333-3333-333333333333","kind":"BIN","name":"fork"}`)
	}))
	defer srv.Close()

	id, err := forkProject(config{apiBase: srv.URL}, "tok", "22222222-2222-2222-2222-222222222222")
	if err != nil {
		t.Fatalf("forkProject: %v", err)
	}
	if gotMethod != "POST" {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if gotPath != "/api/projects/22222222-2222-2222-2222-222222222222/fork" {
		t.Errorf("path = %q", gotPath)
	}
	// The fork endpoint has no @RequestBody; an empty JSON object must be
	// harmless (valid JSON, nothing to bind).
	if strings.TrimSpace(string(gotBody)) != "{}" {
		t.Errorf("body = %q, want {}", gotBody)
	}
	if id != "33333333-3333-3333-3333-333333333333" {
		t.Errorf("id = %q", id)
	}
}

func TestForkProjectMissingID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"kind":"BIN"}`)
	}))
	defer srv.Close()

	if _, err := forkProject(config{apiBase: srv.URL}, "tok", "x"); err == nil {
		t.Error("expected error when fork response has no id")
	}
}

func TestGetJSONRetryNoRetryOn4xx(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.WriteHeader(http.StatusUnauthorized)
		io.WriteString(w, `{"error":"nope"}`)
	}))
	defer srv.Close()

	if _, err := getJSONRetry(srv.URL+"/api/projects/dedup", "tok"); err == nil {
		t.Error("expected error on 401")
	}
	if hits != 1 {
		t.Errorf("server hit %d times, want 1 (4xx must not retry)", hits)
	}
}

// Sanity: the struct tags round-trip against the exact JSON the backend emits.
func TestDedupMatchTagRoundTrip(t *testing.T) {
	in := dedupMatch{ProjectID: "p", Name: "n", OwnerDisplayName: "o", VoteCount: 3}
	b, _ := json.Marshal(in)
	want := `{"projectId":"p","name":"n","ownerDisplayName":"o","voteCount":3}`
	if string(b) != want {
		t.Errorf("marshal = %s, want %s", b, want)
	}
}
