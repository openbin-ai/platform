# shell-worker

AWS Lambda container image — JS-3 sibling of `script-worker` (npm) and
`pypi-worker` (PyPI). Statically analyzes loose PowerShell (`.ps1`,
`.psm1`) and POSIX shell scripts (`.sh`, `.bash`, `.zsh`) for malicious
dropper patterns.

## Why regex, not AST

Bash has no stdlib parser in Python; PowerShell's parser
(`System.Management.Automation.Language.Parser`) is .NET-only. Both are
also fundamentally string-and-process languages — the malicious patterns
we care about (`curl | sh`, `IEX(DownloadString(...))`,
`base64 -d | bash`, `powershell -enc <b64>`) are surface-level lexical
tells that regex catches reliably. The trade-off vs an AST: we'll miss
patterns split across a heredoc or a function-rebinding obfuscation
layer. The big-target catch rate is still high.

## Event + response

Same shape as the other two workers, plus an optional `originalName` so
single-file uploads land under a name that preserves the extension:

```jsonc
// event
{
  "s3Bucket": "openbin-analysis-prod",
  "s3InputKey": "scripts/<projectId>/input.tgz",
  "projectId": "<uuid>",
  "originalName": "evil.ps1"
}

// response
{
  "findingsKey": "scripts/<projectId>/findings.json",
  "bundleKey":   "scripts/<projectId>/deobfuscated.tgz",
  "summary": {
    "fileCount": 1,
    "tarballEntryCount": 1,
    "findingCount": 7,
    "countsBySeverity": { "CRITICAL": 3, "HIGH": 4, "MEDIUM": 0, "INFO": 0 },
    "package": { "found": false },
    "deobfuscatedFileCount": 0,
    "ecosystem": "shell"
  }
}
```

## Rules

| Rule | Severity | What fires it |
|---|---|---|
| `eval-surface` | HIGH / CRITICAL | `IEX(...)`, `Invoke-Expression`, `[scriptblock]::Create`, `eval `, `source <(...)`, `curl|sh`, `bash <(curl ...)` |
| `spawn` | HIGH | `Start-Process`, `[Process]::Start`, `bash -c`, `sh -c` |
| `net-exfil` | HIGH | `Invoke-WebRequest`/`IWR`, `Invoke-RestMethod`/`IRM`, `Net.WebClient`, `DownloadString`/`DownloadFile`, `BitsAdmin`, `curl https://`, `wget https://` |
| `encoded-cmd` | CRITICAL | `powershell -enc <b64>`, `[Convert]::FromBase64String`, `base64 -d | sh`, `echo <long-b64> | base64 -d` |
| `secret-theft` | CRITICAL | `$env:AWS_*` / `$env:GITHUB_TOKEN` (PS), `$AWS_*` / `printenv AWS_*` (POSIX) |
| `fs-traversal` | CRITICAL | references to `.aws/credentials`, `.ssh/id_rsa`, `.npmrc`, `.docker/config.json`, Credential Manager / DPAPI vaults |
| `persistence` | HIGH / CRITICAL | autoruns key, `New-Service`, scheduled tasks, Defender exclusions; cron writes, rc-file append, systemd unit, `nohup &` |
| `known-c2` | CRITICAL | string matches the indicator seed list |
| `entropy-blob` | INFO | base64-alphabet runs of 200+ chars with Shannon entropy > 4.5 |

## Build + deploy

```bash
docker build -t openapk/shell-worker:dev .
./push-to-ecr.sh shell-worker
```

Lambda function name: `openapk-shell-worker`. Created once via the AWS
Console or `aws lambda create-function`; see the JS-3 ship notes in
`memory/js_script_analyzer_plan.md`.

## Tunables (env vars)

| var | default | meaning |
|---|---|---|
| `MAX_FILE_BYTES` | `5242880` (5 MiB) | per-file ceiling |
| `MAX_FILES` | `2000` | per-package cap |

## Non-goals

- Dynamic analysis / sandbox — out of scope, same as JS-1 / JS-2
- Cross-script taint tracking — defer
- AST-based detection — explicitly skipped; rules are surface lexical
