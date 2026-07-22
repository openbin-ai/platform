package main

import "testing"

func TestProjectWebURL(t *testing.T) {
	prod := config{apiBase: defaultAPIBaseURL}
	cases := []struct {
		name string
		cfg  config
		kind string
		id   string
		want string
	}{
		{"prod BIN → app.openbin.ai", prod, projectKindBin, "abc", "https://app.openbin.ai/projects/abc"},
		{"prod APK → openapk.ai", prod, projectKindApk, "abc", "https://openapk.ai/projects/abc"},
		{
			"dev api.* host swaps to app.*",
			config{apiBase: "https://api.example.test"}, projectKindBin, "x",
			"https://app.example.test/projects/x",
		},
		{
			"localhost override falls back to apiBase",
			config{apiBase: "http://localhost:8081"}, projectKindApk, "y",
			"http://localhost:8081/projects/y",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := projectWebURL(c.cfg, c.kind, c.id)
			if got != c.want {
				t.Errorf("projectWebURL(%q, %q) = %q, want %q", c.cfg.apiBase, c.kind, got, c.want)
			}
		})
	}

	// The bug this fixes: the API host must never be printed as a web URL.
	if got := projectWebURL(prod, projectKindBin, "z"); got == defaultAPIBaseURL+"/projects/z" {
		t.Errorf("regression: web URL still points at the API host: %q", got)
	}
}
