# OpenBin CLI

Decompile native binaries on your own machine and push the results to your
OpenBin account. Your binary never leaves your laptop — only the decompiled
JSON (function listings, strings, imports, metadata) is uploaded.

## Install

1. Download the latest release tarball for your platform from
   <https://github.com/openbin-ai/platform/releases/latest>:
   - `openbin-<version>-linux-amd64.tar.gz`
   - `openbin-<version>-linux-arm64.tar.gz`
   - `openbin-<version>-darwin-amd64.tar.gz` (Intel Mac)
   - `openbin-<version>-darwin-arm64.tar.gz` (Apple Silicon)
   - `openbin-<version>-windows-amd64.tar.gz`

2. Extract:

   ```bash
   tar xzf openbin-*-linux-amd64.tar.gz
   cd openbin-*-linux-amd64
   ```

3. (Linux/macOS) Mark the binary executable if your archive tool stripped
   the bit:

   ```bash
   chmod +x openbin
   ```

The extracted directory looks like this:

```
openbin-v0.1.0-linux-amd64/
├── openbin              ← the CLI binary
├── ghidra-worker.tar.gz ← bundled Ghidra Docker image (~1 GB)
└── README.md            ← this file
```

## Requirements

- **Docker** running on your machine ([install](https://docs.docker.com/get-docker/)).
  Used to run the local Ghidra worker — no other Ghidra install needed.
- An **OpenBin account** at <https://openbin.ai> (free).

## Usage

```bash
# 1. Sign in (one-time per machine). Opens your browser; paste the short code
#    shown, then come back to the terminal.
./openbin login

# 2. Confirm it worked:
./openbin whoami

# 3. Decompile a binary. First run loads the bundled Ghidra image into Docker
#    (~1 GB; one-time). Subsequent runs skip that step.
./openbin decompile firmware.elf
```

When the decompile finishes, the CLI prints the project URL — click it (or
paste into your browser) to continue analysis in the OpenBin web UI.

### Flags

```
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
| `OPENBIN_GHIDRA_IMAGE` | `openbin/ghidra-worker:bundled` | Local Docker image tag |

Credentials are stored at `~/.config/openbin/credentials.json` (mode 0600)
on Linux/macOS and `%APPDATA%\openbin\credentials.json` on Windows. The
access token auto-refreshes when within 30 s of expiry.

## Troubleshooting

**`Cannot connect to the Docker daemon`** — start Docker Desktop (macOS/Windows)
or `sudo systemctl start docker` (Linux).

**`Ghidra image ... not loaded and no ghidra-worker.tar.gz found`** — the
release tarball ships the image next to the binary. If you moved the binary
elsewhere, put `ghidra-worker.tar.gz` in the same directory or in your
current working directory.

**`docker load` is slow on first run** — yes, ~1 GB of image data needs to
decompress and load into Docker. Subsequent runs skip this entirely.

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
