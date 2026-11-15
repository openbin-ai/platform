import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react'
import {
  buildFunctionTree,
  findFolderPath,
  visibleRows,
  ROOT_FUNCTIONS,
  type TreeFn,
} from '../api/functionTree'

// With a filter typed and this few matches, every folder starts open so the
// hits are visible without clicking through. Above it the tree stays manual.
const AUTO_EXPAND_MAX = 500

/**
 * Ghidra-style Symbol Tree for a function list: Functions / Imports / Thunks
 * folders with automatic prefix sub-folders. Renders rows only (no scroll
 * container) — the parent owns the scrolling element.
 */
export function FunctionTree<T extends TreeFn>({
  functions,
  filterActive,
  selectBy,
  selectedKey,
  onSelect,
  renderLeaf,
  leafTitle,
  selectedClass,
}: {
  functions: T[]
  filterActive: boolean
  /** Which field `selectedKey` refers to. */
  selectBy: 'name' | 'address'
  selectedKey: string | null
  onSelect: (fn: T) => void
  renderLeaf: (fn: T) => ReactNode
  leafTitle?: (fn: T) => string
  selectedClass: string
}) {
  const roots = useMemo(() => buildFunctionTree(functions), [functions])
  const [open, setOpen] = useState<Set<string>>(() => new Set([ROOT_FUNCTIONS]))
  // Folders the user closed while everything was auto-expanded by a filter.
  const [closedAuto, setClosedAuto] = useState<Set<string>>(() => new Set())
  const autoOpen = filterActive && functions.length <= AUTO_EXPAND_MAX

  const rows = useMemo(
    () => visibleRows(roots, (id) => (autoOpen ? !closedAuto.has(id) : open.has(id))),
    [roots, autoOpen, open, closedAuto],
  )

  const toggle = (id: string) => {
    const flip = (prev: Set<string>) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    }
    if (autoOpen) setClosedAuto(flip)
    else setOpen(flip)
  }

  // Selection can change from outside the tree (clicking a callee in the
  // code, history back/forward): open the folders above it and scroll to it.
  // Done as a render-time state adjustment (not an effect) so the folders are
  // already open on the first paint after the selection changes.
  const [revealedFor, setRevealedFor] = useState<{ key: string | null; roots: unknown }>({ key: null, roots: null })
  if (revealedFor.key !== selectedKey || revealedFor.roots !== roots) {
    setRevealedFor({ key: selectedKey, roots })
    const path = selectedKey === null ? null : findFolderPath(roots, (f) => f[selectBy] === selectedKey)
    if (path && !path.every((id) => open.has(id))) {
      const next = new Set(open)
      for (const id of path) next.add(id)
      setOpen(next)
    }
  }

  // Names can repeat (a thunk and the import it wraps); only the first
  // highlighted row is the scroll target.
  const firstSelected =
    selectedKey === null ? -1 : rows.findIndex((r) => r.kind === 'leaf' && r.fn[selectBy] === selectedKey)
  const selectedVisible = firstSelected !== -1
  const selectedRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selectedVisible) selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedKey, roots, selectedVisible])

  return (
    <ul className="text-xs" role="tree">
      {rows.map((row, idx) => {
        const pad = { paddingLeft: 8 + row.depth * 12 }
        if (row.kind === 'folder') {
          const { node } = row
          const Chevron = row.open ? ChevronDown : ChevronRight
          const Icon = row.open ? FolderOpen : Folder
          return (
            <li key={`d:${node.id}`} role="treeitem" aria-expanded={row.open}>
              <button
                onClick={() => toggle(node.id)}
                style={pad}
                className="flex w-full items-center gap-1 py-1 pr-3 text-left text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              >
                <Chevron className="h-3 w-3 shrink-0 text-zinc-600" />
                <Icon className="h-3.5 w-3.5 shrink-0 text-amber-500/80" />
                <span className={`min-w-0 flex-1 truncate ${row.depth === 0 ? 'font-medium text-zinc-200' : 'font-mono'}`}>
                  {node.label}
                </span>
                <span className="shrink-0 text-[10px] text-zinc-600">{node.count}</span>
              </button>
            </li>
          )
        }
        const { fn } = row
        const selected = fn[selectBy] === selectedKey
        const ref = idx === firstSelected ? selectedRef : undefined
        return (
          <li key={`f:${fn.address}`} role="treeitem" aria-selected={selected}>
            <button
              ref={ref}
              onClick={() => onSelect(fn)}
              title={leafTitle?.(fn)}
              // +16 lines leaf text up with folder labels (past the chevron).
              style={{ paddingLeft: pad.paddingLeft + 16 }}
              className={`flex w-full items-center gap-2 py-1 pr-3 text-left font-mono hover:bg-zinc-900 ${
                selected ? selectedClass : 'text-zinc-300'
              }`}
            >
              {renderLeaf(fn)}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
