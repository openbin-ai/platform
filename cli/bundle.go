package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
)

// Bundle grouping support for `openbin decompile`. A bundle is a lightweight
// server-side grouping of several standalone BIN projects that belong to one
// real-world sample (a dropper + its payloads, the several ABIs of one app,
// etc.). The CLI is the only creator: a directory arg or multiple file args
// (or an explicit --bundle NAME) produce one bundle whose members are ingested
// individually, each tagged with the bundle id.

// Max binaries a single sweep will ingest. A guard against pointing decompile
// at a huge tree by accident — anything past this is skipped loudly.
const maxBundleFiles = 100

type bundleSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	FileCount int    `json:"fileCount"`
}

var uuidRe = regexp.MustCompile(
	`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// resolveBundleID turns a --bundle value into a bundle id. A UUID is taken as
// an existing bundle id verbatim (the backend validates ownership on ingest);
// anything else is treated as a name and get-or-created server-side, so
// re-running the same command appends to the same bundle instead of spawning
// duplicates.
func resolveBundleID(cfg config, tokenLookup func() (string, error), nameOrID string) (string, error) {
	if uuidRe.MatchString(nameOrID) {
		return nameOrID, nil
	}
	token, err := tokenLookup()
	if err != nil {
		return "", fmt.Errorf("auth before bundle create: %w", err)
	}
	body, err := postJSONRetry(cfg.apiBase+"/api/bundles", token,
		map[string]string{"name": nameOrID})
	if err != nil {
		return "", fmt.Errorf("create bundle %q: %w", nameOrID, err)
	}
	var bs bundleSummary
	if err := json.Unmarshal(body, &bs); err != nil {
		return "", fmt.Errorf("parse bundle response: %w", err)
	}
	if bs.ID == "" {
		return "", fmt.Errorf("bundle create returned no id")
	}
	return bs.ID, nil
}

// looksLikeBinary sniffs the first bytes of a file for an executable magic the
// Ghidra worker can analyze: ELF, PE (MZ), or Mach-O (incl. fat). Mirrors the
// backend's sniffKind so the sweep and the server agree on what a "binary" is.
func looksLikeBinary(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	buf := make([]byte, 4)
	n, _ := io.ReadFull(f, buf)
	if n < 4 {
		return false
	}
	// \x7FELF
	if buf[0] == 0x7F && buf[1] == 'E' && buf[2] == 'L' && buf[3] == 'F' {
		return true
	}
	// MZ — DOS/PE
	if buf[0] == 'M' && buf[1] == 'Z' {
		return true
	}
	// Mach-O 32/64-bit BE/LE + fat-binary magics.
	magic := uint32(buf[0])<<24 | uint32(buf[1])<<16 | uint32(buf[2])<<8 | uint32(buf[3])
	switch magic {
	case 0xFEEDFACE, 0xFEEDFACF, 0xCEFAEDFE, 0xCFFAEDFE, 0xCAFEBABE:
		return true
	}
	return false
}

// sweepBinaries walks dir recursively and returns the paths of every regular
// file whose magic looks like an analyzable binary, sorted for stable order.
// Hidden directories are skipped. The result is capped at maxBundleFiles; the
// caller is told how many were dropped so a silent truncation never reads as
// "analyzed everything".
func sweepBinaries(dir string) (paths []string, skipped int, err error) {
	walkErr := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			// Skip dot-dirs (.git, .DS_Store trees, etc.) but not the root.
			if p != dir && len(d.Name()) > 1 && d.Name()[0] == '.' {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Type().IsRegular() && looksLikeBinary(p) {
			paths = append(paths, p)
		}
		return nil
	})
	if walkErr != nil {
		return nil, 0, walkErr
	}
	sort.Strings(paths)
	if len(paths) > maxBundleFiles {
		skipped = len(paths) - maxBundleFiles
		paths = paths[:maxBundleFiles]
	}
	return paths, skipped, nil
}
