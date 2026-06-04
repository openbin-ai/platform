package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Defaults assume local dev (compose stack on the developer's box). For shipped
// binaries we'll bake prod URLs into a release build via -ldflags. Users can
// override either default at runtime by setting OPENAPK_API_URL or
// OPENAPK_AUTH_URL — handy for QA/staging or self-hosters.
const (
	defaultAPIBaseURL  = "http://localhost:8081"
	defaultAuthBaseURL = "http://localhost:8080"
	keycloakRealm      = "openapk"
	cliClientID        = "openapk-cli"

	// Pinned ingestion schema version. Backend rejects mismatched clients with
	// a "please upgrade" error rather than guessing at an old shape. Bump in
	// lockstep when worker JSON output gains/loses required fields.
	ingestSchemaVersion = "1.0"

	// Docker image the CLI pulls + runs locally to do the decompile. Pinned
	// to :latest for the alpha; production releases should pin to a digest
	// so a republished worker can't silently change behavior under users.
	ghidraWorkerImage = "804517034561.dkr.ecr.us-east-1.amazonaws.com/openapk/ghidra-worker:latest"
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
		apiBase:  envOr("OPENAPK_API_URL", defaultAPIBaseURL),
		authBase: envOr("OPENAPK_AUTH_URL", defaultAuthBaseURL),
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

// credentialsPath returns ~/.config/openapk/credentials.json. We follow XDG
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
	return filepath.Join(xdg, "openapk", "credentials.json"), nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
