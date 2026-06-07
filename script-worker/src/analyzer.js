// The 8-rule static analyzer. Each rule visits Babel AST nodes and emits
// structured findings. Order of severity: CRITICAL > HIGH > MEDIUM > INFO.
//
// Rules:
//   1. secret-theft   (CRITICAL) — reads sensitive env vars (AWS_*, NPM_TOKEN, ...)
//   2. fs-traversal   (CRITICAL) — references known credential paths (~/.aws, ~/.ssh, ...)
//   3. known-c2       (CRITICAL) — string literal matches known-bad indicator list
//   4. net-exfil      (HIGH)     — fetch / http.request / net.connect with suspicious target
//   5. eval-surface   (HIGH)     — eval, new Function(), require(<computed>), vm.runIn*
//   6. spawn          (HIGH)     — child_process.{spawn,exec,...} with shell:true or dynamic
//   7. install-hook   (HIGH/MEDIUM) — emitted by package-json-parser, severity decided in handler
//   8. entropy-blob   (INFO)     — long high-entropy string literal (encoded payload?)

const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// --- detector tables ----------------------------------------------------

const SENSITIVE_ENV_PATTERNS = [
  /^AWS_/, /^NPM_TOKEN$/, /^GH_TOKEN$/, /^GITHUB_TOKEN$/, /^DOCKER_/,
  /^NODE_AUTH_TOKEN$/, /^CIRCLECI_TOKEN$/, /^CODECOV_TOKEN$/, /^VAULT_/,
  /^GCP_/, /^GOOGLE_APPLICATION_CREDENTIALS$/, /^AZURE_/, /^SSH_/,
  /^STRIPE_/, /^TWILIO_/, /^SENDGRID_/, /^SLACK_TOKEN$/,
];

const SENSITIVE_FS_PATTERNS = [
  /\.aws\/credentials/, /\.aws\/config/,
  /\.ssh\/id_/, /\.ssh\/authorized_keys/,
  /\.npmrc/, /\.yarnrc/,
  /\.docker\/config\.json/,
  /\.gnupg/, /\.gpg/,
  /\.env(?!\w)/,        // .env files but not e.g. ".envoy"
  /\.kube\/config/,
  /\/etc\/passwd/, /\/etc\/shadow/,
  /Library\/Keychains/, // macOS keychain
];

// Heuristic seed list — known-malicious patterns from past NPM incidents.
// Replaced from CVE / GHSA feeds in JS-2.
const KNOWN_C2_PATTERNS = [
  /discord\.com\/api\/webhooks/i,
  /webhook\.site/i,
  /requestbin\.(net|com)/i,
  /pastebin\.com\/raw/i,
  /transfer\.sh/i,
  /\bt\.me\/[A-Za-z0-9_]+/i,
  /ipinfo\.io\/(json|ip)/i,
  /npmjs\.help/i,         // typosquat impersonating npmjs.com
  /workers\.dev\/[a-z0-9-]+\/(api|exfil|drop)/i,
];

const SUSPICIOUS_NET_HOSTS = [
  /\d+\.\d+\.\d+\.\d+/,    // raw IPv4 in URL
  /\b[a-z0-9-]+\.onion\b/, // Tor
  /paste(bin|rs)?\./i,
  /bit\.ly|tinyurl\.com|t\.co/,
];

// --- helpers ------------------------------------------------------------

