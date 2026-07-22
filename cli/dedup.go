package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"
)

// --- pre-decompile hash dedup --------------------------------------------
//
// Before running a (slow, CPU-heavy) local Ghidra decompile, the CLI asks the
// backend whether any PUBLIC project already holds an analysis of this exact
// binary (matched by sha256). On a hit we offer to fork that shared analysis
// instead — instant, and it charges no worker-quota. This is the desktop half
// of Slice 7 (the /dedup endpoint is Slice 7a).
//
// The lookup is public-data-only on the backend: a private sample with the
// same hash never appears here, so this can't leak another user's upload.

// dedupMatch mirrors the backend DedupMatch DTO. The backend returns matches
// most-upvoted first, so matches[0] is the analysis we offer to fork.
type dedupMatch struct {
	ProjectID        string `json:"projectId"`
	Name             string `json:"name"`
	OwnerDisplayName string `json:"ownerDisplayName"`
	VoteCount        int64  `json:"voteCount"`
}

// lookupDedup asks the backend for PUBLIC projects that already analyzed this
// sha256. Returns an empty slice (not an error) when nothing matches.
func lookupDedup(cfg config, token, sha256Hex string) ([]dedupMatch, error) {
	u := cfg.apiBase + "/api/projects/dedup?sha256=" + url.QueryEscape(sha256Hex)
	body, err := getJSONRetry(u, token)
	if err != nil {
		return nil, err
	}
	var matches []dedupMatch
	if err := json.Unmarshal(body, &matches); err != nil {
		return nil, fmt.Errorf("parse dedup response: %w", err)
	}
	return matches, nil
}

// forkProject forks an existing public project over its shared analysis blob
// (no re-decompile, no worker-quota charge). Returns the new fork's project id.
func forkProject(cfg config, token, sourceProjectID string) (string, error) {
	u := cfg.apiBase + "/api/projects/" + sourceProjectID + "/fork"
	// The fork endpoint takes no request body (the source id is in the path),
	// but postJSONRetry always sends a JSON body + Content-Type; an empty
	// object is harmless since there's no @RequestBody to bind.
	body, err := postJSONRetry(u, token, struct{}{})
	if err != nil {
		return "", err
	}
	var resp struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return "", fmt.Errorf("parse fork response: %w", err)
	}
	if resp.ID == "" {
		return "", fmt.Errorf("fork response missing project id")
	}
	return resp.ID, nil
}

// offerForkOnDedup runs the pre-decompile dedup check. When a public analysis
// of this exact binary already exists it lists the matches and offers to fork
// the top one instead of re-decompiling. Returns a non-empty URL when the user
// (or --fork) chose to fork — the caller should then stop and print it.
//
// Every failure mode here is non-fatal: a lookup error, a non-interactive
// terminal with no --fork, a declined prompt, or even a failed fork all fall
// through to "" so the caller carries on and decompiles. The CLI's whole
// premise is that it still works when the backend is flaky.
func offerForkOnDedup(cfg config, tokenLookup func() (string, error), sha256Hex string, autoFork bool) string {
	token, err := tokenLookup()
	if err != nil {
		fmt.Fprintf(os.Stderr, "  (skipping dedup check: %v)\n", err)
		return ""
	}
	matches, err := lookupDedup(cfg, token, sha256Hex)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  (dedup check failed, decompiling anyway: %v)\n", err)
		return ""
	}
	if len(matches) == 0 {
		return ""
	}

	fmt.Printf("\nOpenBin already has %d public analysis result(s) for this exact binary:\n", len(matches))
	for i, m := range matches {
		owner := m.OwnerDisplayName
		if owner == "" {
			owner = "unknown"
		}
		fmt.Printf("  %d. %s — by %s (%d upvote%s)\n",
			i+1, m.Name, owner, m.VoteCount, plural(m.VoteCount, "", "s"))
	}

	top := matches[0]
	if !autoFork {
		if !stdinIsTerminal() {
			fmt.Println("Re-run with --fork to fork the top match instead, or --no-dedup to skip this check.")
			fmt.Println("Decompiling locally now...")
			return ""
		}
		if !promptYesNo("Fork the top match (#1) instead of decompiling? [Y/n] ") {
			fmt.Println("Decompiling locally instead...")
			return ""
		}
	}

	fmt.Printf("Forking %q...\n", top.Name)
	newID, err := forkProject(cfg, token, top.ProjectID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  fork failed (%v); decompiling locally instead...\n", err)
		return ""
	}
	// Dedup/fork only runs from `openbin decompile` (BIN projects).
	return projectWebURL(cfg, projectKindBin, newID)
}

// stdinIsTerminal reports whether stdin is an interactive TTY (so we only
// prompt when a human can answer). Piped/CI stdin returns false.
func stdinIsTerminal() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}

// promptYesNo asks a yes/no question defaulting to yes (bare Enter = yes).
func promptYesNo(prompt string) bool {
	fmt.Print(prompt)
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && line == "" {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(line)) {
	case "", "y", "yes":
		return true
	default:
		return false
	}
}

// plural returns singular when n == 1, else the plural form.
func plural(n int64, singular, pluralForm string) string {
	if n == 1 {
		return singular
	}
	return pluralForm
}
