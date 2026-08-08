# script-worker

AWS Lambda container image that statically analyzes NPM tarballs for
malicious-supply-chain patterns. Invoked by the OpenAPK / OpenBin core
when a user uploads a script project (`projects.kind = SCRIPT`).

## Why Lambda?

This is a sporadic, bounded, untrusted workload — the perfect Lambda
shape. Scale-to-zero economics dominate at idle, sub-second cold starts
keep upload UX responsive, and the per-invocation memory/CPU ceiling
caps blast radius for any single hostile package. Cost ceiling at
realistic traffic is ~$5/mo for 100k invocations.

This runs as a Lambda while the heavier workers run as long-lived
services — the divergence is intentional: script analysis is a
sporadic, bounded workload that suits scale-to-zero compute.

## Event + response

Two operations, dispatched on `event.op`. Omitting `op` means `analyze`
(the original shape, kept for compatibility).

### `op: "analyze"` — full package analysis

```jsonc
// event
{
  "s3Bucket": "openapk-media-prod",
  "s3InputKey": "scripts/<projectId>.tgz",
  "projectId": "<uuid>"
}
```

```jsonc
// response
{
  "findingsKey": "scripts/<projectId>/findings.json",
  "bundleKey":   "scripts/<projectId>/deobfuscated.tgz",
  "summary": {
    "fileCount": 12,
    "tarballEntryCount": 24,
    "findingCount": 8,
    "countsBySeverity": { "CRITICAL": 2, "HIGH": 3, "MEDIUM": 1, "INFO": 2 },
    "package": { "name": "evil-pkg", "version": "1.0.1", "hasInstallHook": true, "...": "..." },
    "deobfuscatedFileCount": 2
  }
}
```

### `op: "deobfuscate"` — one file, on demand