function shannonEntropy(str) {
  if (!str.length) return 0;
  const freq = new Map();
  for (const c of str) freq.set(c, (freq.get(c) || 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / str.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function snippet(source, node, max = 120) {
  if (!node || node.start == null || node.end == null) return '';
  const s = source.slice(node.start, node.end).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function loc(node) {
  const l = node?.loc?.start || {};
  return { line: l.line || 0, column: l.column || 0 };
}

// MemberExpression -> dotted name like "child_process.exec" if both halves
// are plain identifiers, otherwise null.
function dottedName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type !== 'MemberExpression' || node.computed) return null;
  const left = dottedName(node.object);
  if (left == null) return null;
  if (node.property.type !== 'Identifier') return null;
  return `${left}.${node.property.name}`;
}

// --- the analyzer -------------------------------------------------------

/**
 * @param {string} source     - JS source (post-deobfuscation if used)
 * @param {string} file       - file path relative to extract root
 * @param {boolean} deobfFlag - whether the source came from the deobfuscator
 * @returns {Array} findings array (no IDs yet — handler assigns)
 */
function analyzeSource(source, file, deobfFlag) {
  const findings = [];
  let ast;
  try {
    ast = parse(source, {
      sourceType: 'unambiguous',
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
      errorRecovery: true,
      plugins: ['jsx', 'typescript', 'dynamicImport', 'optionalChaining', 'nullishCoalescingOperator'],
    });
  } catch (_) {
    return findings; // unparseable — skip silently
  }

  const push = (rule, severity, node, message, evidence) => {
    const l = loc(node);
    findings.push({
      rule,
      severity,
      file,
      line: l.line,
      column: l.column,
      message,
      snippet: snippet(source, node),
      remediation: REMEDIATIONS[rule] || '',
      evidence: evidence || {},
      deobfuscated: deobfFlag,
    });
  };

  traverse(ast, {
    // secret-theft: process.env.AWS_ACCESS_KEY_ID etc.
    MemberExpression(p) {
      const dn = dottedName(p.node);
      if (!dn) return;
      const m = dn.match(/^process\.env\.([A-Z0-9_]+)$/);
      if (m) {
        const envName = m[1];
        if (SENSITIVE_ENV_PATTERNS.some((re) => re.test(envName))) {
          push('secret-theft', 'CRITICAL', p.node,
            `Reads sensitive environment variable ${envName}`,
            { envVar: envName });
        }
      }
    },

    StringLiteral(p) {
      const v = p.node.value;
      if (!v || typeof v !== 'string') return;

      // fs-traversal: matches known credential paths
      if (SENSITIVE_FS_PATTERNS.some((re) => re.test(v))) {
        push('fs-traversal', 'CRITICAL', p.node,
          `String literal references sensitive filesystem path: ${v}`,
          { path: v });
      }

      // known-c2: known-bad domains/exfil endpoints
      if (KNOWN_C2_PATTERNS.some((re) => re.test(v))) {
        push('known-c2', 'CRITICAL', p.node,
          `String literal matches a known-bad command-and-control indicator: ${v}`,
          { indicator: v });
      }

      // entropy-blob: long, high-entropy literals (likely encoded payload)
      if (v.length > 200) {
        const h = shannonEntropy(v);
        if (h > 4.5) {
          push('entropy-blob', 'INFO', p.node,
            `Long high-entropy string literal (length ${v.length}, entropy ${h.toFixed(2)}) — possible encoded payload`,
            { length: v.length, entropy: Number(h.toFixed(2)) });
        }
      }
    },

    // eval-surface: eval(), new Function(), require(computed), vm.runIn*
    CallExpression(p) {
      const callee = p.node.callee;
      // eval(...)
      if (callee.type === 'Identifier' && callee.name === 'eval') {
        push('eval-surface', 'HIGH', p.node,
          'Direct eval() call — executes arbitrary code at runtime',
          { kind: 'eval' });
        return;
      }
      // require(<non-literal>) — dynamic require
      if (callee.type === 'Identifier' && callee.name === 'require') {
        const arg = p.node.arguments[0];
        if (arg && arg.type !== 'StringLiteral' && arg.type !== 'TemplateLiteral') {
          push('eval-surface', 'HIGH', p.node,
            'require() called with a computed argument — module loaded dynamically',
            { kind: 'dynamic-require' });
        }
      }
      // setTimeout / setInterval with a string first arg behaves like eval
      if (callee.type === 'Identifier' &&
          (callee.name === 'setTimeout' || callee.name === 'setInterval')) {
        const arg = p.node.arguments[0];
        if (arg && arg.type === 'StringLiteral') {
          push('eval-surface', 'HIGH', p.node,
            `${callee.name} called with a string body — interpreted as code`,
            { kind: callee.name });
        }
      }
      // vm.runIn* family
      const dn = dottedName(callee);
      if (dn && /^vm\.runIn/.test(dn)) {
        push('eval-surface', 'HIGH', p.node,
          `${dn} executes a code string in a vm context`,
          { kind: dn });
      }

      // net-exfil: fetch(), http.request, https.request, net.connect, dgram.createSocket
      if (callee.type === 'Identifier' && callee.name === 'fetch') {
        flagNetCall(p.node, 'fetch');
      } else if (dn === 'http.request' || dn === 'https.request' ||
                 dn === 'http.get' || dn === 'https.get' ||
                 dn === 'net.connect' || dn === 'net.createConnection' ||
                 dn === 'dgram.createSocket') {
        flagNetCall(p.node, dn);
      }

      // spawn: child_process.{spawn,exec,execSync,fork,spawnSync}. Catches
      // both the dotted form `child_process.execSync(...)` and the more
      // common destructured form `const { execSync } = require('child_process'); execSync(...)`
      // by also matching bare identifiers in that fixed set. Names are
      // uncommon enough that the false-positive rate stays low.
      const BARE_SPAWN_NAMES = new Set(['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']);
      const isDotted = dn && /^child_process\.(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)$/.test(dn);
      const isBare = callee.type === 'Identifier' && BARE_SPAWN_NAMES.has(callee.name);
      if (isDotted || isBare) {
        const opts = p.node.arguments.find(
          (a) => a && a.type === 'ObjectExpression');
        const shellTrue = opts && opts.properties.some((prop) =>
          prop.type === 'ObjectProperty' &&
          prop.key && prop.key.name === 'shell' &&
          prop.value && prop.value.type === 'BooleanLiteral' &&
          prop.value.value === true);
        const label = isDotted ? dn : `child_process.${callee.name}`;
        push('spawn', 'HIGH', p.node,
          `${label} invocation${shellTrue ? ' with shell:true' : ''}`,
          { call: label, shellTrue: !!shellTrue });
      }
    },

    // new Function('...') — eval cousin
    NewExpression(p) {
      const c = p.node.callee;
      if (c.type === 'Identifier' && c.name === 'Function') {
        push('eval-surface', 'HIGH', p.node,
          'new Function(...) constructs a function from a string body',
          { kind: 'new-function' });
      }
    },
  });

  // local helper closes over `push` + `source`
  function flagNetCall(callNode, kind) {
    const arg = callNode.arguments[0];
    let target = null;
    if (arg && arg.type === 'StringLiteral') target = arg.value;
    else if (arg && arg.type === 'TemplateLiteral' &&
             arg.expressions.length === 0 && arg.quasis.length === 1) {
      target = arg.quasis[0].value.cooked;
    }
    // Skip plain localhost / relative URLs / common safe hosts.
    if (target && /^(\/|\.\/|https?:\/\/(localhost|127\.0\.0\.1))/.test(target)) {
      return;
    }
    // Skip if target looks like a config object instead of a URL.
    const suspicious = target && SUSPICIOUS_NET_HOSTS.some((re) => re.test(target));
    push('net-exfil', suspicious ? 'HIGH' : 'HIGH', callNode,
      `${kind}() call${target ? ` to ${target}` : ''}`,
      { call: kind, target: target || null, suspiciousTarget: !!suspicious });
  }

  return findings;
}

const REMEDIATIONS = {
  'secret-theft': 'Legitimate packages rarely read credential env vars directly. Audit the call site and the function that owns it.',
  'fs-traversal': 'Packages should not reach into a developer\'s home directory. Inspect why this path appears.',
  'known-c2': 'This indicator has been seen in known-malicious NPM packages. Treat the package as compromised pending review.',
  'net-exfil': 'Verify the destination is documented for this package. Outbound calls to non-package-author domains are suspicious.',
  'eval-surface': 'Dynamic code execution is a strong red flag in a library. Confirm whether the runtime path is reachable from install or import.',
  'spawn': 'Process spawning at import or install time can run arbitrary local commands. Look for the calling context.',
  'entropy-blob': 'High-entropy strings often hide encoded payloads (hex / base64 / packed JS). The deobfuscator pass may expose the contents.',
  'install-hook': 'Install hooks run on every `npm install`. Audit the target script before trusting the package.',
};

module.exports = { analyzeSource, shannonEntropy };
