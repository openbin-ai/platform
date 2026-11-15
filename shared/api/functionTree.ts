// Folder tree for the function sidebar, modelled on Ghidra's Symbol Tree:
// top-level category folders (Functions / Imports / Thunks), and inside each
// one, automatic "organization" folders keyed by shared name prefix once a
// level holds more than MAX_GROUP entries (FUN_00…, FUN_001…, ieee…, _Z…).

export type TreeFn = {
  name: string
  address: string
  external: boolean
  thunk: boolean
}

export type LeafNode<T> = { kind: 'leaf'; fn: T }
export type FolderNode<T> = {
  kind: 'folder'
  /** Stable across rebuilds as long as the prefix path is the same. */
  id: string
  label: string
  /** Total functions underneath, at any depth. */
  count: number
  children: TreeNode<T>[]
}
export type TreeNode<T> = LeafNode<T> | FolderNode<T>

/** A level with more entries than this gets split into prefix folders. */
export const MAX_GROUP = 40
/** Prefix buckets smaller than this stay as plain rows instead of a folder. */
const MIN_FOLDER = 3

export const ROOT_FUNCTIONS = 'fn'
export const ROOT_IMPORTS = 'imp'
export const ROOT_THUNKS = 'thunk'

function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}

// `items` must be sorted by UTF-16 code unit and all share their first
// `prefixLen` characters, so entries with the same next character are
// contiguous. Every folder's prefix is strictly longer than its parent's,
// which bounds the recursion by the longest name.
function organize<T extends TreeFn>(items: T[], prefixLen: number, parentId: string): TreeNode<T>[] {
  if (items.length <= MAX_GROUP) return items.map((fn) => ({ kind: 'leaf', fn }))
  const out: TreeNode<T>[] = []
  let i = 0
  while (i < items.length) {
    const name = items[i].name
    if (name.length <= prefixLen) {
      out.push({ kind: 'leaf', fn: items[i] })
      i++
      continue
    }
    const ch = name.charCodeAt(prefixLen)
    let j = i + 1
    while (j < items.length && items[j].name.length > prefixLen && items[j].name.charCodeAt(prefixLen) === ch) j++
    if (j - i < MIN_FOLDER) {
      for (let k = i; k < j; k++) out.push({ kind: 'leaf', fn: items[k] })
    } else {
      const bucket = items.slice(i, j)
      // Sorted, so first/last bound the common prefix of the whole bucket.
      const lcp = commonPrefixLen(bucket[0].name, bucket[bucket.length - 1].name)
      const label = bucket[0].name.slice(0, lcp)
      const id = `${parentId}/${label}`
      out.push({ kind: 'folder', id, label, count: bucket.length, children: organize(bucket, lcp, id) })
    }
    i = j
  }
  return out
}

function byName<T extends TreeFn>(a: T, b: T): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  return a.address < b.address ? -1 : a.address > b.address ? 1 : 0
}

export function buildFunctionTree<T extends TreeFn>(functions: T[]): FolderNode<T>[] {
  const defined: T[] = []
  const imports: T[] = []
  const thunks: T[] = []
  for (const f of functions) {
    if (f.external) imports.push(f)
    else if (f.thunk) thunks.push(f)
    else defined.push(f)
  }
  const roots: FolderNode<T>[] = []
  const add = (id: string, label: string, items: T[]) => {
    if (items.length === 0) return
    items.sort(byName)
    roots.push({ kind: 'folder', id, label, count: items.length, children: organize(items, 0, id) })
  }
  add(ROOT_FUNCTIONS, 'Functions', defined)
  add(ROOT_IMPORTS, 'Imports', imports)
  add(ROOT_THUNKS, 'Thunks', thunks)
  return roots
}

/** Folder ids from the root down to the first leaf matching `pred`, or null. */
export function findFolderPath<T>(roots: TreeNode<T>[], pred: (fn: T) => boolean): string[] | null {
  const path: string[] = []
  const walk = (nodes: TreeNode<T>[]): boolean => {
    for (const n of nodes) {
      if (n.kind === 'leaf') {
        if (pred(n.fn)) return true
      } else {
        path.push(n.id)
        if (walk(n.children)) return true
        path.pop()
      }
    }
    return false
  }
  return walk(roots) ? path.slice() : null
}

export type TreeRow<T> =
  | { kind: 'folder'; depth: number; node: FolderNode<T>; open: boolean }
  | { kind: 'leaf'; depth: number; fn: T }

/** Flatten to the rows that are actually visible given which folders are open. */
export function visibleRows<T>(roots: TreeNode<T>[], isOpen: (id: string) => boolean): TreeRow<T>[] {
  const rows: TreeRow<T>[] = []
  const walk = (nodes: TreeNode<T>[], depth: number) => {
    for (const n of nodes) {
      if (n.kind === 'leaf') {
        rows.push({ kind: 'leaf', depth, fn: n.fn })
      } else {
        const open = isOpen(n.id)
        rows.push({ kind: 'folder', depth, node: n, open })
        if (open) walk(n.children, depth + 1)
      }
    }
  }
  walk(roots, 0)
  return rows
}
