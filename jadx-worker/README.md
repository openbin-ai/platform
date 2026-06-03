# jadx-worker

Tiny FastAPI service that wraps the `jadx` CLI. The OpenAPK core POSTs an
APK; the worker runs JADX under `prlimit` + a wall-clock timeout in a
per-request tempdir, then streams the decompiled tree back as `tar.gz`.

Built to mirror `ghidra-worker/`: same image style (multi-stage Dockerfile),
same wire shape (single sync POST, multipart in, body out), same containment
model (container = trust boundary, non-root user, per-request prlimit).

## Why a worker?

JADX used to run in-JVM inside the Spring Boot core. A malicious or
oversized APK could OOM the backend and take every user with it. The worker
moves that blast radius into a disposable container the orchestrator can
recycle.

## API

### `POST /decompile`

Multipart upload.

| field | required | description                |
|-------|----------|----------------------------|
| `apk` | yes      | The APK file to decompile. |

Response: `200 application/gzip` — a `tar -cz` of the decompile output
directory (sources/, resources/, AndroidManifest.xml).

On failure: `4xx/5xx application/json` with `{"error": "..."}`.

Notable response headers:

- `X-OpenApk-Job-Id` — opaque hex id for log correlation.
- `X-OpenApk-Jadx-Returncode` — non-zero is allowed when JADX produced
  partial output (e.g., `--show-bad-code` salvage). The core decides
  whether to accept it.

### `GET /health`

Returns `200` with JSON describing whether the jadx binary is wired up.

## Configuration (env vars)

| var                       | default                      | meaning                                        |
|---------------------------|------------------------------|------------------------------------------------|
| `JADX_HOME`               | `/opt/jadx`                  | Where the jadx release is unpacked.            |
| `JADX_TIMEOUT_SEC`        | `900`                        | Wall-clock cap on a single decompile.          |
| `JADX_CPU_LIMIT_SEC`      | `1200`                       | CPU-time cap on the jadx subprocess.           |
| `JADX_MAX_UPLOAD_BYTES`   | `1073741824` (1 GiB)         | Upload size ceiling, enforced as we stream in. |
| `LOG_LEVEL`               | `INFO`                       | Standard Python logging level.                 |

Memory containment is the container's job, not prlimit's — JADX's JVM
reserves ~6 GiB of virtual address space even with a 1 GiB heap, so an
RLIMIT_AS cap large enough to be useful is the same as no cap. Set
`mem_limit` on the compose service instead; the Linux OOM killer will
take down a runaway JADX inside the container.

## Build + run

```
docker build -t openapk/jadx-worker:dev .
docker run --rm -p 8000:8000 openapk/jadx-worker:dev

# Smoke test
curl -F apk=@some.apk http://localhost:8000/decompile -o out.tar.gz
tar tzf out.tar.gz | head
```

## Pinning JADX

Version is pinned to `1.5.5` via the `JADX_VERSION` build arg so the CLI
output matches what `core/pom.xml` produces today during the in-JVM →
worker cutover. Bump in lockstep with the core pom.

For reproducible builds, pass `--build-arg JADX_SHA256=<hex>` to verify the
downloaded release zip against a known-good checksum (look it up at
https://github.com/skylot/jadx/releases).
