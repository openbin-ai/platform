package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// credentials is the on-disk shape of ~/.config/openapk/credentials.json.
// We keep both tokens plus the absolute access-token expiry instant so we
// can decide pre-flight whether a refresh is needed without parsing the
// JWT. Realm + clientID + authBase are stamped in so a later config change
// invalidates the stored token cleanly.
type credentials struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	AuthBase     string    `json:"auth_base"`
	Realm        string    `json:"realm"`
	ClientID     string    `json:"client_id"`
}

// loadCredentials reads ~/.config/openbin/credentials.json. Returns
// (nil, nil) when the file doesn't exist so the caller can prompt for
// `openbin login` cleanly instead of distinguishing "no file" from "broken
// file" itself.
func loadCredentials() (*credentials, error) {
	path, err := credentialsPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read credentials: %w", err)
	}
	var c credentials
	if err := json.Unmarshal(data, &c); err != nil {
		return nil, fmt.Errorf("parse credentials at %s: %w", path, err)
	}
	return &c, nil
}

func saveCredentials(c *credentials) error {
	path, err := credentialsPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("mkdir credentials dir: %w", err)
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	// 0600 — owner read/write only. Refresh tokens are essentially a
	// password equivalent so we never want them group/world-readable.
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("write credentials: %w", err)
	}
	return nil
}

// deviceCodeResponse mirrors Keycloak's device authorization grant response.
type deviceCodeResponse struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

type tokenResponse struct {
	AccessToken      string `json:"access_token"`
	RefreshToken     string `json:"refresh_token"`
	ExpiresIn        int    `json:"expires_in"`
	TokenType        string `json:"token_type"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

// startDeviceFlow kicks off the OAuth 2.0 device authorization grant
// (RFC 8628). The caller is responsible for showing user_code +
// verification_uri to the user and then calling pollDeviceFlow.
func startDeviceFlow(cfg config) (*deviceCodeResponse, error) {
	form := url.Values{
		"client_id": {cfg.clientID},
		"scope":     {"openid profile email offline_access"},
	}
	resp, err := http.PostForm(cfg.deviceAuthEndpoint(), form)
	if err != nil {
		return nil, fmt.Errorf("device auth request: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("device auth failed: status=%d body=%s",
			resp.StatusCode, abbreviate(string(body), 300))
	}
	var dc deviceCodeResponse
	if err := json.Unmarshal(body, &dc); err != nil {
		return nil, fmt.Errorf("parse device auth response: %w", err)
	}
	if dc.Interval <= 0 {
		dc.Interval = 5
	}
	return &dc, nil
}

// pollDeviceFlow polls the token endpoint until the user completes browser
// auth, the device code expires, or context cancels. Standard backoff is
// the server-supplied interval plus a 5s bump on slow_down.
func pollDeviceFlow(cfg config, dc *deviceCodeResponse) (*tokenResponse, error) {
	interval := time.Duration(dc.Interval) * time.Second
	deadline := time.Now().Add(time.Duration(dc.ExpiresIn) * time.Second)

	for {
		if time.Now().After(deadline) {
			return nil, errors.New("device code expired before login completed; run `openbin login` again")
		}
		time.Sleep(interval)

		form := url.Values{
			"grant_type":  {"urn:ietf:params:oauth:grant-type:device_code"},
			"device_code": {dc.DeviceCode},
			"client_id":   {cfg.clientID},
		}
		resp, err := http.PostForm(cfg.tokenEndpoint(), form)
		if err != nil {
			// transient network error — keep polling; the device flow tolerates this.
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var tr tokenResponse
		_ = json.Unmarshal(body, &tr) // tolerate partial bodies and inspect Error below

		if resp.StatusCode == 200 && tr.AccessToken != "" {
			return &tr, nil
		}
		// Standard RFC 8628 polling errors. Anything else = give up.
		switch tr.Error {
		case "authorization_pending":
			// user hasn't finished the browser step yet — keep polling.
		case "slow_down":
			interval += 5 * time.Second
		case "expired_token":
			return nil, errors.New("device code expired; run `openbin login` again")
		case "access_denied":
			return nil, errors.New("login denied")
		default:
			return nil, fmt.Errorf("token poll failed: status=%d error=%q desc=%q",
				resp.StatusCode, tr.Error, tr.ErrorDescription)
		}
	}
}

// refreshAccessToken exchanges a refresh token for a new access token. Updates
// `creds` in place AND persists; on a hard refresh failure the on-disk file
// is left untouched so the user can retry rather than landing in a half-state.
func refreshAccessToken(cfg config, creds *credentials) error {
	if creds.RefreshToken == "" {
		return errors.New("no refresh token; run `openbin login` again")
	}
	form := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {creds.RefreshToken},
		"client_id":     {cfg.clientID},
	}
	resp, err := http.PostForm(cfg.tokenEndpoint(), form)
	if err != nil {
		return fmt.Errorf("refresh request: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return fmt.Errorf("refresh failed: status=%d body=%s",
			resp.StatusCode, abbreviate(string(body), 300))
	}
	var tr tokenResponse
	if err := json.Unmarshal(body, &tr); err != nil {
		return fmt.Errorf("parse refresh response: %w", err)
	}
	creds.AccessToken = tr.AccessToken
	if tr.RefreshToken != "" {
		// Keycloak may rotate the refresh token. Keep the new one if so;
		// otherwise the old one stays valid for its original window.
		creds.RefreshToken = tr.RefreshToken
	}
	creds.ExpiresAt = time.Now().Add(time.Duration(tr.ExpiresIn) * time.Second)
	return saveCredentials(creds)
}

// ensureValidAccessToken loads credentials, refreshes if the access token is
// about to expire (within 30s), and returns the bearer token to attach to
// API calls. Returns an error if the user isn't logged in yet — caller
// should surface that as "run `openbin login` first".
func ensureValidAccessToken(cfg config) (string, error) {
	creds, err := loadCredentials()
	if err != nil {
		return "", err
	}
	if creds == nil {
		return "", errors.New("not logged in; run `openbin login` first")
	}
	// Refresh slightly before expiry so a request that takes a few seconds
	// can't time-out mid-flight on a stale token.
	if time.Until(creds.ExpiresAt) < 30*time.Second {
		if err := refreshAccessToken(cfg, creds); err != nil {
			return "", err
		}
	}
	return creds.AccessToken, nil
}

func abbreviate(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}
