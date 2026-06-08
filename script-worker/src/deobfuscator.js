// Deobfuscator layer. Two passes try in order:
//
//   1. The "Caesar over fromCharCode" pattern that's been the dominant
//      NPM dropper shape since 2020 (Red Hat / Shai-Hulud / lottiefiles
//      and dozens of others). It's NEVER what ben-sb/js-deobfuscator
//      targets, and a substantial fraction of compromised packages use
//      it — so we ship a dedicated detector + decoder rather than
//      pretending the general-purpose deobfuscator covers it.
//
//   2. ben-sb/js-deobfuscator for obfuscator.io-style transforms
//      (string-array tables, control-flow flattening, dead-code
//      injection).
//
// Either pass returning a meaningful transform marks `used=true` so the
// handler writes the decoded output to deobfuscated/ alongside the
// original; the UI surfaces an Original/Deobfuscated toggle.

const { deobfuscate: benSbDeobfuscate } = require('js-deobfuscator');

const TIMEOUT_MS = Number(process.env.DEOBF_TIMEOUT_MS || 8000);

// --- Pass 1: Caesar-over-charCodes (the Red Hat / Shai-Hulud pattern) ---

// Three telltales of the dropper shape — all must be present somewhere
// in the source. The exact wrapper text varies wildly across campaigns
// (some pass [NUMS] directly to a fn(s,n) wrapper, some pass
// [NUMS].map(fromCharCode).join("") instead, some wrap in try/catch,
// some don't) so we don't try to match the structure — we match the
// SIGNALS, find the largest numeric array, and brute-force the shift.
const TELLTALES = ['eval', 'fromCharCode', 'charCodeAt'];
const NUMERIC_ARRAY_RX = /\[\s*([0-9][0-9,\s]*[0-9])\s*\]/g;

function tryCaesarDecode(source) {
  for (const t of TELLTALES) if (!source.includes(t)) return null;

  // Find the largest numeric array literal — that's the encoded payload.
  let nums = null;
  let m;
  NUMERIC_ARRAY_RX.lastIndex = 0;
  while ((m = NUMERIC_ARRAY_RX.exec(source))) {
    const parts = m[1].split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
    if (parts.length > 100 && (!nums || parts.length > nums.length)) nums = parts;
  }
  if (!nums) return null;

  // fromCharCode the numeric array → encoded string.
  const chunks = [];
  for (let i = 0; i < nums.length; i += 8192) {
    chunks.push(String.fromCharCode(...nums.slice(i, i + 8192)));
  }
  const encoded = chunks.join('');

  // Brute-force the Caesar shift. Cheap — 25 candidates max, each is a
  // O(n) string transform. Score by JS-likeness and pick the best.
  let best = null;
  for (let shift = 1; shift <= 25; shift++) {
    const decoded = caesarShiftAsciiLetters(encoded, shift);
    const score = scoreJsLikeness(decoded);
    if (score > 0 && (!best || score > best.score)) {
      best = { decoded, shift, score };
    }
  }
  if (!best || !looksLikeJs(best.decoded)) return null;

  return {
    decoded: best.decoded,
    shift: best.shift,
    encodedLength: encoded.length,
    note: `Caesar-over-fromCharCode dropper decoded — the wrapper used eval(fn([NUMS], ${best.shift})) where ${best.shift} shifted ASCII letters mod 26. Canonical NPM supply-chain dropper shape (Shai-Hulud, lottiefiles, the Red Hat campaign, and dozens of others all use this).`,
  };
}

function caesarShiftAsciiLetters(s, n) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 65 && c <= 90) out += String.fromCharCode(((c - 65 + n) % 26 + 26) % 26 + 65);
    else if (c >= 97 && c <= 122) out += String.fromCharCode(((c - 97 + n) % 26 + 26) % 26 + 97);
    else out += s[i];
  }
  return out;
}

// Lightweight "does this look like JS we should keep?" heuristic. Used as
// the brute-force tiebreaker for the Caesar shift and as a final sanity
// check before emitting the decoded payload as a real file.
function looksLikeJs(s) {
  if (s.length < 20) return false;
  let printable = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 32 && c <= 126) || c === 9 || c === 10 || c === 13) printable++;
  }
  if (printable / s.length < 0.9) return false;
  return /\b(function|const|let|var|require|module|process|fetch|return|if|for|while|new)\b/.test(s);
}

// Numeric score: token hits + brace/paren balance. Used to pick the
// best Caesar shift when more than one decodes to readable text.
function scoreJsLikeness(s) {
  const tokens = (s.match(/\b(function|const|let|var|require|module|process|fetch|return|if|for|while|new|catch|try|throw|async|await|class)\b/g) || []).length;
  if (tokens === 0) return 0;
  const open = (s.match(/[{([]/g) || []).length;
  const close = (s.match(/[})\]]/g) || []).length;
  const balanced = open > 0 && Math.abs(open - close) < 5;
  return tokens + (balanced ? 10 : 0);
}

// --- Pass 2: ben-sb obfuscator.io ----------------------------------------

function looksObfuscatorIo(source) {
  if (source.length < 200) return false;
  // obfuscator.io string-array signature.
  if (/var _0x[0-9a-f]+\s*=\s*\[/.test(source)) return true;
  // High density of hex-named identifiers.
  const hexHits = source.match(/_0x[0-9a-f]{4,}/g);
  if (hexHits && hexHits.length > 20) return true;
  return false;
}

// --- public API ---------------------------------------------------------

async function tryDeobfuscate(source) {
  // Caesar pass first — it's cheap (pure regex + char math, no AST)
  // and it's the dominant pattern in the wild today.
  const caesar = tryCaesarDecode(source);
  if (caesar) {
    return {
      source: buildCaesarOutput(source, caesar),
      used: true,
      method: 'caesar-charcode',
      shift: caesar.shift,
    };
  }

  // ben-sb pass for obfuscator.io patterns.
  if (!looksObfuscatorIo(source)) {
    return { source, used: false };
  }
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => benSbDeobfuscate(source)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('deobf-timeout')), TIMEOUT_MS);
      }),
    ]);
    return { source: result || source, used: result ? true : false, method: result ? 'js-deobfuscator' : null };
  } catch (e) {
    return { source, used: false, error: String(e.message || e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildCaesarOutput(originalSource, caesar) {
  return (
    `// ============================================================\n` +
    `// DECODED by openbin.ai script-worker\n` +
    `// Method: Caesar-shift-over-fromCharCode (shift = ${caesar.shift})\n` +
    `// Encoded length: ${caesar.encodedLength} bytes\n` +
    `// ${caesar.note}\n` +
    `// The original source is preserved in the Original tab.\n` +
    `// ============================================================\n` +
    `\n` +
    caesar.decoded +
    `\n\n` +
    `// ============================================================\n` +
    `// Original (still flagged eval-surface in findings):\n` +
    `// ${originalSource.length > 500 ? originalSource.slice(0, 500) + '… [truncated]' : originalSource}\n` +
    `// ============================================================\n`
  );
}

module.exports = { tryDeobfuscate, looksObfuscatorIo, tryCaesarDecode };
