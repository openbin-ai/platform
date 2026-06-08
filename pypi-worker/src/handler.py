"""Lambda entrypoint. Orchestrates:
  download upload from S3 → extract → parse setup.py/pyproject/METADATA
  → per-.py AST analyze → emit findings JSON + bundle back to S3.

Event shape (identical to script-worker for Spring-side parity):
  { s3Bucket, s3InputKey, projectId }

Response shape:
  { findingsKey, bundleKey, summary }
"""

import os
import re
import shutil
import sys
import tarfile
import tempfile
import time
import traceback

import s3_io
import extractor
import manifest_parser
from analyzer import analyze_source


MAX_FILE_BYTES = int(os.environ.get("MAX_FILE_BYTES", str(10 * 1024 * 1024)))
MAX_FILES = int(os.environ.get("MAX_FILES", "2000"))
MAX_AST_BYTES = int(os.environ.get("MAX_AST_BYTES", str(512 * 1024)))
ANALYZED_EXTENSIONS = {".py"}


def handler(event, context):
    started_at = time.time()
    s3_bucket = (event or {}).get("s3Bucket")
    s3_input_key = (event or {}).get("s3InputKey")
    project_id = (event or {}).get("projectId")
    if not s3_bucket or not s3_input_key or not project_id:
        raise RuntimeError("event missing s3Bucket / s3InputKey / projectId")

    work_root = tempfile.mkdtemp(prefix=f"pypi-{project_id}-")
    input_path = os.path.join(work_root, "input.bin")
    extract_dir = os.path.join(work_root, "extract")
    bundle_path = os.path.join(work_root, "bundle.tgz")
    findings_key = f"scripts/{project_id}/findings.json"
    bundle_key = f"scripts/{project_id}/deobfuscated.tgz"

    try:
        s3_io.download_to_file(s3_bucket, s3_input_key, input_path)
        try:
            ext_meta = extractor.extract(input_path, extract_dir)
        except Exception as e:
            # Surface zip/tar problems as a worker error so Spring can map
            # the message to a friendlier 400 (Datadog encrypted dataset).
            raise RuntimeError(str(e))
        print(f"extracted format={ext_meta['format']} entries={ext_meta['entryCount']}", file=sys.stderr)

        pkg_info = manifest_parser.parse(extract_dir)
        findings = manifest_parser.install_hook_findings(pkg_info)

        analysis_root = pkg_info.get("packageRoot") or extract_dir
        py_files = _walk_analyzable(analysis_root)

        for file in py_files[:MAX_FILES]:
            rel = os.path.relpath(file, analysis_root)
            try:
                stat = os.stat(file)
            except OSError:
                continue
            if stat.st_size > MAX_FILE_BYTES:
                findings.append(_skip_finding(rel, stat.st_size))
                continue
            try:
                with open(file, "r", encoding="utf-8", errors="replace") as f:
                    source = f.read()
            except OSError:
                continue
            if len(source) > MAX_AST_BYTES:
                findings.extend(_regex_scan(source, rel))
            else:
                findings.extend(analyze_source(source, rel, deobf_flag=False))

        _upgrade_install_hook_severity(findings)

        findings.sort(key=lambda f: (_sev_rank(f["severity"]), f["file"], f["line"]))
        for i, f in enumerate(findings):
            f["id"] = f"f-{i+1:04d}"

        findings_json = {
            "schemaVersion": 1,
            "analyzedAt": _iso_now(),
            "durationMs": int((time.time() - started_at) * 1000),
            "summary": {
                "fileCount": len(py_files),
                "tarballEntryCount": ext_meta["entryCount"],
                "findingCount": len(findings),
                "countsBySeverity": _counts_by_severity(findings),
                "package": _package_summary(pkg_info),
                "deobfuscatedFileCount": 0,
                "ecosystem": "pypi",
            },
            "findings": findings,
        }

        s3_io.upload_json(s3_bucket, findings_key, findings_json)
        _pack_bundle(analysis_root, bundle_path)
        s3_io.upload_file(s3_bucket, bundle_key, bundle_path, "application/gzip")

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


