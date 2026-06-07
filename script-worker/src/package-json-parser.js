// Parse the package.json that lives at the root of an extracted NPM
// tarball. Emits the structured data the analyzer + handler need, plus a
// list of install-hook findings.

const fs = require('node:fs');
const path = require('node:path');

const INSTALL_HOOK_KEYS = ['preinstall', 'install', 'postinstall'];

function parse(extractRoot) {
  // Find the package.json closest to the root. Datadog samples wrap the
  // tarball under tmp/tmpXXX/@scope-name/package/, GitHub "download as
  // zip" wraps under <repo>-<branch>/, and `npm pack` produces
  // package/. The shallowest one wins so we don't pick up a vendored
  // dep's package.json by accident.
  const pkgPath = findShallowestPackageJson(extractRoot);
  if (!pkgPath) {
    return { found: false };
  }
  let json;
  try {
    json = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (e) {
    return { found: true, parseError: String(e.message || e) };
  }
  const scripts = json.scripts || {};
  const hookHits = INSTALL_HOOK_KEYS
    .filter((k) => typeof scripts[k] === 'string' && scripts[k].length > 0)
    .map((k) => ({ key: k, script: scripts[k] }));
  return {
    found: true,
    // Directory containing the chosen package.json — callers use this as
    // the analysis root so the file walker doesn't dredge through wrapping
    // dirs (Datadog's tmp/tmpXXX/..., GitHub's <repo>-<branch>/, etc).
    packageRoot: path.dirname(pkgPath),
    name: json.name || null,
    version: json.version || null,
    description: json.description || null,
    maintainers: Array.isArray(json.maintainers) ? json.maintainers : [],
    dependencyCount:
      Object.keys(json.dependencies || {}).length +
      Object.keys(json.devDependencies || {}).length +
      Object.keys(json.optionalDependencies || {}).length,
    hooks: hookHits,
    hasInstallHook: hookHits.length > 0,
  };
}

// BFS over the extracted tree, returning the package.json with the
// shortest path. Skips node_modules so a vendored dep's manifest doesn't
// outrank the real one.
function findShallowestPackageJson(root) {
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.shift();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { continue; }
    // Check files first so we return as soon as we find one at this depth.
    for (const e of entries) {
      if (e.isFile() && e.name === 'package.json') {
        return path.join(dir, e.name);
      }
    }
    for (const e of entries) {
      if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git') {
        queue.push(path.join(dir, e.name));
      }
    }
  }
  return null;
}

// Produces install-hook findings. Targets-obfuscated escalation happens
// later in the handler after we know which files came back deobfuscated.
function installHookFindings(pkgInfo) {
  if (!pkgInfo.found || !pkgInfo.hasInstallHook) return [];
  return pkgInfo.hooks.map((h) => ({
    rule: 'install-hook',
    severity: 'MEDIUM',
    file: 'package.json',
    line: 0,
    column: 0,
    message: `Package runs a "${h.key}" script: ${h.script}`,
    snippet: `"${h.key}": ${JSON.stringify(h.script)}`,
    remediation: 'Install hooks execute on every npm install — verify the target script is benign before trusting this package.',
    evidence: { hook: h.key, script: h.script },
    deobfuscated: false,
  }));
}

module.exports = { parse, installHookFindings };
