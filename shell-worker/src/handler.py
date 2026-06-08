"""Lambda entrypoint for the shell-worker (JS-3).

Same event/response shape as script-worker + pypi-worker — Spring routes
between the three based on filename + magic + archive contents, and the
findings JSON schema is identical so the DB column / frontend / AI prompt
builder don't fork.

Event shape:
  { s3Bucket, s3InputKey, projectId, originalName? }
Response shape:
  { findingsKey, bundleKey, summary }
"""

import json
import os
import shutil
import sys
import tarfile
import tempfile
import time
import traceback

import s3_io
import extractor
from analyzer import analyze_source


MAX_FILE_BYTES = int(os.environ.get("MAX_FILE_BYTES", str(5 * 1024 * 1024)))
MAX_FILES = int(os.environ.get("MAX_FILES", "2000"))
ANALYZED_EXTENSIONS = {".ps1", ".psm1", ".sh", ".bash", ".zsh", ".fish"}


def handler(event, _context):
    started_at = time.time()
    bucket = (event or {}).get("s3Bucket")
    key = (event or {}).get("s3InputKey")
    pid = (event or {}).get("projectId")
    original_name = (event or {}).get("originalName")
    if not bucket or not key or not pid:
        raise RuntimeError("event missing s3Bucket / s3InputKey / projectId")

    work_root = tempfile.mkdtemp(prefix=f"shell-{pid}-")
    input_path = os.path.join(work_root, "input.bin")
    extract_dir = os.path.join(work_root, "extract")
    bundle_path = os.path.join(work_root, "bundle.tgz")
    findings_key = f"scripts/{pid}/findings.json"
    bundle_key = f"scripts/{pid}/deobfuscated.tgz"

    try:
        s3_io.download_to_file(bucket, key, input_path)
        ext_meta = extractor.extract(input_path, extract_dir, original_name)
        print(f"extracted format={ext_meta['format']} entries={ext_meta['entryCount']}", file=sys.stderr)

        files = _walk_analyzable(extract_dir)
        findings: list = []

        for f in files[:MAX_FILES]:
            rel = os.path.relpath(f, extract_dir)
            try:
                size = os.stat(f).st_size
            except OSError:
                continue
            if size > MAX_FILE_BYTES:
                findings.append(_skip_finding(rel, size))
                continue
            try:
                with open(f, "r", encoding="utf-8", errors="replace") as fh:
                    source = fh.read()
            except OSError:
                continue
            language = _language_for(rel, source)
            findings.extend(analyze_source(source, rel, language))

        findings.sort(key=lambda f: (_sev_rank(f["severity"]), f["file"], f["line"]))
        for i, f in enumerate(findings):
            f["id"] = f"f-{i+1:04d}"

        findings_json = {
            "schemaVersion": 1,
            "analyzedAt": _iso_now(),
            "durationMs": int((time.time() - started_at) * 1000),
            "summary": {
                "fileCount": len(files),
                "tarballEntryCount": ext_meta["entryCount"],
                "findingCount": len(findings),
                "countsBySeverity": _counts(findings),
                "package": {"found": False},
                "deobfuscatedFileCount": 0,
                "ecosystem": "shell",
            },
            "findings": findings,
        }

        s3_io.upload_json(bucket, findings_key, findings_json)
        _pack_bundle(extract_dir, bundle_path)
        s3_io.upload_file(bucket, bundle_key, bundle_path, "application/gzip")

        return {
            "findingsKey": findings_key,
            "bundleKey": bundle_key,
            "summary": findings_json["summary"],
        }
    except Exception:
        traceback.print_exc()
        raise
    finally:
        try:
            shutil.rmtree(work_root, ignore_errors=True)
        except Exception:
            pass


# ---------------------------------------------------------------------------


def _walk_analyzable(root: str) -> list:
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in {".git", "node_modules", "__pycache__"}]
        for name in filenames:
            ext = os.path.splitext(name)[1].lower()
            if ext in ANALYZED_EXTENSIONS:
                out.append(os.path.join(dirpath, name))
                continue
            # Files without a recognized extension but with a shell shebang
            # still count — useful for catching `install` scripts that drop
            # the `.sh` suffix.
            full = os.path.join(dirpath, name)
            try:
                with open(full, "rb") as fh:
                    first = fh.read(64)
                if first.startswith(b"#!") and any(s in first for s in (b"/bin/sh", b"/bin/bash", b"/bin/zsh", b"/bin/dash", b"pwsh")):
                    out.append(full)
            except OSError:
                continue
    return out


def _language_for(rel_path: str, source: str) -> str:
    lower = rel_path.lower()
    if lower.endswith(".ps1") or lower.endswith(".psm1"):
        return "powershell"
    # Shebang fallback — useful for the no-extension case detected by the walker.
    head = source[:200]
    if "pwsh" in head:
        return "powershell"
    return "posix"


def _skip_finding(file: str, size_bytes: int) -> dict:
    return {
        "rule": "oversized-file",
        "severity": "HIGH",
        "file": file,
        "line": 0,
        "column": 0,
        "message": f"File {file} is {size_bytes / 1024 / 1024:.1f} MB — too large to analyze. Manual review required.",
        "snippet": "",
        "remediation": "A shell script over a few MB is almost always carrying an embedded payload. Open by hand.",
        "evidence": {"sizeBytes": size_bytes},
        "deobfuscated": False,
    }


def _counts(findings: list) -> dict:
    out = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "INFO": 0}
    for f in findings:
        sev = f.get("severity")
        if sev in out:
            out[sev] += 1
    return out


def _sev_rank(s: str) -> int:
    return {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "INFO": 3}.get(s, 4)


def _pack_bundle(extract_dir: str, out_path: str) -> None:
    stage = os.path.join(os.path.dirname(out_path), "stage")
    original = os.path.join(stage, "original")
    os.makedirs(original, exist_ok=True)
    for dirpath, _, filenames in os.walk(extract_dir):
        rel = os.path.relpath(dirpath, extract_dir)
        target = original if rel == "." else os.path.join(original, rel)
        os.makedirs(target, exist_ok=True)
        for name in filenames:
            try:
                shutil.copyfile(os.path.join(dirpath, name), os.path.join(target, name))
            except OSError:
                pass
    with open(os.path.join(stage, "manifest.json"), "w") as f:
        json.dump({"schemaVersion": 1, "deobfuscatedFiles": []}, f, indent=2)
    with tarfile.open(out_path, "w:gz") as tar:
        tar.add(os.path.join(stage, "manifest.json"), arcname="manifest.json")
        tar.add(original, arcname="original")


def _iso_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
