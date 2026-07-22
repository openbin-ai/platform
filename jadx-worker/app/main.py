"""FastAPI wrapper around the JADX CLI.

Single endpoint: POST /decompile takes an APK — or a split-APK container
(.xapk / .apks) — runs the bundled jadx binary in a per-request temp dir
under prlimit + timeout caps, and streams the decompiled tree back as a
tar.gz. Split containers are unpacked here and every inner APK is passed
to jadx as its own input (jadx merges dex + resources across inputs
natively; handed the container whole it would treat it as an opaque zip
and dump the inner APKs into resources/).

Synchronous on purpose — the OpenAPK core wraps this call in its own
@Async executor so it never blocks a Spring request thread. Keeping the
worker synchronous means we don't have to ship a separate job store here.
Mirrors the ghidra-worker shape (POST + multipart + sync HTTP).

Containment story:
  * Container = trust boundary. Runs as non-root user `jadx`.
  * Per-request prlimit caps virtual memory and CPU time on the JADX
    subprocess — a hostile APK that tries to balloon memory is killed
    before it can affect the next request.
  * Wall-clock timeout via subprocess kill_after; the worker drops the
    whole request rather than holding a stuck JADX forever.
  * Per-request tempdir, cleaned up on success and failure.
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import shutil
import subprocess
import tempfile
import uuid
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("jadx-worker")

JADX_HOME = Path(os.environ.get("JADX_HOME", "/opt/jadx"))
JADX_BIN = JADX_HOME / "bin" / "jadx"

# Wall-clock cap on the whole JADX run. Bumped well above what a typical
# APK needs — big games (>200MB DEX) can take 5+ minutes legitimately.
JADX_TIMEOUT_SEC = int(os.environ.get("JADX_TIMEOUT_SEC", "900"))

# prlimit cap on the JADX subprocess.
#   CPU = CPU-seconds. Distinct from wall-clock; protects against busy loops.
#
# We intentionally do NOT cap address space (RLIMIT_AS) here. AS = virtual
# memory ceiling, which includes mmap'd jars, thread stacks, JVM metaspace
# and GC reservations — a JADX JVM with -Xmx4g typically reserves 6-8 GiB of
# AS even when actual RSS is well under 1 GiB. Capping AS at "enough heap"
# kills the JVM at startup with "insufficient memory". RSS containment is
# the operator's job at the container layer via docker mem_limit (see
# compose.yaml).
JADX_CPU_LIMIT_SEC = int(os.environ.get("JADX_CPU_LIMIT_SEC", "1200"))

# Hard cap on the upload itself, enforced before we touch disk. Defense in
# depth — the reverse proxy in front of this should also cap, but the worker
# doesn't trust its environment.
MAX_UPLOAD_BYTES = int(os.environ.get("JADX_MAX_UPLOAD_BYTES", str(1024 * 1024 * 1024)))  # 1 GiB

# Shared-secret auth for /decompile. Required in prod: the ECS Express
# gateway endpoint is publicly reachable, so without this anyone who finds
# the hostname can feed us APKs and burn paid CPU. Unset = open (local dev,
# docker compose). /health stays unauthenticated — the ALB health check
# can't send custom headers.
WORKER_TOKEN = os.environ.get("WORKER_TOKEN", "")

# Split-APK container guards. The upload itself is already capped by
# MAX_UPLOAD_BYTES; these bound what we're willing to EXPAND out of it, so a
# crafted container can't zip-bomb the workdir or hand jadx hundreds of inputs.
MAX_SPLIT_APKS = int(os.environ.get("JADX_MAX_SPLIT_APKS", "64"))
MAX_SPLIT_TOTAL_BYTES = int(os.environ.get("JADX_MAX_SPLIT_TOTAL_BYTES", str(4 * 1024 * 1024 * 1024)))  # 4 GiB

app = FastAPI(title="jadx-worker", version="0.1.0")


def _check_token(provided: str | None) -> None:
    if not WORKER_TOKEN:
        return
    if not provided or not hmac.compare_digest(provided, WORKER_TOKEN):
        raise HTTPException(status_code=401, detail="missing or invalid worker token")


def _resolve_inputs(upload_path: Path, work_root: Path, job_id: str) -> list[Path]:
    """Return the file list to feed jadx: [upload] for a plain APK/dex/jar,
    or the unpacked inner APKs for a split container (.xapk / .apks).

    Detection is by content, not extension: a real APK is a zip with
    AndroidManifest.xml at its root; a split container is a zip holding
    *.apk members instead (XAPK adds a manifest.json describing them).
    Inner APKs are extracted under flattened, sanitized names — member
    paths are untrusted input.
    """
    if not zipfile.is_zipfile(upload_path):
        return [upload_path]
    try:
        with zipfile.ZipFile(upload_path) as zf:
            names = zf.namelist()
            if "AndroidManifest.xml" in names:
                return [upload_path]  # ordinary APK
            members = [n for n in names if n.lower().endswith(".apk") and not n.endswith("/")]
            if not members:
                return [upload_path]  # some other zip-ish input; let jadx try
            if len(members) > MAX_SPLIT_APKS:
                raise HTTPException(
                    status_code=413,
                    detail=f"split container holds {len(members)} APKs (limit {MAX_SPLIT_APKS})",
                )

            # Feed jadx the base split first. The XAPK manifest is the
            # authoritative order when present; otherwise name-sort with
            # config.* splits pushed after everything else.
            explicit_order: dict[str, int] = {}
            if "manifest.json" in names:
                try:
                    m = json.loads(zf.read("manifest.json"))
                    for i, s in enumerate(m.get("split_apks", [])):
                        explicit_order[s.get("file", "")] = -1 if s.get("id") == "base" else i
                except Exception:
                    log.warning("job=%s unparseable xapk manifest.json; falling back to name sort", job_id)
            members.sort(key=lambda n: (
                explicit_order.get(n, 10_000),
                Path(n).name.startswith("config."),
                n,
            ))

            splits_dir = work_root / "splits"
            splits_dir.mkdir()
            out: list[Path] = []
            total = 0
            for i, name in enumerate(members):
                info = zf.getinfo(name)
                total += info.file_size
                if total > MAX_SPLIT_TOTAL_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"split container expands past {MAX_SPLIT_TOTAL_BYTES} bytes",
                    )
                dest = splits_dir / f"{i:02d}-{Path(name).name}"
                with zf.open(info) as src, dest.open("wb") as dst:
                    shutil.copyfileobj(src, dst, 1024 * 1024)
                out.append(dest)
            log.info("job=%s split container unpacked: %s", job_id, [p.name for p in out])
            return out
    except zipfile.BadZipFile:
        return [upload_path]


@app.get("/health")
def health() -> dict:
    """Liveness + sanity-check that the jadx CLI is wired up."""
    ok = JADX_BIN.is_file() and os.access(JADX_BIN, os.X_OK)
    return {
        "status": "ok" if ok else "degraded",
        "jadx_home": str(JADX_HOME),
        "jadx_bin_present": ok,
    }


@app.post("/decompile")
async def decompile(
    apk: UploadFile = File(..., description="An APK to decompile"),
    x_worker_token: str | None = Header(default=None),
):
    """Decompile an APK and stream back a tar.gz of the JADX output tree.

    Response body is `application/gzip` containing `tar -cz` of the decompile
    directory (sources/, resources/, AndroidManifest.xml etc.). The core
    extracts this into its ProjectStorage decompile path, then runs the
    existing manifest parser to pull the package name. Worker stays minimal
    on purpose — no manifest parsing here.
    """
    _check_token(x_worker_token)

    if not JADX_BIN.is_file():
        raise HTTPException(status_code=503, detail="jadx binary missing")

    job_id = uuid.uuid4().hex[:12]
    work_root = Path(tempfile.mkdtemp(prefix=f"jadx-{job_id}-"))
    apk_path = work_root / "input.apk"
    out_dir = work_root / "out"
    out_dir.mkdir()

    try:
        # Stream upload to disk in chunks so a huge body never sits in
        # memory all at once. Enforce MAX_UPLOAD_BYTES on the way in.
        total = 0
        with apk_path.open("wb") as f:
            while chunk := await apk.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"upload exceeds limit of {MAX_UPLOAD_BYTES} bytes",
                    )
                f.write(chunk)

        log.info("job=%s received apk size=%d bytes", job_id, total)

        # Split containers (.xapk/.apks) expand into one input per inner APK;
        # plain APKs pass through as a single-element list.
        inputs = _resolve_inputs(apk_path, work_root, job_id)

        # Run jadx under prlimit. Flags mirror the previous in-JVM JadxArgs:
        #   --show-bad-code   = setShowInconsistentCode(true)
        #   (resources + sources both included by default)
        cmd = [
            "prlimit",
            f"--cpu={JADX_CPU_LIMIT_SEC}",
            str(JADX_BIN),
            "--show-bad-code",
            "-d", str(out_dir),
            *[str(p) for p in inputs],
        ]
        log.info("job=%s running: %s", job_id, " ".join(cmd))

        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=JADX_TIMEOUT_SEC,
                check=False,
            )
        except subprocess.TimeoutExpired:
            log.warning("job=%s jadx timed out after %ds", job_id, JADX_TIMEOUT_SEC)
            return JSONResponse(
                status_code=504,
                content={"error": f"jadx timed out after {JADX_TIMEOUT_SEC}s"},
            )

        # Count what JADX actually produced. The sources/ dir is the load-
        # bearing output — empty resources/ is fine, empty sources/ is not.
        sources_dir = out_dir / "sources"
        sources_count = sum(1 for _ in sources_dir.rglob("*") if _.is_file()) if sources_dir.exists() else 0

        # JADX writes its progress + most error messages to stdout, not stderr,
        # so we log both regardless of exit code. Crucial for diagnosing
        # silent failures (eg an OOM-killed JVM that produced no output).
        log.info("job=%s jadx rc=%d sources=%d stdout=%s stderr=%s",
                 job_id, proc.returncode, sources_count,
                 _abbreviate(proc.stdout), _abbreviate(proc.stderr))

        # JADX exit codes are oddly granular: 0 = no errors, but rc=3 is the
        # normal case for real-world APKs with `--show-bad-code` because the
        # tool returns non-zero whenever ANY class failed to decompile cleanly
        # (almost every production APK has obfuscated edge-cases that trip
        # this). The useful signal is whether sources/ actually has files —
        # if yes, accept the partial output; if no, the run was a hard failure
        # (JVM OOM, malformed APK, invalid args, etc.) and we 502.
        if sources_count == 0:
            return JSONResponse(
                status_code=502,
                content={
                    "error": "jadx produced no source files",
                    "returncode": proc.returncode,
                    "stdout": _abbreviate(proc.stdout),
                    "stderr": _abbreviate(proc.stderr),
                },
            )

        # Stream tar.gz of the out dir. tar reads from disk; the body is
        # produced incrementally as the response is sent. work_root is held
        # open by the closure and removed only after the stream completes.
        tar_cmd = ["tar", "-czf", "-", "-C", str(out_dir), "."]
        tar = subprocess.Popen(tar_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        def stream():
            try:
                assert tar.stdout is not None
                while True:
                    buf = tar.stdout.read(64 * 1024)
                    if not buf:
                        break
                    yield buf
            finally:
                tar.stdout and tar.stdout.close()
                tar.wait(timeout=10)
                shutil.rmtree(work_root, ignore_errors=True)
                log.info("job=%s stream complete, workdir cleaned", job_id)

        return StreamingResponse(
            stream(),
            media_type="application/gzip",
            headers={
                "X-OpenApk-Job-Id": job_id,
                "X-OpenApk-Jadx-Returncode": str(proc.returncode),
                "X-OpenApk-Sources-Count": str(sources_count),
            },
        )

    except HTTPException:
        shutil.rmtree(work_root, ignore_errors=True)
        raise
    except Exception as e:  # noqa: BLE001
        shutil.rmtree(work_root, ignore_errors=True)
        log.exception("job=%s unexpected failure: %s", job_id, e)
        return JSONResponse(status_code=500, content={"error": str(e)})


def _abbreviate(s: str | None, limit: int = 800) -> str:
    if not s:
        return ""
    return s if len(s) <= limit else s[:limit] + "…"
