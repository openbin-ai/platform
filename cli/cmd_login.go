package main

import (
	"fmt"
	"time"

	"github.com/spf13/cobra"
)

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate via the browser and save credentials locally",
	Long: `Runs the OAuth 2.0 device authorization grant against Keycloak. We open
your browser to a verification URL and show you a short code to confirm; once
you finish, the access + refresh tokens land in ~/.config/openapk/credentials.json
(mode 0600). Subsequent commands renew automatically.`,
	RunE: func(cmd *cobra.Command, args []string) error {
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
	rootCmd.AddCommand(loginCmd)
}
