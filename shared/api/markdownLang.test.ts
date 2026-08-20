// Run: node --experimental-strip-types --test shared/api/markdownLang.test.ts

import test from 'node:test'
import assert from 'node:assert'
import { langFromClassName, normalizeLang } from './markdownLang.ts'

test('common aliases map to a loaded grammar', () => {
  assert.equal(normalizeLang('js'), 'javascript')
  assert.equal(normalizeLang('ts'), 'typescript')
  assert.equal(normalizeLang('py'), 'python')
  assert.equal(normalizeLang('sh'), 'bash')
  assert.equal(normalizeLang('ps1'), 'powershell')
})

test('exact names pass through, case-insensitively', () => {
  assert.equal(normalizeLang('python'), 'python')
  assert.equal(normalizeLang('JSON'), 'json')
})

test('an unknown language is null, not a guess', () => {
  // Shiki throws on a grammar it never loaded, which would take the whole
  // post down. Unknown must degrade to plain text.
  assert.equal(normalizeLang('brainfuck'), null)
  assert.equal(normalizeLang(''), null)
  assert.equal(normalizeLang(undefined), null)
  assert.equal(normalizeLang(null), null)
})

test('language comes out of react-markdown class names', () => {
  assert.equal(langFromClassName('language-js'), 'javascript')
  assert.equal(langFromClassName('some-class language-python other'), 'python')
  assert.equal(langFromClassName('language-c++'), 'cpp')
  assert.equal(langFromClassName(undefined), null)
  assert.equal(langFromClassName('no-language-here'), null)
})
