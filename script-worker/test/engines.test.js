// Tests for the on-demand deobfuscation engines.
//
// Fixtures under fixtures/obfuscated/ are REAL javascript-obfuscator output
// (see fixtures/README.md for the generation recipe), not hand-written
// approximations — the engines key off exact wrapper shapes, so a
// hand-rolled "looks obfuscated" sample tests nothing useful.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { deobfuscateOnDemand, suggestEngine, readabilityScore, ENGINE_IDS } = require('../src/engines');

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'obfuscated');
const read = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

test('every engine id is individually runnable', () => {
  const source = read('string-array.js');
  for (const engine of ENGINE_IDS) {
    const r = deobfuscateOnDemand(source, engine);
    assert.equal(r.engine, engine, `${engine} should report itself`);
    assert.equal(typeof r.source, 'string');
    assert.ok(r.note, `${engine} should explain itself`);
    // Engine failure is a result, never an exception.
    assert.equal(typeof r.used, 'boolean');
  }
});

test('an unknown engine is reported, not thrown', () => {
  const r = deobfuscateOnDemand('const a = 1;', 'nope');
  assert.equal(r.used, false);
  assert.match(r.error || '', /unknown engine/);
});

test('auto mode picks the highest-scoring engine and shows its work', () => {
  const source = read('string-array.js');
  const r = deobfuscateOnDemand(source, 'auto');
  assert.equal(r.used, true);
  assert.ok(ENGINE_IDS.includes(r.engine), `picked a real engine, got ${r.engine}`);
  assert.ok(Array.isArray(r.attempts) && r.attempts.length > 1, 'reports what it tried');
  // The winner must be the best scorer among successful attempts.
  const bestScore = Math.max(...r.attempts.filter((a) => a.used).map((a) => a.score));
  assert.equal(r.score, bestScore);
});

test('deobfuscating recovers indicators hidden in the string array', () => {
  const r = deobfuscateOnDemand(read('string-array.js'), 'auto');
  assert.ok(r.used);
  // The plain source exfiltrates to webhook.site; obfuscation hides it in
  // the string array. Whichever engine wins, the URL should be readable.
  assert.match(r.source, /webhook\.site/);
});

test('caesar engine decodes the fromCharCode dropper shape', () => {
  const r = deobfuscateOnDemand(read('caesar-dropper.js'), 'caesar');
  assert.equal(r.used, true, r.note);
  assert.match(r.source, /NPM_TOKEN/);
});

test('caesar engine reports cleanly when the pattern is absent', () => {
  const r = deobfuscateOnDemand(read('string-array.js'), 'caesar');
  assert.equal(r.used, false);
  assert.ok(r.note.length > 0);
});

test('ES modules do not crash the obfuscator.io engine', () => {
  // The library's own deobfuscate() helper parses as sourceType 'script'
  // and throws on import/export; we drive the Deobfuscator class with
  // 'unambiguous' instead. Guards that integration choice.
  const r = deobfuscateOnDemand('import x from "y";\nconst a = 1 + 2;\nexport default a;', 'obfuscator-io');
  assert.ok(!r.error, `should not error, got: ${r.error}`);
  assert.equal(typeof r.source, 'string');
});

test('a clean file is flagged as not obfuscated', () => {
  const r = deobfuscateOnDemand('const a = 1;\nmodule.exports = a;\n', 'auto');
  assert.equal(r.looksObfuscated, false);
  if (r.used) {
    assert.match(r.note, /cosmetic/i, 'must not imply a real unpacking');
  }
});

test('oversized input is refused by AST engines but not by caesar', () => {
  // Just over the 2 MB AST cap, and not valid-looking JS — the point is
  // the size guard fires before any parsing is attempted.
  const huge = `const x = "${'a'.repeat(2 * 1024 * 1024 + 10)}";`;
  const ast = deobfuscateOnDemand(huge, 'obfuscator-io');
  assert.equal(ast.used, false);
  assert.match(ast.error || '', /cap for AST-based engines/);

  const caesar = deobfuscateOnDemand(huge, 'caesar');
  assert.ok(!/cap for AST-based engines/.test(caesar.error || ''), 'caesar has no size cap');
});

test('readability scoring prefers revealed strings over hex identifiers', () => {
  const obfuscated = read('string-array.js');
  const plain = read('plain.js');
  assert.ok(
    readabilityScore(plain) > readabilityScore(obfuscated),
    'plain source must score above its obfuscated form',
  );
});

test('suggestEngine routes the dropper shape to caesar', () => {
  assert.equal(suggestEngine(read('caesar-dropper.js')), 'caesar');
  assert.equal(suggestEngine(read('string-array.js')), 'obfuscator-io');
});
