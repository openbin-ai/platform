// Lambda entrypoint. Orchestrates: download tarball from S3 → extract →
// parse package.json → per-file deobfuscate + AST analyze → emit findings
// JSON + deobfuscated bundle back to S3.
//
// Event shape:
//   { s3Bucket, s3InputKey, projectId }
// Response shape:
//   { findingsKey, bundleKey, summary }
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
const { analyzeSource } = require('./analyzer');

const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES || 2 * 1024 * 1024); // 2MB per file
const MAX_FILES = Number(process.env.MAX_FILES || 2000);                     // package cap
const ANALYZED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts']);

exports.handler = async (event, context) => {
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

    const jsFiles = walkAnalyzable(extractDir);
    const deobfFiles = []; // track for the bundle manifest

    for (const file of jsFiles.slice(0, MAX_FILES)) {
      const rel = path.relative(extractDir, file);
      const stat = await fsp.stat(file);
      if (stat.size > MAX_FILE_BYTES) continue;
      const raw = await fsp.readFile(file, 'utf8');
      const { source: deobfSource, used: deobfUsed } = await tryDeobfuscate(raw);
      if (deobfUsed) {
        const outPath = path.join(deobfDir, rel);
        await fsp.mkdir(path.dirname(outPath), { recursive: true });
        await fsp.writeFile(outPath, deobfSource, 'utf8');
        deobfFiles.push(rel);
      }
      const fileFindings = analyzeSource(deobfSource, rel, deobfUsed);
      findings.push(...fileFindings);
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
      },
      findings,
    };

    await s3io.uploadJson(s3Bucket, findingsKey, findingsJson);
    await packBundle(extractDir, deobfDir, deobfFiles, bundlePath);
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
};

// -----------------------------------------------------------------------

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
  const hookTargets = findings
    .filter((f) => f.rule === 'install-hook')
    .map((f) => f.evidence?.script || '');
  if (hookTargets.length === 0) return;
  // crude: if any deobfuscated file's relative path appears in any hook
  // script string, OR the hook script itself contains long base64-ish junk,
  // bump severity to HIGH.
  const entropyFiles = new Set(
    findings.filter((f) => f.rule === 'entropy-blob').map((f) => f.file));
  for (const f of findings) {
    if (f.rule !== 'install-hook') continue;
    const script = f.evidence?.script || '';
    const targetsObfuscated =
      deobfFiles.some((df) => script.includes(df)) ||
      [...entropyFiles].some((ef) => script.includes(ef));
    if (targetsObfuscated) {
      f.severity = 'HIGH';
      f.message += ' — target file is obfuscated or carries encoded payload';
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
