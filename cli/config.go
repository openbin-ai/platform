package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Defaults point at production. Local dev overrides with env vars:
//
//   OPENBIN_API_URL=http://localhost:8081 OPENBIN_AUTH_URL=http://localhost:8080 ./openbin login
//
// Shipped release binaries hit api.openapk.ai / auth.openapk.ai out of the
// box. The API + Keycloak domains are on openapk.ai because openbin and
// openapk share one backend + one realm — the CLI brand is openbin (native
// binaries) but the data plane is the shared one.
const (
	defaultAPIBaseURL  = "https://api.openapk.ai"
	defaultAuthBaseURL = "https://auth.openapk.ai"
	keycloakRealm      = "openapk"
	cliClientID        = "openbin-cli"

	// Pinned ingestion schema version. Backend rejects mismatched clients with
	// a "please upgrade" error rather than guessing at an old shape. Bump in
	// lockstep when worker JSON output gains/loses required fields.
	//
	//   1.0 — legacy: CLI POSTs the entire worker JSON to /api/projects/ingest.
	//   2.0 — S3:     CLI uses /api/projects/ingest/initiate + S3 PUT + finalize.
	//                 The CLI uses 2.0 by default; legacy path is kept on the
	//                 backend during the cutover.
	ingestSchemaVersion = "2.0"

	// Local Docker tag the CLI loads from the bundled tarball and then runs.
	// Release tarballs ship the image as `ghidra-worker.tar.gz` next to the
	// binary; we `docker load` it on first run so end users never need
	// network access for the image. See `ensureDockerImage` in ghidra.go.
	ghidraWorkerImage  = "openbin/ghidra-worker:bundled"
	ghidraImageTarball = "ghidra-worker.tar.gz"
)

// config groups the runtime endpoints + Keycloak details. Resolved once at
// command start (apiBase + authBase from env or defaults; everything else is
// compiled in for the alpha).
type config struct {
	apiBase  string
	authBase string
	realm    string
	clientID string
}

func loadConfig() config {
	return config{
		apiBase:  envOr("OPENBIN_API_URL", defaultAPIBaseURL),
		authBase: envOr("OPENBIN_AUTH_URL", defaultAuthBaseURL),
		realm:    keycloakRealm,
		clientID: cliClientID,
	}
}

// tokenEndpoint returns the Keycloak token URL — used by both the device flow
// poll and the (future) refresh-token exchange.
func (c config) tokenEndpoint() string {
	return fmt.Sprintf("%s/realms/%s/protocol/openid-connect/token",
		strings.TrimRight(c.authBase, "/"), c.realm)
}

func (c config) deviceAuthEndpoint() string {
	return fmt.Sprintf("%s/realms/%s/protocol/openid-connect/auth/device",
		strings.TrimRight(c.authBase, "/"), c.realm)
}

func (c config) userInfoEndpoint() string {
	return fmt.Sprintf("%s/realms/%s/protocol/openid-connect/userinfo",
		strings.TrimRight(c.authBase, "/"), c.realm)
}

// credentialsPath returns ~/.config/openbin/credentials.json. We follow XDG
// when XDG_CONFIG_HOME is set so the file lands in the user's preferred
// location on Linux; on macOS this resolves to ~/.config which is fine
// even though Apple convention is ~/Library/Application Support.
func credentialsPath() (string, error) {
	xdg := os.Getenv("XDG_CONFIG_HOME")
	if xdg == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("locate home dir: %w", err)
		}
		xdg = filepath.Join(home, ".config")
	}
	return filepath.Join(xdg, "openbin", "credentials.json"), nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
