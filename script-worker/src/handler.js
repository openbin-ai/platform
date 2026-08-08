// Lambda entrypoint. Two operations, dispatched on `event.op`:
//
//   op: 'analyze' (default — the shape core has always sent)
//     download tarball from S3 → extract → parse package.json → per-file
//     deobfuscate + AST analyze → emit findings JSON + bundle back to S3.
//     Event:    { s3Bucket, s3InputKey, projectId }
//     Response: { findingsKey, bundleKey, summary }
//
//   op: 'deobfuscate' (on-demand, analyst pressed the button on one file)
//     pull that one file out of the analysis bundle already in S3, run the
//     requested engine (or auto-select), return the source inline. No S3
//     write and no findings mutation — this is a read-only view transform,
//     so re-running it with a different engine is free and idempotent.
//     Event:    { s3Bucket, projectId, filePath, engine, bundleKey? }
//     Response: { engine, used, source, note, attempts, truncated }
//
// Errors surface as `{ error: '...' }` with non-2xx semantics in the
// Lambda invocation result (caller decides how to treat).

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const tar = require('tar');

const s3io = require('./s3-io');
const archive = require('./extract');
const pkgParser = require('./package-json-parser');
const { tryDeobfuscate } = require('./deobfuscator');
const { deobfuscateOnDemand, ENGINE_IDS } = require('./engines');
const { analyzeSource } = require('./analyzer');

// 10 MB per file. Real malicious payloads run huge — the Red Hat
// preinstall droppers are 4 MB single-line `eval(...)` calls with a
// 60k-element decode array. A cap below that silently hides the worst
// findings, which is worse than burning a few extra CPU seconds.
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES || 10 * 1024 * 1024);
const MAX_FILES = Number(process.env.MAX_FILES || 2000);
// AST analysis itself has a separate, lower ceiling — Babel's parser is
// O(n²) on adversarially-large single-line files. Above this we fall back
// to a regex pre-scan that still catches the obvious smells (eval,
// new Function, known-c2 hosts) without burning the full Lambda timeout.
const MAX_AST_BYTES = Number(process.env.MAX_AST_BYTES || 512 * 1024);
const ANALYZED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts']);

exports.handler = async (event, context) => {
  if (event && event.op === 'deobfuscate') {
    return deobfuscateFile(event);
  }
  return analyzePackage(event);
};

