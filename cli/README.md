# OpenAPK CLI

Decompile native binaries on your own machine and push the results to your
OpenAPK account. Your binary never leaves your laptop — only the decompiled
JSON (function listings, strings, imports, metadata) is uploaded.

## Install

1. Download the latest release tarball for your platform from
   <https://github.com/openbin-ai/platform/releases/latest>:
   - `openapk-cli-<version>-linux-amd64.tar.gz`
   - `openapk-cli-<version>-linux-arm64.tar.gz`
   - `openapk-cli-<version>-darwin-amd64.tar.gz` (Intel Mac)
   - `openapk-cli-<version>-darwin-arm64.tar.gz` (Apple Silicon)
   - `openapk-cli-<version>-windows-amd64.tar.gz`

2. Extract:

   ```bash
   tar xzf openapk-cli-*-linux-amd64.tar.gz
   cd openapk-cli-*-linux-amd64
   ```

3. (Linux/macOS) Mark the binary executable if your archive tool stripped
   the bit:

   ```bash
   chmod +x openapk
   ```

The extracted directory looks like this:

```
openapk-cli-v0.1.0-linux-amd64/
├── openapk              ← the CLI binary
├── ghidra-worker.tar.gz ← bundled Ghidra Docker image (~1 GB)
└── README.md            ← this file
```

## Requirements

- **Docker** running on your machine ([install](https://docs.docker.com/get-docker/)).
  Used to run the local Ghidra worker — no other Ghidra install needed.
- An **OpenAPK account** at <https://openapk.ai> (free).

## Usage

```bash
# 1. Sign in (one-time per machine). Opens your browser; paste the short code
#    shown, then come back to the terminal.
./openapk login

# 2. Confirm it worked:
./openapk whoami

# 3. Decompile a binary. First run loads the bundled Ghidra image into Docker
#    (~1 GB; one-time). Subsequent runs skip that step.
./openapk decompile firmware.elf
```

When the decompile finishes, the CLI prints the project URL — click it (or
paste into your browser) to continue analysis in the OpenAPK web UI.

### Flags

```
openapk decompile <binary>
    --arch  string   architecture hint (auto|x86_64|x86|arm64|arm); default auto
    --name  string   project display name (default: filename)
    --image string   override the Ghidra worker Docker image
```

## Configuration

The CLI defaults to OpenAPK's production endpoints. Override with env vars
(useful for self-hosters or staging):

| Variable | Default | Purpose |
|---|---|---|
| `OPENAPK_API_URL` | `https://api.openapk.ai` | Backend base URL |
| `OPENAPK_AUTH_URL` | `https://auth.openapk.ai` | Keycloak base URL |
| `OPENAPK_GHIDRA_IMAGE` | `openapk/ghidra-worker:bundled` | Local Docker image tag |

Credentials are stored at `~/.config/openapk/credentials.json` (mode 0600)
on Linux/macOS and `%APPDATA%\openapk\credentials.json` on Windows. The
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
browser step (usually 10 minutes). Just run `openapk login` again.

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
