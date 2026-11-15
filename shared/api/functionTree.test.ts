// Run: node --experimental-strip-types --test shared/api/functionTree.test.ts

import test from 'node:test'
import assert from 'node:assert'
import {
  buildFunctionTree,
  findFolderPath,
  visibleRows,
  MAX_GROUP,
  type TreeFn,
  type TreeNode,
} from './functionTree.ts'

const fn = (name: string, o: Partial<TreeFn> = {}): TreeFn => ({
  name,
  address: name,
  external: false,
  thunk: false,
  ...o,
})

function leafNames(nodes: TreeNode<TreeFn>[]): string[] {
  return nodes.flatMap((n) => (n.kind === 'leaf' ? [n.fn.name] : leafNames(n.children)))
}

function maxLevelSize(nodes: TreeNode<TreeFn>[]): number {
  return Math.max(nodes.length, ...nodes.map((n) => (n.kind === 'folder' ? maxLevelSize(n.children) : 0)))
}

test('splits into Functions / Imports / Thunks and omits empty categories', () => {
  const roots = buildFunctionTree([
    fn('main'),
    fn('printf', { external: true }),
    fn('puts', { external: true, thunk: true }),
    fn('j_printf', { thunk: true }),
  ])
  assert.deepEqual(roots.map((r) => [r.label, r.count]), [['Functions', 1], ['Imports', 2], ['Thunks', 1]])
  assert.deepEqual(buildFunctionTree([fn('main')]).map((r) => r.label), ['Functions'])
})

test('a small category stays flat and sorted', () => {
  const [root] = buildFunctionTree([fn('zeta'), fn('alpha'), fn('main')])
  assert.deepEqual(root.children.map((c) => c.kind), ['leaf', 'leaf', 'leaf'])
  assert.deepEqual(leafNames(root.children), ['alpha', 'main', 'zeta'])
})

test('a large category is grouped by shared prefix, losing nothing', () => {
  const fns: TreeFn[] = []
  for (let i = 0; i < 3000; i++) fns.push(fn('FUN_00' + (0x100000 + i * 16).toString(16)))
  for (let i = 0; i < 60; i++) fns.push(fn('ieee754_' + String(i).padStart(2, '0')))
  fns.push(fn('main'))
  const [root] = buildFunctionTree(fns)

  const top = root.children
  const labels = top.filter((n) => n.kind === 'folder').map((n) => n.label)
  assert.deepEqual(labels, ['FUN_0010', 'ieee754_'])
  assert.ok(top.some((n) => n.kind === 'leaf' && n.fn.name === 'main'))

  assert.equal(leafNames(top).length, fns.length)
  assert.deepEqual(leafNames(top), fns.map((f) => f.name).sort())
  assert.ok(maxLevelSize(top) <= MAX_GROUP, `level too big: ${maxLevelSize(top)}`)
})

test('duplicate and prefix-of-each-other names terminate', () => {
  const fns: TreeFn[] = []
  for (let i = 0; i < 100; i++) fns.push({ ...fn('dup'), address: String(i).padStart(4, '0') })
  for (let i = 0; i < 100; i++) fns.push(fn('dup' + i))
  const [root] = buildFunctionTree(fns)
  assert.equal(leafNames(root.children).length, 200)
})

test('findFolderPath + visibleRows reveal a nested function', () => {
  const fns: TreeFn[] = []
  for (let i = 0; i < 3000; i++) fns.push(fn('FUN_00' + (0x100000 + i * 16).toString(16)))
  const roots = buildFunctionTree(fns)
  const target = fns[1234].name

  assert.equal(visibleRows(roots, () => false).length, 1)
  const path = findFolderPath(roots, (f) => f.name === target)
  assert.ok(path && path[0] === 'fn' && path.length >= 2)
  const open = new Set(path)
  const rows = visibleRows(roots, (id) => open.has(id))
  assert.ok(rows.some((r) => r.kind === 'leaf' && r.fn.name === target))
  assert.ok(rows.length < 200)
  assert.equal(findFolderPath(roots, (f) => f.name === 'nope'), null)
})