async function analyzePackage(event) {
  const startedAt = Date.now();
  const { s3Bucket, s3InputKey, projectId } = event || {};
  if (!s3Bucket || !s3InputKey || !projectId) {
    throw new Error('event missing s3Bucket / s3InputKey / projectId');
  }

  const workRoot = await fsp.mkdtemp(path.join(os.tmpdir(), `script-${projectId}-`));
  const tarballPath = path.join(workRoot, 'input.tgz');
  const extractDir = path.join(workRoot, 'extract');
  const deobfDir = path.join(workRoot, 'deobfuscated');
  const bundlePath = path.join(workRoot, 'bundle.tgz');
  const findingsKey = `scripts/${projectId}/findings.json`;
  const bundleKey = `scripts/${projectId}/deobfuscated.tgz`;

  try {
    await s3io.downloadToFile(s3Bucket, s3InputKey, tarballPath);
    const { entryCount, format } = await archive.extract(tarballPath, extractDir);
    console.log(`extracted format=${format} entries=${entryCount}`);

    const pkgInfo = pkgParser.parse(extractDir);
    const findings = pkgParser.installHookFindings(pkgInfo);

    // Walk from the package root (if we found one) so file paths in
    // findings are relative to the package, not the extraction wrapper.
    // Falls back to the extract dir when there's no package.json
    // (single-.js upload, or unparseable manifest).
    const analysisRoot = pkgInfo.packageRoot || extractDir;
    const jsFiles = walkAnalyzable(analysisRoot);
    const deobfFiles = []; // track for the bundle manifest

    for (const file of jsFiles.slice(0, MAX_FILES)) {
      const rel = path.relative(analysisRoot, file);
      const stat = await fsp.stat(file);
      if (stat.size > MAX_FILE_BYTES) {
        // Don't fail silently — a hostile 50 MB single-line file is a
        // strong negative signal on its own. Emit a finding so the user
        // sees something rather than a clean bill of health.
        findings.push(skipFinding(rel, stat.size));
        continue;
      }
      const raw = await fsp.readFile(file, 'utf8');
      const { source: deobfSource, used: deobfUsed } = await tryDeobfuscate(raw);
      if (deobfUsed) {
        const outPath = path.join(deobfDir, rel);
        await fsp.mkdir(path.dirname(outPath), { recursive: true });
        await fsp.writeFile(outPath, deobfSource, 'utf8');
        deobfFiles.push(rel);
      }
      // Babel struggles with adversarially-large single-line files (the
      // Red Hat preinstall droppers are 4 MB on a single line). For those
      // we still want SOMETHING — a regex pre-scan catches the obvious
      // dangerous primitives even without a full AST.
      if (deobfSource.length > MAX_AST_BYTES) {
        findings.push(...regexScan(deobfSource, rel, deobfUsed));
      } else {
        findings.push(...analyzeSource(deobfSource, rel, deobfUsed));
      }
    }

    // Escalate install-hook severity when the hook targets a file that was
    // (a) deobfuscated, or (b) carries an entropy-blob finding — either
    // condition is a strong "obfuscated install hook" signal.
    upgradeInstallHookSeverity(findings, deobfFiles);

    // Assign deterministic IDs after all rules have fired.
    findings.sort((a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      a.file.localeCompare(b.file) || a.line - b.line);
    findings.forEach((f, i) => { f.id = `f-${String(i + 1).padStart(4, '0')}`; });

    const findingsJson = {
      schemaVersion: 1,
      analyzedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      summary: {
        fileCount: jsFiles.length,
        tarballEntryCount: entryCount,
        findingCount: findings.length,
        countsBySeverity: countsBySeverity(findings),
        package: packageSummary(pkgInfo),
        deobfuscatedFileCount: deobfFiles.length,
        ecosystem: 'npm',
      },
      findings,
    };

    await s3io.uploadJson(s3Bucket, findingsKey, findingsJson);
    // Bundle from the package root (when we found one) so the source
    // browser sees `index.js` directly instead of `tmp/tmpXXX/.../package/index.js`.
    await packBundle(analysisRoot, deobfDir, deobfFiles, bundlePath);
    await s3io.uploadFile(s3Bucket, bundleKey, bundlePath, 'application/gzip');

    return {
      findingsKey,
      bundleKey,
      summary: findingsJson.summary,
    };
  } finally {
    // Best-effort scratch cleanup — Lambda /tmp is per-container and small.
    try { await fsp.rm(workRoot, { recursive: true, force: true }); } catch (_) {}
  }
}

// --- on-demand single-file deobfuscation ---------------------------------

// Lambda's synchronous invoke response is hard-capped at 6 MB — and that
// limit applies to the SERIALIZED payload, not the raw source. JSON
// escaping inflates minified/obfuscated JS substantially (every quote,
// backslash and newline doubles; non-ASCII becomes \uXXXX), so a 4 MB
// source can serialize past 6 MB and the invoke fails with an opaque
// "Response payload size exceeded" that loses the whole result. We
// therefore budget against the encoded size and shrink until it fits.
const MAX_RESPONSE_BYTES = Number(process.env.MAX_RESPONSE_BYTES || 5 * 1024 * 1024);

/**
 * Shrink `source` until the whole response fits Lambda's payload limit.
 *
 * Measures the SERIALIZED size (see MAX_RESPONSE_BYTES) and halves the
 * source until it fits, rather than assuming a fixed expansion ratio —
 * escaping cost varies from ~1x for plain ASCII to ~6x for source full of
 * quotes and non-ASCII, which is exactly what obfuscated payloads look
 * like. Truncating beats failing: a analyst can still read the top of a
 * decoded dropper, and `truncated` tells the UI to say so.
 */
function fitToResponseLimit(response) {
  let out = response;
  let encoded = Buffer.byteLength(JSON.stringify(out), 'utf8');
  if (encoded <= MAX_RESPONSE_BYTES) return out;

  let source = out.source || '';
  // Start from a ratio-informed guess, then halve until it fits. Bounded
  // by construction: each pass at least halves the source.
  let budget = Math.floor(source.length * (MAX_RESPONSE_BYTES / encoded) * 0.9);
  while (budget > 1024) {
    source = out.source.slice(0, budget);
    const candidate = { ...out, source, truncated: true };
    encoded = Buffer.byteLength(JSON.stringify(candidate), 'utf8');
    if (encoded <= MAX_RESPONSE_BYTES) return candidate;
    budget = Math.floor(budget / 2);
  }
  // Pathological: even a tiny slice doesn't fit. Drop the source entirely
  // rather than lose the note + attempts the analyst can still act on.
  return {
    ...out,
    source: '',
    truncated: true,
    note: `${out.note} (result too large to return — ${(out.source || '').length} chars)`,
  };
}

/**
 * Deobfuscate ONE file from a project's existing analysis bundle.
 *
 * Reads from the bundle rather than accepting source in the event: the
 * bundle is the authoritative copy of what was analyzed, it keeps the
 * request payload tiny regardless of file size, and it means a caller
 * cannot ask us to burn Lambda CPU on arbitrary attacker-supplied text.
 */
async function deobfuscateFile(event) {
  const startedAt = Date.now();
  const { s3Bucket, projectId, filePath, engine, bundleKey } = event || {};
  if (!s3Bucket || !projectId || !filePath) {
    throw new Error('event missing s3Bucket / projectId / filePath');
  }
  const requestedEngine = engine || 'auto';
  if (requestedEngine !== 'auto' && !ENGINE_IDS.includes(requestedEngine)) {
    throw new Error(`unknown engine '${requestedEngine}'`);
  }

  const workRoot = await fsp.mkdtemp(path.join(os.tmpdir(), `deobf-${projectId}-`));
  const bundlePath = path.join(workRoot, 'bundle.tgz');
  const outDir = path.join(workRoot, 'out');
  try {
    // Caller passes the bundle key recorded on the analysis row; the
    // conventional path is only a fallback for older rows.
    const key = bundleKey || `scripts/${projectId}/deobfuscated.tgz`;
    await s3io.downloadToFile(s3Bucket, key, bundlePath);

    // Extract only the one entry we need. `original/` is the untouched
    // upload tree — always deobfuscate from that, never from a previously
    // deobfuscated copy, so engines are compared on equal footing.
    const wanted = `original/${filePath}`;
    await fsp.mkdir(outDir, { recursive: true });
    await tar.x({ file: bundlePath, cwd: outDir, filter: (p) => p === wanted || p === `./${wanted}` });

    const onDisk = path.join(outDir, wanted);
    let raw;
    try {
      raw = await fsp.readFile(onDisk, 'utf8');
    } catch (_) {
      throw new Error(`file not found in bundle: ${filePath}`);
    }

    const result = deobfuscateOnDemand(raw, requestedEngine);
    const response = fitToResponseLimit({
      ...result,
      truncated: false,
      durationMs: Date.now() - startedAt,
    });
    console.log(
      `deobfuscate project=${projectId} file=${filePath} requested=${requestedEngine} ` +
      `picked=${result.engine} used=${result.used} truncated=${response.truncated} ` +
      `ms=${Date.now() - startedAt}`,
    );
    return response;
  } finally {
    try { await fsp.rm(workRoot, { recursive: true, force: true }); } catch (_) {}
  }
}

// -----------------------------------------------------------------------

// Emitted when a file is too large to open for analysis. The size
// threshold is conservative; legitimate libraries don't ship multi-MB
// single-line JS, so passing it is itself suspicious.
function skipFinding(file, sizeBytes) {
  return {
    rule: 'oversized-file',
    severity: 'HIGH',
    file,
    line: 0,
    column: 0,
    message: `File ${file} is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB — too large to analyze in full. ` +
             `Real-world malicious droppers often hide encoded payloads in oversized single-line files; manual review required.`,
    snippet: '',
    remediation: 'Open the file by hand and look for eval(), new Function(), or numeric-array decoders that reconstruct a hidden payload.',
    evidence: { sizeBytes },
    deobfuscated: false,
  };
}

// Regex pre-scan used when Babel can't (or shouldn't) parse the source —
// adversarially-large files, syntax errors that errorRecovery can't
// salvage. Covers the most decisive subset of rules: eval-surface,
// secret-theft (env reads of credential names), known-c2 string hits,
// child_process invocations. Less precise than the AST pass but never
// returns silence on a hostile input.
const RX_EVAL = /\beval\s*\(/g;
const RX_NEW_FUNCTION = /\bnew\s+Function\s*\(/g;
const RX_PROCESS_ENV = /\bprocess\s*\.\s*env\s*\.\s*([A-Z][A-Z0-9_]*)/g;
const RX_CHILD_PROC = /\b(child_process\.)?(spawn|execSync|exec|execFile|fork)\s*\(/g;
const RX_REQUIRE_CP = /\brequire\s*\(\s*['"]child_process['"]\s*\)/g;
const RX_FETCH = /\bfetch\s*\(\s*['"`]([^'"`]+)['"`]/g;

const SENSITIVE_ENV = /^(AWS_|NPM_TOKEN|GH_TOKEN|GITHUB_TOKEN|DOCKER_|NODE_AUTH_TOKEN|GCP_|AZURE_|VAULT_|SLACK_TOKEN|STRIPE_|TWILIO_|SENDGRID_)/;
const KNOWN_C2 = /(discord\.com\/api\/webhooks|webhook\.site|requestbin\.(net|com)|pastebin\.com\/raw|transfer\.sh|t\.me\/[A-Za-z0-9_]+|ipinfo\.io|npmjs\.help|workers\.dev\/[a-z0-9-]+\/(api|exfil|drop))/i;

function regexScan(source, file, deobfFlag) {
  const findings = [];
  const lineOffsets = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineOffsets.push(i + 1);
  const lineOf = (idx) => {
    let lo = 0, hi = lineOffsets.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineOffsets[mid] <= idx) lo = mid + 1; else hi = mid - 1;
    }
    return hi + 1;
  };
  const snippetAt = (idx, len) => source.slice(idx, idx + len).replace(/\s+/g, ' ').slice(0, 160);
  const push = (rule, severity, idx, message, evidence) => findings.push({
    rule, severity, file, line: lineOf(idx), column: 0, message,
    snippet: snippetAt(idx, 80), remediation: '', evidence: evidence || {}, deobfuscated: deobfFlag,
  });

  let m;
  RX_EVAL.lastIndex = 0;
  if ((m = RX_EVAL.exec(source))) push('eval-surface', 'HIGH', m.index, 'Direct eval() call detected via regex pre-scan (file too large for full AST analysis)', { kind: 'eval' });
  RX_NEW_FUNCTION.lastIndex = 0;
  if ((m = RX_NEW_FUNCTION.exec(source))) push('eval-surface', 'HIGH', m.index, 'new Function(...) detected via regex pre-scan', { kind: 'new-function' });
  RX_REQUIRE_CP.lastIndex = 0;
  if ((m = RX_REQUIRE_CP.exec(source))) push('spawn', 'HIGH', m.index, 'require("child_process") detected via regex pre-scan', { kind: 'require-child-process' });
  RX_CHILD_PROC.lastIndex = 0;
  if ((m = RX_CHILD_PROC.exec(source))) push('spawn', 'HIGH', m.index, `${m[0]} detected via regex pre-scan`, { call: m[0].trim() });

  RX_PROCESS_ENV.lastIndex = 0;
  const seenEnv = new Set();
  while ((m = RX_PROCESS_ENV.exec(source)) && seenEnv.size < 10) {
    if (!SENSITIVE_ENV.test(m[1])) continue;
    if (seenEnv.has(m[1])) continue;
    seenEnv.add(m[1]);
    push('secret-theft', 'CRITICAL', m.index, `Reads sensitive env var ${m[1]} (regex pre-scan)`, { envVar: m[1] });
  }

  RX_FETCH.lastIndex = 0;
  while ((m = RX_FETCH.exec(source))) {
    const url = m[1];
    push('net-exfil', 'HIGH', m.index, `fetch() to ${url} (regex pre-scan)`, { call: 'fetch', target: url });
    if (KNOWN_C2.test(url)) {
      push('known-c2', 'CRITICAL', m.index, `URL ${url} matches a known-bad indicator`, { indicator: url });
    }
  }

  return findings;
}

function walkAnalyzable(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        stack.push(p);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (ANALYZED_EXTENSIONS.has(ext)) out.push(p);
      }
    }
  }
  return out;
}

function countsBySeverity(findings) {
  const c = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, INFO: 0 };
  for (const f of findings) {
    if (c[f.severity] != null) c[f.severity] += 1;
  }
  return c;
}

function packageSummary(pkgInfo) {
  if (!pkgInfo.found) return { found: false };
  return {
    found: true,
    name: pkgInfo.name,
    version: pkgInfo.version,
    description: pkgInfo.description,
    maintainerCount: pkgInfo.maintainers.length,
    dependencyCount: pkgInfo.dependencyCount,
    hasInstallHook: pkgInfo.hasInstallHook,
    installHooks: pkgInfo.hooks,
    parseError: pkgInfo.parseError || null,
  };
}

function upgradeInstallHookSeverity(findings, deobfFiles) {
  const hookFindings = findings.filter((f) => f.rule === 'install-hook');
  if (hookFindings.length === 0) return;

  // Build the "high-signal" file set: anything that carries a CRITICAL or
  // HIGH finding, plus anything the deobfuscator touched. Install-hook
  // pointed at any of these means the malicious code chain is wired up
  // through the install path — the canonical supply-chain attack shape.
  const dangerousFiles = new Set(deobfFiles);
  for (const f of findings) {
    if (f.rule === 'install-hook') continue;
    if (f.severity === 'CRITICAL' || f.severity === 'HIGH') {
      dangerousFiles.add(f.file);
    }
  }

  for (const h of hookFindings) {
    const script = h.evidence?.script || '';
    const targets = [...dangerousFiles].filter((df) => script.includes(path.basename(df)) || script.includes(df));
    if (targets.length > 0) {
      // Hook targets a file that already raised flags — this combination
      // is the textbook supply-chain attack shape, bump to CRITICAL.
      h.severity = 'CRITICAL';
      h.message += ` — target file ${targets[0]} carries high-severity findings`;
    }
  }
}

function severityRank(s) {
  return { CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3 }[s] ?? 4;
}

async function packBundle(extractDir, deobfDir, deobfFiles, outPath) {
  const manifest = {
    schemaVersion: 1,
    deobfuscatedFiles: deobfFiles,
  };
  // Write manifest into a temp dir alongside the two trees.
  const stageDir = path.join(path.dirname(outPath), 'stage');
  const originalOut = path.join(stageDir, 'original');
  const deobfOut = path.join(stageDir, 'deobfuscated');
  await fsp.mkdir(stageDir, { recursive: true });
  await copyDir(extractDir, originalOut);
  if (deobfFiles.length > 0) {
    await copyDir(deobfDir, deobfOut);
  }
  await fsp.writeFile(path.join(stageDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await tar.c(
    { gzip: true, file: outPath, cwd: stageDir },
    ['manifest.json', 'original', ...(deobfFiles.length > 0 ? ['deobfuscated'] : [])],
  );
}

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const sp = path.join(src, e.name);
    const dp = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(sp, dp);
    else if (e.isFile()) await fsp.copyFile(sp, dp);
  }
}

// Internals exposed for tests only — the Lambda contract is `handler`.
exports.__test__ = { fitToResponseLimit, MAX_RESPONSE_BYTES };
