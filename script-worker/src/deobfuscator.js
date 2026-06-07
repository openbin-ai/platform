// Wrap ben-sb/js-deobfuscator with a hard timeout. The library
// reverses obfuscator.io transforms (string-array, control-flow flattening,
// dead-code injection). On any failure or timeout we fall back to the raw
// source and flag it — the analyzer still gets to look at the original.
//
// API note: the npm package is `js-deobfuscator` (the GitHub repo is named
// `javascript-deobfuscator` but publishes under the shorter name). The
// export is a plain `deobfuscate(source, configOverrides?)` function, not
// a class.

const { deobfuscate } = require('js-deobfuscator');

const TIMEOUT_MS = Number(process.env.DEOBF_TIMEOUT_MS || 8000);

// Heuristic gate — the deobfuscator is meaningful for sources that look
// machine-generated. Skip it for normal hand-written code to save time
// and avoid spurious transformations.
function looksObfuscated(source) {
  if (source.length < 200) return false;
  // obfuscator.io string-array signature: a large array of short strings
  // referenced through a getter function.
  if (/var _0x[0-9a-f]+\s*=\s*\[/.test(source)) return true;
  // High density of hex-named identifiers (_0x123abc) anywhere in source.
  const hexHits = source.match(/_0x[0-9a-f]{4,}/g);
  if (hexHits && hexHits.length > 20) return true;
  // Very long single-line (minified + encoded).
  const longestLine = source.split('\n').reduce((m, l) => Math.max(m, l.length), 0);
  if (longestLine > 4000) return true;
  return false;
}

async function tryDeobfuscate(source) {
  if (!looksObfuscated(source)) {
    return { source, used: false };
  }
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => deobfuscate(source)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('deobf-timeout')), TIMEOUT_MS);
      }),
    ]);
    return { source: result || source, used: result ? true : false };
  } catch (e) {
    return { source, used: false, error: String(e.message || e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { tryDeobfuscate, looksObfuscated };
