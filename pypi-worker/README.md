# pypi-worker

AWS Lambda container image — JS-2 sibling of `script-worker`. Statically
analyzes PyPI uploads (sdist `.tar.gz`, wheel `.whl`, loose `.py`) for
malicious-supply-chain patterns. Invoked by the core when a SCRIPT
project upload sniffs as PyPI.

## Event + response

Same shape as `script-worker` — Spring dispatches based on archive
contents but the two workers are otherwise drop-in compatible:

```jsonc
// event
{
  "s3Bucket":  "openbin-analysis-prod",
  "s3InputKey": "scripts/<projectId>/input.tgz",
  "projectId": "<uuid>"
}

// response
{
  "findingsKey": "scripts/<projectId>/findings.json",
  "bundleKey":   "scripts/<projectId>/deobfuscated.tgz",
  "summary": {
    "fileCount": 7,
    "tarballEntryCount": 12,
    "findingCount": 5,
    "countsBySeverity": { "CRITICAL": 1, "HIGH": 3, "MEDIUM": 0, "INFO": 1 },
    "package": { "name": "evil-pkg", "version": "1.2.3", "hasInstallHook": true },
    "deobfuscatedFileCount": 0,
    "ecosystem": "pypi"
  }
}
```

## What fires findings

| Rule | Severity | What fires it (Python) |
|---|---|---|
| `secret-theft` | CRITICAL | `os.environ.get('AWS_*')`, `os.getenv('TWINE_PASSWORD')`, etc. |
| `fs-traversal` | CRITICAL | string literal references `~/.aws`, `~/.ssh`, `.pypirc`, `.env`, etc. |
| `known-c2` | CRITICAL | string literal matches the indicator seed list |
| `net-exfil` | HIGH | `urllib.request.urlopen`, `requests.post`, `httpx.get`, `socket.connect` |
| `eval-surface` | HIGH | `eval`, `exec`, `compile`, `__import__(<computed>)` |
| `spawn` | HIGH | `os.system`, `subprocess.run` (escalated when `shell=True`) |
| `install-hook` | MEDIUM / HIGH / CRITICAL | top-level RCE in `setup.py`, custom `cmdclass`, non-stdlib PEP-517 backend |
| `entropy-blob` | INFO | string literal length > 200 and Shannon entropy > 4.5 |

PyPI's install-hook surface is different from npm's: there's no
`scripts.postinstall` in a manifest — instead, `pip install` runs
`setup.py` directly with the user's interpreter, so we treat *any
top-level side-effect call* in setup.py as the hook surface.

## Build + deploy

```bash
docker build -t openapk/pypi-worker:dev .
./push-to-ecr.sh pypi-worker     # adds pypi-worker handling in the script
```

Lambda function name: `openapk-pypi-worker` (created once via the
Console; see `memory/js_script_analyzer_plan.md`).

## Tunables (env vars)

| var | default | meaning |
|---|---|---|
| `MAX_FILE_BYTES` | `10485760` (10 MiB) | per-file ceiling |
| `MAX_FILES` | `2000` | per-package cap |
| `MAX_AST_BYTES` | `524288` (512 KiB) | above this we fall back to regex pre-scan |

## Non-goals

- Dependency-tree resolution against the live PyPI registry — defer
- Maintainer-change detection — defer
- Dynamic analysis / sandbox — out of scope, same as JS-1
