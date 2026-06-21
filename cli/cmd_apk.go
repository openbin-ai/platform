package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

var apkImage string

var apkCmd = &cobra.Command{
	Use:   "apk <app.apk>",
	Short: "Decompile an APK locally and upload the result",
	Long: `Runs the bundled jadx-worker Docker image on your machine against the
given APK, then uploads both the APK and the decompiled source tree to your
OpenAPK account as a new project. Decompilation happens entirely on your
own hardware — cloud APK decompile is sunset (see openapk.ai).

Examples:
    openbin apk app-release.apk
    openbin apk --image openapk/jadx-worker:dev suspicious.apk
`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		// Best-effort "you're out of date" nudge after the run finishes.
		defer checkForUpdate()
		apkPath := args[0]
		info, err := os.Stat(apkPath)
		if err != nil {
			return fmt.Errorf("stat apk: %w", err)
		}
		if info.IsDir() {
			return errors.New("expected an APK file, got a directory")
		}

		cfg := loadConfig()

		// Login check up front — same rationale as `decompile`: don't let
		// the user wait out a long JADX run only to hit an auth error. The
		// token itself is re-resolved right before the upload.
		if _, err := ensureValidAccessToken(cfg); err != nil {
			return err
		}

		image := apkImage
		if image == "" {
			image = envOr("OPENAPK_JADX_IMAGE", jadxWorkerImage)
		}

		filename := filepath.Base(apkPath)
		fmt.Printf("Decompiling %s (%.1f MB) locally with JADX...\n",
			filename, float64(info.Size())/(1024*1024))
		start := time.Now()
		treePath, err := runLocalJadx(apkPath, image)
		if err != nil {
			return err
		}
		defer os.Remove(treePath)
		fmt.Printf("Local decompile finished in %s. Uploading...\n",
			roundDuration(time.Since(start)))

		tokenLookup := func() (string, error) {
			tok, err := ensureValidAccessToken(cfg)
			if err != nil {
				return "", fmt.Errorf("refresh access token: %w", err)
			}
			return tok, nil
		}
		ir, err := uploadApkProject(cfg, tokenLookup, apkPath, treePath)
		if err != nil {
			return err
		}

		projectURL := ir.URL
		if projectURL == "" {
			projectURL = fmt.Sprintf("%s/projects/%s",
				strings.TrimRight(cfg.apiBase, "/"), ir.ID)
		}
		fmt.Println("Done!", projectURL)
		return nil
	},
}

func init() {
	apkCmd.Flags().StringVar(&apkImage, "image", "",
		"override the jadx-worker Docker image (default: built-in)")
	rootCmd.AddCommand(apkCmd)
}
