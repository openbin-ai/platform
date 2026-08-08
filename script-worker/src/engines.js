// On-demand deobfuscation engines.
//
// Analysis-time deobfuscation (deobfuscator.js `tryDeobfuscate`) is
// deliberately conservative: it runs on EVERY file of EVERY upload, so it
// only fires when it's confident, and it never costs the user a choice.
// This module is the opposite — the analyst pressed a button on one file
// and wants to see what a specific engine makes of it.
//
// Three engines, all reachable explicitly plus an `auto` mode that runs
// the plausible ones and keeps the best-scoring output:
//
//   obfuscator-io — ben-sb/obfuscator-io-deobfuscator. Specialised for
//                   obfuscator.io: string-array revealing, control-flow
//                   recovery, dead-branch and anti-tamper removal.
//   generic       — ben-sb/js-deobfuscator. Broader, less targeted.
//   caesar        — our own Caesar-over-fromCharCode decoder (see
//                   deobfuscator.js); the dominant NPM dropper shape.
//
// Neither third-party engine dominates the other in practice — on modern
// obfuscator.io output (v4 string-array wrappers) both frequently fail to
// resolve the string array and only manage structural cleanup. That is
// exactly why the UI offers a choice instead of picking silently.

const { parse } = require('@babel/parser');
const { Deobfuscator } = require('obfuscator-io-deobfuscator/dist/deobfuscator/deobfuscator.js');
const { defaultConfig } = require('obfuscator-io-deobfuscator/dist/deobfuscator/transformations/config.js');
const { deobfuscate: genericDeobfuscate } = require('js-deobfuscator');

const { tryCaesarDecode, looksObfuscatorIo } = require('./deobfuscator');

/** Engine ids accepted over the wire. Order is the `auto` try-order. */
const ENGINE_IDS = ['caesar', 'obfuscator-io', 'generic'];

// AST engines are CPU-bound and synchronous, so a Promise-based timeout
// cannot actually interrupt them (single-threaded). The real protection is
// this input cap — above it we refuse rather than risk eating the whole
// Lambda budget on one adversarial file. The Caesar pass is pure string
// math and stays available at any size.
const MAX_AST_INPUT_BYTES = Number(process.env.ONDEMAND_MAX_AST_BYTES || 2 * 1024 * 1024);

/**
 * Both libraries chatter to stdout/stderr (obfuscator-io's `silent` config
 * covers its own logger but not the `[StringRevealer]` warnings). In Lambda
 * that floods CloudWatch on every invoke, so we mute the console for the
 * duration of the call and always restore it.
 */
function quiet(fn) {
  const { log, warn, error, info, debug } = console;
  console.log = console.warn = console.error = console.info = console.debug = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, { log, warn, error, info, debug });
  }
}

// --- engine implementations ---------------------------------------------

/**
 * obfuscator.io engine. We drive the `Deobfuscator` class directly rather
 * than the package's `deobfuscate()` helper: that helper calls
 * `parse(source)` with no options, which defaults to sourceType 'script'
 * and therefore THROWS on any ES module (`import`/`export`). Parsing here
 * with 'unambiguous' + errorRecovery keeps .mjs and partially-broken
 * sources working.
 */
function runObfuscatorIo(source) {
  const ast = parse(source, { sourceType: 'unambiguous', errorRecovery: true });
  return quiet(() => new Deobfuscator(ast, { ...defaultConfig, silent: true }).execute());
}

function runGeneric(source) {
  return quiet(() => genericDeobfuscate(source));
}

function runCaesar(source) {
  const caesar = tryCaesarDecode(source);
  if (!caesar) return null;
  return caesar.decoded;
}

// --- scoring -------------------------------------------------------------

