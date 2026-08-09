// Run: node --experimental-strip-types --test shared/api/renames.test.ts
//
// These cover the exact defect that shipped: a script rename saved fine but
// was filtered out at display time because its stored scope tag didn't
// match what the view looked for, so the code silently never changed.

import test from 'node:test'
import assert from 'node:assert'
import { applyRenames, renamesForFile, type Rename } from './renames.ts'

const row = (over: Partial<Rename>): Rename => ({
  id: 'r1', original: 'a', suggested: 'b', scope: 'symbol',
  status: 'APPLIED', sourcePath: null, ...over,
})

test('a rename scoped to the file applies to that file', () => {
  const rs = [row({ original: 'x', suggested: 'count', sourcePath: 'lib/index.js' })]
  assert.deepEqual(renamesForFile(rs, 'lib/index.js').length, 1)
})

test('REGRESSION: legacy "function:"-prefixed scope still applies', () => {
  // Renames created while the view sent scope:'variable' landed as
  // "function:<path>". They must keep working, not silently vanish.
  const rs = [row({ original: 'x', suggested: 'count', sourcePath: 'function:lib/index.js' })]
  assert.equal(renamesForFile(rs, 'lib/index.js').length, 1)
})

test('a rename scoped to another file does NOT leak across files', () => {
  const rs = [row({ original: 'x', suggested: 'count', sourcePath: 'lib/other.js' })]
  assert.equal(renamesForFile(rs, 'lib/index.js').length, 0)
})

test('unscoped renames apply everywhere', () => {
  const rs = [row({ original: 'x', suggested: 'count', sourcePath: null })]
  assert.equal(renamesForFile(rs, 'anything.js').length, 1)
})

test('SUGGESTED rows are not applied — only APPLIED ones', () => {
  const rs = [row({ sourcePath: 'a.js', status: 'SUGGESTED' })]
  assert.equal(renamesForFile(rs, 'a.js').length, 0)
})

test('substitution rewrites whole words only', () => {
  const rs = [row({ original: 'a', suggested: 'count' })]
  const out = applyRenames('var a = 1; var ab = 2; foo(a);', rs)
  assert.equal(out, 'var count = 1; var ab = 2; foo(count);')
})

test('longer identifiers are not eaten by shorter ones', () => {
  const rs = [
    row({ id: '1', original: 'a', suggested: 'first' }),
    row({ id: '2', original: 'ab', suggested: 'second' }),
  ]
  const out = applyRenames('a + ab', rs)
  assert.equal(out, 'first + second')
})

test('renames do not cascade through each other', () => {
  // {a→b, b→c} must give "b c", never "c c": each identifier is visited
  // once against the original text.
  const rs = [
    row({ id: '1', original: 'a', suggested: 'b' }),
    row({ id: '2', original: 'b', suggested: 'c' }),
  ]
  assert.equal(applyRenames('a b', rs), 'b c')
})

test('regex metacharacters in an identifier are escaped', () => {
  const rs = [row({ original: '$fn', suggested: 'handler' })]
  assert.equal(applyRenames('$fn()', rs), 'handler()')
})

test('$ and _ count as identifier characters, not boundaries', () => {
  // \b is defined over [A-Za-z0-9_] and excludes $, so a naive \b pattern
  // silently skips every $-prefixed name — and obfuscated JS is full of
  // them. Renaming `$` must also leave `$foo` and `a$` alone.
  const rs = [row({ original: '$', suggested: 'jq' })]
  assert.equal(applyRenames('$( $foo ); $;', rs), 'jq( $foo ); jq;')
})

test('obfuscator-style _0x names rename correctly', () => {
  const rs = [row({ original: '_0x1a2b', suggested: 'stringTable' })]
  assert.equal(
    applyRenames('var _0x1a2b = [];_0x1a2b[0];_0x1a2bc;', rs),
    'var stringTable = [];stringTable[0];_0x1a2bc;',
  )
})

test('adjacent occurrences separated by one character both rename', () => {
  const rs = [row({ original: 'a', suggested: 'x' })]
  assert.equal(applyRenames('a+a a', rs), 'x+x x')
})

test('empty rename set returns the text untouched', () => {
  assert.equal(applyRenames('unchanged', []), 'unchanged')
})

test('end-to-end: filter then apply, the way the view does it', () => {
  const all: Rename[] = [
    row({ id: '1', original: 'p', suggested: 'payload', sourcePath: 'lib/index.js' }),
    row({ id: '2', original: 'q', suggested: 'other', sourcePath: 'lib/other.js' }),
    row({ id: '3', original: 'z', suggested: 'legacy', sourcePath: 'function:lib/index.js' }),
  ]
  const out = applyRenames('p + q + z', renamesForFile(all, 'lib/index.js'))
  assert.equal(out, 'payload + q + legacy')
})