# -----------------------------------------------------------------------


def _walk_analyzable(root: str) -> list:
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in {
            "__pycache__", ".git", "node_modules", ".tox", ".venv", "venv",
        }]
        for name in filenames:
            if os.path.splitext(name)[1].lower() in ANALYZED_EXTENSIONS:
                out.append(os.path.join(dirpath, name))
    return out


def _skip_finding(file: str, size_bytes: int) -> dict:
    return {
        "rule": "oversized-file",
        "severity": "HIGH",
        "file": file,
        "line": 0,
        "column": 0,
        "message": (
            f"File {file} is {size_bytes / 1024 / 1024:.1f} MB — too large to analyze in full. "
            f"Hostile Python files at this size are typically a single base64 blob feeding exec(); manual review required."
        ),
        "snippet": "",
        "remediation": "Open the file by hand; look for exec(), base64.b64decode + exec, or marshal.loads.",
        "evidence": {"sizeBytes": size_bytes},
        "deobfuscated": False,
    }


_RX_EVAL = re.compile(r"\beval\s*\(")
_RX_EXEC = re.compile(r"\bexec\s*\(")
_RX_SUBPROC = re.compile(r"\b(subprocess|os)\.(system|popen|run|Popen|call|check_call|check_output|getoutput)\s*\(")
_RX_OS_ENV = re.compile(r"os\.environ(?:\.get)?\s*[\(\[]\s*['\"]([A-Z][A-Z0-9_]*)['\"]")
_RX_GETENV = re.compile(r"os\.getenv\s*\(\s*['\"]([A-Z][A-Z0-9_]*)['\"]")
_RX_URLLIB = re.compile(r"(urllib\.request\.urlopen|requests\.(get|post|put)|httpx\.(get|post))\s*\(\s*['\"]([^'\"]+)['\"]")

_SENSITIVE_ENV_RX = re.compile(r"^(AWS_|NPM_TOKEN|GH_TOKEN|GITHUB_TOKEN|DOCKER_|NODE_AUTH_TOKEN|GCP_|AZURE_|VAULT_|SLACK_TOKEN|STRIPE_|TWILIO_|SENDGRID_|PYPI_|TWINE_|POETRY_)")
_KNOWN_C2_RX = re.compile(r"(discord\.com/api/webhooks|webhook\.site|requestbin\.(net|com)|pastebin\.com/raw|transfer\.sh|t\.me/[A-Za-z0-9_]+|ipinfo\.io|workers\.dev/[a-z0-9-]+/(api|exfil|drop))", re.I)


def _regex_scan(source: str, file: str) -> list:
    """Fallback for files Babel-... err, ast.parse can't handle in time.
    Less precise than the AST pass but never returns silence on hostile
    input."""
    findings = []
    line_offsets = [0]
    for i, c in enumerate(source):
        if c == "\n":
            line_offsets.append(i + 1)

    def line_of(idx: int) -> int:
        lo, hi = 0, len(line_offsets) - 1
        while lo <= hi:
            mid = (lo + hi) // 2
            if line_offsets[mid] <= idx:
                lo = mid + 1
            else:
                hi = mid - 1
        return hi + 1

    def push(rule: str, severity: str, idx: int, message: str, evidence: dict | None = None) -> None:
        findings.append({
            "rule": rule, "severity": severity, "file": file,
            "line": line_of(idx), "column": 0, "message": message,
            "snippet": source[idx:idx+80].replace("\n", " ")[:160],
            "remediation": "", "evidence": evidence or {}, "deobfuscated": False,
        })

    if (m := _RX_EVAL.search(source)):
        push("eval-surface", "HIGH", m.start(), "eval() detected via regex pre-scan (file too large for AST)", {"kind": "eval"})
    if (m := _RX_EXEC.search(source)):
        push("eval-surface", "HIGH", m.start(), "exec() detected via regex pre-scan", {"kind": "exec"})
    if (m := _RX_SUBPROC.search(source)):
        push("spawn", "HIGH", m.start(), f"{m.group(0).strip()} detected via regex pre-scan", {"call": m.group(0)})

    seen_env = set()
    for m in _RX_OS_ENV.finditer(source):
        env = m.group(1)
        if env in seen_env or not _SENSITIVE_ENV_RX.match(env):
            continue
        seen_env.add(env)
        push("secret-theft", "CRITICAL", m.start(), f"Reads sensitive env var {env} (regex pre-scan)", {"envVar": env})
        if len(seen_env) >= 10:
            break
    for m in _RX_GETENV.finditer(source):
        env = m.group(1)
        if env in seen_env or not _SENSITIVE_ENV_RX.match(env):
            continue
        seen_env.add(env)
        push("secret-theft", "CRITICAL", m.start(), f"Reads sensitive env var {env} (regex pre-scan)", {"envVar": env})

    for m in _RX_URLLIB.finditer(source):
        target = m.group(4)
        push("net-exfil", "HIGH", m.start(), f"{m.group(1)}() to {target} (regex pre-scan)", {"call": m.group(1), "target": target})
        if _KNOWN_C2_RX.search(target):
            push("known-c2", "CRITICAL", m.start(), f"URL {target} matches a known-bad indicator", {"indicator": target})

    return findings


