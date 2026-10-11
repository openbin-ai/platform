package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// serverConfig is the on-disk shape of ~/.config/openbin/server.json: the
// deployment this CLI talks to. The hosted product never writes it (the
// compiled-in defaults are right). A self-hosted analyst runs
//
//	openbin login --server https://api.re.example.gov
//
// once; the CLI fetches GET /api/public/config from that API, which names
// the Keycloak base, the web app hosts and where install assets and worker
// images are served from, and saves all of it here. Env vars
// (OPENBIN_API_URL, OPENBIN_AUTH_URL, OPENBIN_RELEASE_BASE) still win over
// the file so dev overrides keep working.
type serverConfig struct {
	APIURL        string `json:"api_url"`
	AuthURL       string `json:"auth_url"`
	ReleaseBase   string `json:"release_base,omitempty"`
	OpenbinWebURL string `json:"openbin_web_url,omitempty"`
	OpenapkWebURL string `json:"openapk_web_url,omitempty"`
	SelfHosted    bool   `json:"self_hosted"`
}

// publicConfig mirrors the backend's /api/public/config response.
type publicConfig struct {
	SelfHosted    bool   `json:"selfHosted"`
	AuthURL       string `json:"authUrl"`
	IssuerURI     string `json:"issuerUri"`
	OpenbinWebURL string `json:"openbinWebUrl"`
	OpenapkWebURL string `json:"openapkWebUrl"`
	DownloadsBase string `json:"downloadsBase"`
}

func serverConfigPath() (string, error) {
	credPath, err := credentialsPath()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(credPath), "server.json"), nil
}

// loadServerConfig returns (nil, nil) when no server has been saved.
func loadServerConfig() (*serverConfig, error) {
	path, err := serverConfigPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read server config: %w", err)
	}
	var sc serverConfig
	if err := json.Unmarshal(data, &sc); err != nil {
		return nil, fmt.Errorf("parse server config at %s: %w", path, err)
	}
	return &sc, nil
}

func saveServerConfig(sc *serverConfig) error {
	path, err := serverConfigPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("mkdir config dir: %w", err)
	}
	data, err := json.MarshalIndent(sc, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func clearServerConfig() error {
	path, err := serverConfigPath()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// discoverServer asks an API base for its public config and turns it into
// a serverConfig ready to save. apiURL is normalised (scheme required, no
// trailing slash) so later string concatenation is safe.
func discoverServer(apiURL string) (*serverConfig, error) {
	base := strings.TrimRight(strings.TrimSpace(apiURL), "/")
	if !strings.HasPrefix(base, "http://") && !strings.HasPrefix(base, "https://") {
		return nil, fmt.Errorf("--server must be a full URL such as https://api.example.com (got %q)", apiURL)
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(base + "/api/public/config")
	if err != nil {
		return nil, fmt.Errorf("reach %s: %w", base, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s/api/public/config returned HTTP %d (is this an OpenBin API host?)", base, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return nil, fmt.Errorf("read config from %s: %w", base, err)
	}
	var pc publicConfig
	if err := json.Unmarshal(body, &pc); err != nil {
		return nil, fmt.Errorf("parse config from %s: %w", base, err)
	}
	if pc.AuthURL == "" {
		return nil, fmt.Errorf("%s did not report an auth URL; the server is too old for --server", base)
	}
	return &serverConfig{
		APIURL:        base,
		AuthURL:       strings.TrimRight(pc.AuthURL, "/"),
		ReleaseBase:   strings.TrimRight(pc.DownloadsBase, "/"),
		OpenbinWebURL: strings.TrimRight(pc.OpenbinWebURL, "/"),
		OpenapkWebURL: strings.TrimRight(pc.OpenapkWebURL, "/"),
		SelfHosted:    pc.SelfHosted,
	}, nil
}
