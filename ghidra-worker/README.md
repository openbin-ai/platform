# ghidra-worker

A small stateless HTTP service that wraps Ghidra's `analyzeHeadless`.

Two callers in the core:
1. **JNI bridge flow** — POSTs a single `.so` here when the user clicks
   "Analyze" in an APK project's Native tab. Result persists to
   `native_analyses.result_jsonb`.
2. **OpenBin BIN projects** — POSTs the project's primary binary
   (ELF/PE/Mach-O) here at upload time. Result persists to
   `projects.binary_analysis_jsonb`.

Per-function output includes both **decompiled C pseudocode** and a
per-instruction **disassembly listing** (plus xrefs in both directions),
so the OpenBin UI can offer a tab toggle without a second worker call.

Synchronous on purpose — the core handles async/queuing on its side.

## API

```
GET  /health   → { status, ghidra_home, analyze_headless_present }
POST /analyze  multipart {binary: <file>, arch: <string>}
              → application/json (see scripts/extract.py for the shape)
```

## Build

```
docker build -t openapk/ghidra-worker:dev .
```

The default Ghidra version is pinned in the Dockerfile (`GHIDRA_VERSION`
and `GHIDRA_BUILD` ARGs). Override at build time if you want a newer release:

```
docker build \
  --build-arg GHIDRA_VERSION=11.3.2 \
  --build-arg GHIDRA_BUILD=20250415 \
  --build-arg GHIDRA_SHA256=<sha256-of-the-release-zip> \
  -t openapk/ghidra-worker:dev .
```

Pass `--build-arg GHIDRA_SHA256=<hex>` to verify the download. Leave blank to skip.

## Run locally

```
docker run --rm -p 8000:8000 openapk/ghidra-worker:dev
```

Smoke-test:

```
curl -s http://localhost:8000/health | jq
curl -s -F "binary=@some/libnative.so" -F "arch=arm64-v8a" \
     http://localhost:8000/analyze | jq '.metadata'
```

Point the OpenAPK core at it with `OPENAPK_GHIDRA_WORKER_URL=http://localhost:8000`.

## Tunables

| Env var                  | Default | Notes                                                                                  |
|--------------------------|---------|----------------------------------------------------------------------------------------|
| `GHIDRA_ANALYZE_TIMEOUT` | `900`   | Inner subprocess timeout in seconds (caller's HTTP timeout is the outer cap).          |
| `LOG_LEVEL`              | `INFO`  | Standard Python logging level.                                                         |

Per-binary caps live in `scripts/extract.py` (`MAX_FUNCTIONS`,
`MAX_STRINGS`, `MAX_IMPORTS`, `MAX_DISASM_LINES_PER_FUNCTION`,
`MAX_XREFS_PER_DIRECTION`). Bump if you hit a binary that wants more.

## Per-function payload

Each entry in the `functions[]` array has:

| Field          | Notes                                                                       |
|----------------|-----------------------------------------------------------------------------|
| `name`         | Symbol name (mangled or demangled per Ghidra's analyzer settings).          |
| `address`      | Entry-point address as a hex string.                                        |
| `size`         | Body size in addresses.                                                     |
| `signature`    | Full prototype string.                                                      |
| `decompiled`   | C pseudocode from the decompiler. `null` for external/thunk functions.      |
| `disassembly`  | Array of `{addr, text}` per instruction. `null` for external/thunk; tail truncated to `MAX_DISASM_LINES_PER_FUNCTION`. |
| `xrefs`        | `{callers: [...], callees: [...]}` — dedup-by-name, capped per direction.   |
| `external`     | True if Ghidra classified this as an external symbol (PLT slot, import).    |
| `thunk`        | True if Ghidra classified this as a thunk (trampoline).                     |
