package main

import (
	"fmt"
	"time"

	"github.com/spf13/cobra"
)

var (
	loginServer      string
	loginResetServer bool
)

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate via the browser and save credentials locally",
	Long: `Runs the OAuth 2.0 device authorization grant against Keycloak. We open
your browser to a verification URL and show you a short code to confirm; once
you finish, the access + refresh tokens land in ~/.config/openbin/credentials.json
(mode 0600). Subsequent commands renew automatically.

Self-hosted installs: pass --server once with the API URL your administrator
gave you. The CLI asks that server where its sign-in, web app and download
hosts are and remembers them in ~/.config/openbin/server.json, so every later
command (decompile, apk, update) talks to your instance. --reset-server goes
back to the hosted openbin.ai service.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if loginResetServer {
			if err := clearServerConfig(); err != nil {
				return err
			}
			fmt.Println("Server reset to the hosted service (api.openapk.ai).")
		}
		if loginServer != "" {
			sc, err := discoverServer(loginServer)
			if err != nil {
				return err
			}
			if err := saveServerConfig(sc); err != nil {
				return err
			}
			path, _ := serverConfigPath()
			fmt.Printf("Server saved to %s\n  API:   %s\n  Auth:  %s\n", path, sc.APIURL, sc.AuthURL)
			if sc.ReleaseBase != "" {
				fmt.Printf("  Downloads: %s\n", sc.ReleaseBase)
			}
		}
		cfg := loadConfig()
		dc, err := startDeviceFlow(cfg)
		if err != nil {
			return err
		}

		// Show the code prominently. The verification_uri_complete embeds the
		// code as a query param so the user just needs to confirm — but it's
		// still polite to show the short code in case auto-fill fails.
		fmt.Println()
		fmt.Println("  Open this URL in your browser:")
		if dc.VerificationURIComplete != "" {
			fmt.Println("    " + dc.VerificationURIComplete)
		} else {
			fmt.Println("    " + dc.VerificationURI)
		}
		fmt.Println()
		fmt.Println("  And confirm this code:")
		fmt.Println("    " + dc.UserCode)
		fmt.Println()
		fmt.Println("  Waiting for confirmation...")

		tr, err := pollDeviceFlow(cfg, dc)
		if err != nil {
			return err
		}
		creds := &credentials{
			AccessToken:  tr.AccessToken,
			RefreshToken: tr.RefreshToken,
			ExpiresAt:    time.Now().Add(time.Duration(tr.ExpiresIn) * time.Second),
			AuthBase:     cfg.authBase,
			Realm:        cfg.realm,
			ClientID:     cfg.clientID,
		}
		if err := saveCredentials(creds); err != nil {
			return err
		}
		path, _ := credentialsPath()
		fmt.Println("\nLogged in. Credentials saved to " + path)
		return nil
	},
}

func init() {
	loginCmd.Flags().StringVar(&loginServer, "server", "",
		"API URL of a self-hosted OpenBin instance (e.g. https://api.re.example.com); remembered for later commands")
	loginCmd.Flags().BoolVar(&loginResetServer, "reset-server", false,
		"forget a previously saved --server and use the hosted service again")
	rootCmd.AddCommand(loginCmd)
}
