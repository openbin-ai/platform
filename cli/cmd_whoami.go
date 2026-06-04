package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/spf13/cobra"
)

var whoamiCmd = &cobra.Command{
	Use:   "whoami",
	Short: "Print the authenticated user's identity",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg := loadConfig()
		token, err := ensureValidAccessToken(cfg)
		if err != nil {
			return err
		}

		req, _ := http.NewRequest("GET", cfg.userInfoEndpoint(), nil)
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return fmt.Errorf("userinfo request: %w", err)
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != 200 {
			return fmt.Errorf("userinfo failed: status=%d body=%s",
				resp.StatusCode, abbreviate(string(body), 300))
		}

		// Keycloak userinfo returns a JSON object — pretty-print rather than
		// shred into specific fields so future realm claim additions surface
		// without code changes.
		var pretty map[string]interface{}
		if err := json.Unmarshal(body, &pretty); err != nil {
			fmt.Println(string(body))
			return nil
		}
		out, _ := json.MarshalIndent(pretty, "", "  ")
		fmt.Println(string(out))
		return nil
	},
}

func init() {
	rootCmd.AddCommand(whoamiCmd)
}