Driven by the **Deobfuscate** button in the openbin code viewer, not by
upload. Reads the file out of the analysis bundle already in S3 (so the
request stays tiny and callers can't feed the worker arbitrary text),
runs one engine, and returns the source inline. Writes nothing.

```jsonc
// event
{
  "op": "deobfuscate",
  "s3Bucket": "openapk-media-prod",
  "bundleKey": "scripts/<projectId>/deobfuscated.tgz",  // optional; defaults to this path
  "projectId": "<uuid>",
  "filePath": "lib/index.js",     // relative to the package root
  "engine": "auto"                // auto | obfuscator-io | generic | caesar
}
```

```jsonc
// response
{
  "engine": "obfuscator-io",      // the engine actually used
  "used": true,                   // false = nothing changed (still a valid answer)
  "source": "…deobfuscated code…",
  "note": "Auto-selected obfuscator.io deobfuscator (best of 2 engines…).",
  "score": 41.5, "baselineScore": -12.0,   // readability, higher is better
  "looksObfuscated": true,
  "truncated": false,             // true if clipped to the 4 MB inline cap
  "attempts": [                   // what auto tried, and how it scored
    { "engine": "caesar", "used": false, "score": null, "durationMs": 1 },
    { "engine": "obfuscator-io", "used": true, "score": 41.5, "durationMs": 308 }
  ]
}
```

**Engines.** `obfuscator-io` is [ben-sb/obfuscator-io-deobfuscator]
(string-array revealing, control-flow recovery, anti-tamper removal);
`generic` is [ben-sb/js-deobfuscator]; `caesar` is our own decoder for the
Caesar-over-`fromCharCode` dropper shape. **Neither third-party engine
dominates** — on modern obfuscator.io v4 string-array wrappers both often
fail to resolve the array and manage only structural cleanup, and which one
wins varies per sample. That's why the UI exposes the choice and `auto`
scores real output instead of guessing from signatures alone.

Two integration details worth knowing before editing `src/engines.js`:

- We drive obfuscator-io's `Deobfuscator` class directly rather than its
  `deobfuscate()` helper, because that helper parses with the default
  `sourceType: 'script'` and **throws on any ES module**.
- Both libraries log to stdout (obfuscator-io's `silent` config covers its
  own logger but not `[StringRevealer]` warnings), so calls are wrapped in a
  console mute — without it every invoke floods CloudWatch.

AST engines are synchronous and CPU-bound, so a promise timeout cannot
interrupt them; the real guard is `ONDEMAND_MAX_AST_BYTES` (2 MB default).

[ben-sb/obfuscator-io-deobfuscator]: https://github.com/ben-sb/obfuscator-io-deobfuscator
[ben-sb/js-deobfuscator]: https://github.com/ben-sb/javascript-deobfuscator

## Findings JSON schema (v1)

Persisted by the core to `script_analyses.findings_jsonb` and consumed
by the openbin-frontend ScriptFindings panel + the AI PromptBuilder.

```jsonc
{
  "schemaVersion": 1,
  "analyzedAt": "2026-06-07T12:34:56.000Z",
  "durationMs": 1234,
  "summary": { /* see above */ },
  "findings": [
    {
      "id": "f-0001",
      "rule": "secret-theft",
      "severity": "CRITICAL",
      "file": "lib/index.js",
      "line": 42,
      "column": 8,
      "message": "Reads sensitive environment variable AWS_ACCESS_KEY_ID",
      "snippet": "process.env.AWS_ACCESS_KEY_ID",
      "remediation": "Legitimate packages rarely read credential env vars …",
      "evidence": { "envVar": "AWS_ACCESS_KEY_ID" },
      "deobfuscated": false
    }
  ]
}
```

Severity is a fixed enum: `CRITICAL` > `HIGH` > `MEDIUM` > `INFO`.

## The 8 rules

| Rule | Severity | What fires it |
|---|---|---|
| `secret-theft` | CRITICAL | `process.env.{AWS_*,NPM_TOKEN,GITHUB_TOKEN,…}` |
| `fs-traversal` | CRITICAL | String literal references `~/.aws`, `~/.ssh`, `.npmrc`, `.env`, … |
| `known-c2` | CRITICAL | String literal matches the indicator seed list |
| `net-exfil` | HIGH | `fetch` / `http(s).request` / `net.connect` / `dgram.createSocket` to a non-local target |
| `eval-surface` | HIGH | `eval`, `new Function()`, `vm.runIn*`, dynamic `require()`, string `setTimeout` |
| `spawn` | HIGH | `child_process.{spawn,exec,execSync,fork}` (escalated if `shell:true`) |
| `install-hook` | MEDIUM / HIGH | `package.json` has `pre/postinstall` (HIGH if target is obfuscated) |
| `entropy-blob` | INFO | String literal length > 200 and Shannon entropy > 4.5 |

## Build

```bash
docker build -t openapk/script-worker:dev .
```

Build with `--platform linux/amd64` for Lambda compatibility (add
`--provenance=false --sbom=false` under buildx — Lambda rejects OCI
attestation manifests).

## Local test with the Lambda Runtime Interface Emulator

The `public.ecr.aws/lambda/nodejs:22` base image bundles the RIE. To
exercise the handler against a real fixture without leaving your laptop:

```bash
# build
docker build -t openapk/script-worker:dev .

# run on port 9000 — RIE exposes a POST /2015-03-31/functions/function/invocations endpoint
docker run --rm -p 9000:8080 \
  -e AWS_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY \
  -e AWS_SESSION_TOKEN=$AWS_SESSION_TOKEN \
  openapk/script-worker:dev

# in another shell
curl -s -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" \
  -d '{"s3Bucket":"<your-test-bucket>","s3InputKey":"scripts/abc-123.tgz","projectId":"abc-123"}' \
  | jq .
```

If you want to skip the S3 round-trip during pure-analyzer development,
use the fixtures-based smoke test instead (see `fixtures/README.md`).

## Tunables (env vars)

| var | default | meaning |
|---|---|---|
| `MAX_FILE_BYTES` | `2097152` (2 MiB) | per-file ceiling — skip larger files |
| `MAX_FILES` | `2000` | per-package cap — analyze first N JS files |
| `DEOBF_TIMEOUT_MS` | `8000` | best-effort cap for the upload-time deobfuscator pass |
| `ONDEMAND_MAX_AST_BYTES` | `2097152` (2 MiB) | input ceiling for on-demand AST engines (`caesar` is exempt) |
| `MAX_INLINE_SOURCE_BYTES` | `4194304` (4 MiB) | on-demand result is truncated above this, to stay under Lambda's 6 MB response cap |
| `AWS_REGION` | `us-east-1` | S3 client region |

## Deploy

Deploy as a container-image Lambda: push the image to your registry,
create the function from it once, then roll new code with `aws lambda
update-function-code --image-uri …`. Point the core at the function via
the `OPENAPK_SCRIPT_ANALYZER_FUNCTION` env var.

## Non-goals (deferred to JS-2 / JS-3 / JS-4)

- `package@version` pull from the registry (tarball-only in JS-1)
- PyPI / Python (JS-2)
- Loose `.ps1` / `.sh` / `.py` / `.js` single-file analysis (JS-3 / JS-4)
- Dynamic analysis / V8 sandbox
- Cross-version diff
- Maintainer-change detection
