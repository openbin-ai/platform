package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
)

// fileSha256 streams the file through SHA-256 and returns hex + size in bytes.
// We can't keep the binary in memory (firmware images can be 100s of MB), so
// we read in 64 KiB chunks. Single pass — the digest is computed alongside
// the size to avoid stat'ing the file twice.
func fileSha256(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, fmt.Errorf("open for hashing: %w", err)
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return "", 0, fmt.Errorf("read for hashing: %w", err)
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}
