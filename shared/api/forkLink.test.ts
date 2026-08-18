// Run: node --experimental-strip-types --test shared/api/forkLink.test.ts

import test from 'node:test'
import assert from 'node:assert'
import { forkedFromHref } from './forkLink.ts'

test('a project that is not a fork has no attribution link', () => {
  assert.equal(forkedFromHref({}), null)
  assert.equal(forkedFromHref({ forkedFromId: null }), null)
})

test('REGRESSION: a public source links to the PUBLIC view', () => {
  // Linking to /projects/<id> 404s for everyone who forked someone else's
  // project, which is the normal case. This is the bug that shipped.
  assert.equal(
    forkedFromHref({ forkedFromId: 'abc', forkedFromPublic: true }),
    '/public/projects/abc',
  )
})

test('a non-public source links to the authenticated view', () => {
  // Forking your own private project: the public view would 404 instead.
  assert.equal(
    forkedFromHref({ forkedFromId: 'abc', forkedFromPublic: false }),
    '/projects/abc',
  )
})

test('a missing flag degrades to the authenticated view', () => {
  // List responses don't populate it; so would a stale backend.
  assert.equal(forkedFromHref({ forkedFromId: 'abc' }), '/projects/abc')
})
