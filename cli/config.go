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
	//
	// IMPORTANT — this tag is the cache key. `ensureDockerImage` skips the
	// download whenever a local image with this exact tag already exists, so
	// the ONLY way to push a changed worker (new extract.py output, etc.) to
	// users who already ran one decompile is to BUMP this tag. Keep it in
	// lockstep with the `--tag` in .github/workflows/release-cli.yml.
	//   :bundled — v1 (pre-2026-06-15; decompiled + disassembly only)
	//   :2       — adds line_map + vars for Ghidra-style cross-highlighting
	//   :3       — full data-symbol bytes_preview (4KB cap, budgeted)
	//   :4       — fixes entry_points/exports always empty (wrong API call)
	//   :5       — wall-clock decompile budget: emits a PARTIAL result (stubs
	//              the functions it can't reach in time) instead of a 504 on
	//              huge binaries; per-fn decompile cap 90s→45s. Pairs with the
	//              new `decompile --timeout` / `--analysis-timeout` flags.
	ghidraWorkerImage  = "openbin/ghidra-worker:5"
	ghidraImageTarball = "ghidra-worker.tar.gz"

	// Same bundling scheme for the JADX worker (APK decompiles).
	//   :bundled   — v1, byte-identical to the pre-sunset cloud jadx-worker
	//   :bundled-2 — unpacks split containers (.xapk/.apks) and feeds every
	//                inner APK to jadx as its own input (merged project)
	jadxWorkerImage  = "openapk/jadx-worker:bundled-2"
	jadxImageTarball = "jadx-worker.tar.gz"
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

// Project kinds, matching the backend's ProjectKind enum. Used to pick the
// right web-app host in projectWebURL.
const (
	projectKindBin = "BIN"
	projectKindApk = "APK"
)

// projectWebURL returns the browser URL for a finished project — the link the
// CLI prints as "Done! <url>". The web app differs by product: BIN (native)
// projects open on app.openbin.ai, APK projects on openapk.ai. This mirrors
// the backend's EmailService.projectUrlFor so the CLI's link and the
// decompile-complete email always agree.
//
// The API host (api.openapk.ai) is NOT a web host — printing it was the bug
// this replaces. Against a non-prod API (OPENBIN_API_URL override for
// dev/self-host) there's no known web host, so we best-effort swap an `api.`
// subdomain to `app.` and otherwise fall back to the API base.
func projectWebURL(cfg config, kind, projectID string) string {
	if cfg.apiBase == defaultAPIBaseURL {
		if kind == projectKindBin {
			return "https://app.openbin.ai/projects/" + projectID
		}
		return "https://openapk.ai/projects/" + projectID
	}
	base := strings.TrimRight(cfg.apiBase, "/")
	if strings.HasPrefix(base, "https://api.") {
		base = "https://app." + strings.TrimPrefix(base, "https://api.")
	} else if strings.HasPrefix(base, "http://api.") {
		base = "http://app." + strings.TrimPrefix(base, "http://api.")
	}
	return base + "/projects/" + projectID
}

// bundleWebURL returns the browser URL for a bundle overview page. Bundles are
// a native-binary (BIN) concept, so they always live on the openbin web app —
// mirrors projectWebURL's host resolution.
func bundleWebURL(cfg config, bundleID string) string {
	if cfg.apiBase == defaultAPIBaseURL {
		return "https://app.openbin.ai/bundles/" + bundleID
	}
	base := strings.TrimRight(cfg.apiBase, "/")
	if strings.HasPrefix(base, "https://api.") {
		base = "https://app." + strings.TrimPrefix(base, "https://api.")
	} else if strings.HasPrefix(base, "http://api.") {
		base = "http://app." + strings.TrimPrefix(base, "http://api.")
	}
	return base + "/bundles/" + bundleID
}
