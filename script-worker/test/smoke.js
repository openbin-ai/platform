// Smoke test — runs the analyzer pipeline against a fixture tarball
// WITHOUT touching S3. Use this to iterate on rules locally; for the
// full Lambda handler path use the RIE recipe in README.md.
//
// Usage:
//   node test/smoke.js fixtures/malicious-pkg-1.0.0.tgz
//   node test/smoke.js fixtures/benign-pkg-1.0.0.tgz

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const tarball = require('../src/tar-extract');
const pkgParser = require('../src/package-json-parser');
const { tryDeobfuscate } = require('../src/deobfuscator');
const { analyzeSource } = require('../src/analyzer');

const ANALYZED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts']);

async function main() {
  const tarballPath = process.argv[2];
  if (!tarballPath) {
    console.error('usage: node test/smoke.js <path-to-tarball>');
    process.exit(2);
  }
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'smoke-'));
  const extractDir = path.join(work, 'extract');

  await tarball.extract(tarballPath, extractDir);
  const pkgInfo = pkgParser.parse(extractDir);
  const findings = pkgParser.installHookFindings(pkgInfo);

  const files = walk(extractDir);
  for (const file of files) {
    const rel = path.relative(extractDir, file);
    const raw = await fsp.readFile(file, 'utf8');
    const { source, used } = await tryDeobfuscate(raw);
    findings.push(...analyzeSource(source, rel, used));
  }

  findings.sort((a, b) =>
    rank(a.severity) - rank(b.severity) ||
    a.file.localeCompare(b.file) || a.line - b.line);

  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, INFO: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;

  console.log(JSON.stringify({
    tarball: tarballPath,
    package: pkgInfo,
    counts,
    findings,
  }, null, 2));

  await fsp.rm(work, { recursive: true, force: true });
}

function walk(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        stack.push(p);
      } else if (e.isFile()) {
        if (ANALYZED_EXTENSIONS.has(path.extname(e.name).toLowerCase())) out.push(p);
      }
    }
  }
  return out;
}

function rank(s) { return { CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3 }[s] ?? 4; }

main().catch((e) => { console.error(e); process.exit(1); });
