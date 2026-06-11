# OpenBin CLI

Decompile APKs and native binaries on your own machine and push the results
to your OpenAPK / OpenBin account. Your sample never leaves your laptop — only
the decompiled output (source tree, function listings, strings, metadata) is
uploaded.

## Install

One line, Linux & macOS:

```bash
curl -fsSL https://openbin.ai/install.sh | sh
```

That downloads just the CLI binary (~10 MB) to `~/.local/bin`, makes sure it's
on your `PATH`, and prints next steps. The Docker worker images are NOT bundled
— the CLI downloads the one it needs (jadx for APKs, Ghidra for binaries) the
first time you run a decompile, and caches it for offline reuse afterward.

Env overrides: `OPENBIN_INSTALL_DIR` (install location), `OPENBIN_RELEASE_BASE`
(release asset mirror).

Windows is intentionally not supported — openbin is a Unix-first tool. Use WSL2.

### Manual install

Prefer not to pipe to a shell? Grab the tarball for your platform from
<https://github.com/openbin-ai/platform/releases/latest>
(`openbin-<os>-<arch>.tar.gz`), then:

```bash
tar xzf openbin-<os>-<arch>.tar.gz
mkdir -p ~/.local/bin
mv openbin-*/openbin ~/.local/bin/
chmod +x ~/.local/bin/openbin
# ensure ~/.local/bin is on PATH (most modern shells already do this)
```

### Offline / air-gapped install

The worker images can be pre-seeded so the CLI never reaches the network. Drop
`jadx-worker.tar.gz` and/or `ghidra-worker.tar.gz` (also release assets) into
any of these, and the CLI `docker load`s from there instead of downloading:

1. Next to the `openbin` binary (resolving symlinks — safe to symlink into PATH)
2. `~/.local/share/openbin/` (XDG data dir — where lazy downloads are cached)
3. `/usr/local/share/openbin/` (system-wide)
4. The current working directory (last resort)

## Requirements

- **Linux or macOS.** Windows is not supported (use WSL2).
- **Docker** running on your machine ([install](https://docs.docker.com/get-docker/)).
  Runs the local jadx / Ghidra worker — no other tooling needed.
- An **OpenAPK / OpenBin account** at <https://openapk.ai> / <https://openbin.ai> (free).

## Usage

```bash
# 1. Sign in (one-time per machine). Opens your browser; paste the short code
#    shown, then come back to the terminal.
openbin login

# 2. Confirm it worked:
openbin whoami

# 3a. Decompile an APK (JADX). First run downloads the jadx worker image
#     (~350 MB; one-time, cached afterward).
openbin apk app-release.apk

# 3b. Decompile a native binary (Ghidra). First run downloads the Ghidra
#     worker image (~700 MB; one-time, cached afterward).
openbin decompile firmware.elf
```

When the decompile finishes, the CLI prints the project URL — click it (or
paste into your browser) to continue analysis in the web UI.

### Flags

```
openbin apk <app.apk>
    --image string   override the jadx-worker Docker image

openbin decompile <binary>
    --arch  string   architecture hint (auto|x86_64|x86|arm64|arm); default auto
    --name  string   project display name (default: filename)
    --image string   override the Ghidra worker Docker image
```

## Configuration

The CLI defaults to OpenBin's production endpoints. The data plane lives on
`*.openapk.ai` because OpenBin and OpenAPK share one backend + one Keycloak
realm — the CLI brand is OpenBin (native binaries) but the API and auth
domains are the shared ones. Override with env vars if you're self-hosting
or running against staging:

| Variable | Default | Purpose |
|---|---|---|
| `OPENBIN_API_URL` | `https://api.openapk.ai` | Backend base URL (shared) |
| `OPENBIN_AUTH_URL` | `https://auth.openapk.ai` | Keycloak base URL (shared) |
| `OPENBIN_GHIDRA_IMAGE` | `openbin/ghidra-worker:bundled` | Local Ghidra image tag |
| `OPENAPK_JADX_IMAGE` | `openapk/jadx-worker:bundled` | Local jadx image tag |
| `OPENBIN_INSTALL_DIR` | `~/.local/bin` | (installer) binary location |
| `OPENBIN_RELEASE_BASE` | GitHub latest release | Worker-image download mirror |

Credentials are stored at `~/.config/openbin/credentials.json` (mode 0600)
on Linux/macOS and `%APPDATA%\openbin\credentials.json` on Windows. The
access token auto-refreshes when within 30 s of expiry.

## Troubleshooting

**`Cannot connect to the Docker daemon`** — start Docker Desktop (macOS/Windows)
or `sudo systemctl start docker` (Linux).

**`worker image ... not available locally and download failed`** — the CLI
fetches the worker image from the latest GitHub release on first use. Check
your network, or pre-seed `jadx-worker.tar.gz` / `ghidra-worker.tar.gz` into
`~/.local/share/openbin/` for an offline install (see "Offline install" above).

**First decompile is slow** — yes, the worker image (~350 MB jadx / ~700 MB
ghidra) downloads once and `docker load`s into Docker. It's cached in
`~/.local/share/openbin/` afterward, so subsequent runs skip both steps.

**`device code expired before login completed`** — you took too long on the
browser step (usually 10 minutes). Just run `openbin login` again.

**`invalid_client`** — your Keycloak realm doesn't have the `openbin-cli`
public client configured yet. See `core/docker/keycloak/import/realm-openapk.json`
for the exact shape, or hand-add it via the Keycloak admin UI with
"OAuth 2.0 Device Authorization Grant" enabled.

## Privacy

- The binary you decompile stays on your machine. Bytes never go to the
  cloud — only the decompiled JSON does.
- The decompiled JSON includes: function names + decompiled C + disassembly,
  strings, imports, file metadata. It does **not** include raw bytes of
  unanalyzed sections.
- Credentials are stored locally only and used to authenticate POSTs to your
  account's API.

## License

See [LICENSE](https://github.com/openbin-ai/platform/blob/main/LICENSE) at
the repo root.
