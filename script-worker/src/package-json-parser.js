// Parse the package.json that lives at the root of an extracted NPM
// tarball. Emits the structured data the analyzer + handler need, plus a
// list of install-hook findings.

const fs = require('node:fs');
const path = require('node:path');

const INSTALL_HOOK_KEYS = ['preinstall', 'install', 'postinstall'];

function parse(extractRoot) {
  const pkgPath = path.join(extractRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) {
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