def _counts_by_severity(findings: list) -> dict:
    counts = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "INFO": 0}
    for f in findings:
        sev = f.get("severity")
        if sev in counts:
            counts[sev] += 1
    return counts


def _package_summary(info: dict) -> dict:
    if not info.get("found"):
        return {"found": False}
    return {
        "found": True,
        "name": info.get("name"),
        "version": info.get("version"),
        "description": info.get("description"),
        "maintainerCount": len(info.get("maintainers") or []),
        "dependencyCount": info.get("dependencyCount", 0),
        "hasInstallHook": info.get("hasInstallHook", False),
        "installHooks": [
            {"key": h.get("key"), "script": h.get("script", "")}
            for h in (info.get("hooks") or [])
        ],
        "parseError": info.get("parseError"),
    }


def _upgrade_install_hook_severity(findings: list) -> None:
    """Mirror of the NPM-side escalation: if an install-hook references a
    file that already raises CRITICAL/HIGH findings, the chain is wired up
    — bump the hook itself to CRITICAL."""
    hooks = [f for f in findings if f["rule"] == "install-hook"]
    if not hooks:
        return
    dangerous_files = set()
    for f in findings:
        if f["rule"] == "install-hook":
            continue
        if f["severity"] in {"CRITICAL", "HIGH"}:
            dangerous_files.add(f["file"])
    for h in hooks:
        script = (h.get("evidence") or {}).get("script") or ""
        targets = [df for df in dangerous_files if df in script or os.path.basename(df) in script]
        if targets:
            h["severity"] = "CRITICAL"
            h["message"] += f" — referenced file {targets[0]} carries high-severity findings"


def _sev_rank(s: str) -> int:
    return {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "INFO": 3}.get(s, 4)


def _pack_bundle(analysis_root: str, out_path: str) -> None:
    """Pack the analyzed tree into a tar.gz in the same shape the frontend
    bundle viewer already understands: `manifest.json` + `original/` tree.
    No `deobfuscated/` for PyPI yet — no Python deobfuscator wired."""
    stage = os.path.join(os.path.dirname(out_path), "stage")
    original = os.path.join(stage, "original")
    os.makedirs(original, exist_ok=True)
    _copy_tree(analysis_root, original)
    manifest = {"schemaVersion": 1, "deobfuscatedFiles": []}
    import json
    with open(os.path.join(stage, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    with tarfile.open(out_path, "w:gz") as tar:
        tar.add(os.path.join(stage, "manifest.json"), arcname="manifest.json")
        tar.add(original, arcname="original")


def _copy_tree(src: str, dst: str) -> None:
    for dirpath, dirnames, filenames in os.walk(src):
        rel = os.path.relpath(dirpath, src)
        target = dst if rel == "." else os.path.join(dst, rel)
        os.makedirs(target, exist_ok=True)
        for name in filenames:
            try:
                shutil.copyfile(os.path.join(dirpath, name), os.path.join(target, name))
            except OSError:
                pass


def _iso_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