// What "more readable" means, mechanically. Obfuscated output is dense in
// hex identifiers and string-array accessor calls, and poor in plain
// readable string literals; deobfuscated output inverts that. Indicator
// hits (the strings an analyst actually cares about) are weighted heavily
// because recovering them is the whole point of pressing the button.
const RX_HEX_IDENT = /_0x[0-9a-f]{4,}/g;
const RX_ARRAY_CALL = /_0x[0-9a-f]{4,}\s*\(\s*0x[0-9a-f]+\s*\)/g;
const RX_READABLE_STRING = /['"`]([A-Za-z][A-Za-z0-9 ._/:-]{4,})['"`]/g;
const RX_INDICATOR = /(https?:\/\/|process\s*\.\s*env|require\s*\(|child_process|fromCharCode|atob|Buffer\.from)/g;

function countOf(source, rx) {
  rx.lastIndex = 0;
  let n = 0;
  while (rx.exec(source) !== null) n++;
  return n;
}

/**
 * Higher is more readable. Deliberately scale-free-ish: the comparison is
 * always between transforms of the SAME file, so raw counts are fine.
 */
function readabilityScore(source) {
  if (!source) return -Infinity;
  return (
    countOf(source, RX_READABLE_STRING) +
    3 * countOf(source, RX_INDICATOR) -
    2 * countOf(source, RX_ARRAY_CALL) -
    countOf(source, RX_HEX_IDENT) / 4
  );
}

// --- public API ----------------------------------------------------------

/**
 * Run one engine (or pick one automatically) over a single file's source.
 *
 * Never throws for engine-level failures — a failed engine is a result
 * (`used: false` + `error`), because the analyst asked a question and
 * "this engine can't crack it" is a legitimate answer worth rendering.
 *
 * @param {string} source raw file contents
 * @param {string} engine one of ENGINE_IDS, or 'auto'
 * @returns {{engine: string, used: boolean, source: string, note: string,
 *            error?: string, attempts: Array<{engine: string, used: boolean,
 *            score: number|null, error?: string}>}}
 */
function deobfuscateOnDemand(source, engine = 'auto') {
  const baseline = readabilityScore(source);
  const looksObfuscated = looksObfuscatorIo(source) || tryCaesarDecode(source) != null;
  const requested = engine === 'auto' ? ENGINE_IDS : [engine];
  const attempts = [];
  let best = null;

  for (const id of requested) {
    const startedAt = Date.now();
    let out = null;
    let error = null;
    try {
      if (id !== 'caesar' && source.length > MAX_AST_INPUT_BYTES) {
        throw new Error(
          `file is ${(source.length / 1024 / 1024).toFixed(1)} MB — above the ` +
          `${(MAX_AST_INPUT_BYTES / 1024 / 1024).toFixed(0)} MB cap for AST-based engines`,
        );
      }
      if (id === 'obfuscator-io') out = runObfuscatorIo(source);
      else if (id === 'generic') out = runGeneric(source);
      else if (id === 'caesar') out = runCaesar(source);
      else throw new Error(`unknown engine '${id}'`);
    } catch (e) {
      error = String((e && e.message) || e);
    }

    // An engine that hands back the input unchanged did nothing useful —
    // report it as not-used rather than dressing up a no-op as a result.
    const changed = out != null && out.trim().length > 0 && out !== source;
    const score = changed ? readabilityScore(out) : null;
    attempts.push({
      engine: id,
      used: changed,
      score: score == null ? null : Math.round(score * 10) / 10,
      durationMs: Date.now() - startedAt,
      ...(error ? { error } : {}),
    });

    if (changed && (best == null || score > best.score)) {
      best = { engine: id, source: out, score };
    }
    // An explicit single-engine request stops here regardless of outcome.
    if (engine !== 'auto') break;
  }

  if (!best) {
    const firstError = attempts.find((a) => a.error);
    return {
      engine,
      used: false,
      source,
      note: firstError
        ? `No engine could transform this file (${firstError.engine}: ${firstError.error}).`
        : 'No engine produced a different result — the file may already be plain, or use an unsupported scheme.',
      ...(firstError ? { error: firstError.error } : {}),
      attempts,
    };
  }

  // In auto mode a "winner" that scores below the untouched input is a
  // regression (the transform obscured more than it revealed); surface the
  // output anyway but say so, rather than quietly presenting it as better.
  const improved = best.score >= baseline;
  return {
    engine: best.engine,
    used: true,
    source: best.source,
    score: Math.round(best.score * 10) / 10,
    baselineScore: Math.round(baseline * 10) / 10,
    note: buildNote(engine, best, improved, attempts, looksObfuscated),
    looksObfuscated,
    attempts,
  };
}

function buildNote(requested, best, improved, attempts, looksObfuscated) {
  const label = ENGINE_LABELS[best.engine] || best.engine;
  // A clean file still "transforms" (the AST engines reformat and fold
  // constants). Say so, or the analyst reads cosmetic reprinting as a
  // successful unpacking.
  const cleanHint = looksObfuscated
    ? ''
    : ' This file did not show obfuscation signatures, so the changes are likely cosmetic (reformatting / constant folding) rather than an unpacking.';
  if (requested !== 'auto') {
    return (improved
      ? `${label} transformed this file.`
      : `${label} transformed this file, but the result does not score as more readable than the original — compare both tabs before trusting it.`) + cleanHint;
  }
  const tried = attempts.filter((a) => a.used).length;
  const base = `Auto-selected ${label} (best of ${tried} engine${tried === 1 ? '' : 's'} that produced output).`;
  return (improved ? base : `${base} Note: the result does not score as more readable than the original.`) + cleanHint;
}

const ENGINE_LABELS = {
  'obfuscator-io': 'obfuscator.io deobfuscator',
  generic: 'general JS deobfuscator',
  caesar: 'Caesar/fromCharCode decoder',
};

/**
 * Cheap "which engine would auto pick?" hint for the UI, computed without
 * running anything. Purely advisory — auto mode still scores real output.
 */
function suggestEngine(source) {
  if (tryCaesarDecode(source)) return 'caesar';
  if (looksObfuscatorIo(source)) return 'obfuscator-io';
  return 'generic';
}

module.exports = {
  deobfuscateOnDemand,
  suggestEngine,
  readabilityScore,
  ENGINE_IDS,
  ENGINE_LABELS,
};
