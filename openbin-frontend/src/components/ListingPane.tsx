import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Full program listing (Ghidra Listing-view style): every memory block's
// code units in address order — instructions + defined data in .text,
// hexdump rows in .data, labels as anchors. Fed by the worker's `listing`
// field (ghidra-worker :6+); older analyses don't carry it and get the
// re-analyze empty state.
//
// The listing can be hundreds of thousands of rows, so rendering is
// windowed by hand: rows are fixed-height, the scroll container gets one
// tall spacer, and only the visible slice (+overscan) is mounted. No
// virtualization library — rows are uniform monospace lines, which is the
// one case where windowing is trivial.

export type ListingLine = {
  addr: string
  bytes: string
  text: string
  label?: string
}

export type ListingBlock = {
  block: string
  start: string
  end: string
  executable: boolean
  initialized: boolean
  truncated: boolean
  lines: ListingLine[]
}

/** Where to land when the pane opens (nonce re-fires an identical jump). */
export type ListingTarget = { block?: string; addr?: string; nonce: number }

type Row =
  | { kind: 'block'; b: ListingBlock }
  | { kind: 'label'; addr: string; label: string }
  | { kind: 'line'; addr: string; bytes: string; text: string }
  | { kind: 'note'; text: string }

const ROW_H = 20
const OVERSCAN = 30

/** "0x00401000" / "00401000" / "401000" → canonical lowercase hex, no 0x/leading zeros. */
function normAddr(s: string): string | null {
  const t = s.trim().toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]+$/.test(t)) return null
  return t.replace(/^0+(?=.)/, '')
}

function addrValue(s: string): bigint | null {
  const n = normAddr(s)
  if (n === null) return null
  try {
    return BigInt('0x' + n)
  } catch {
    return null
  }
}

export function ListingPane({
  blocks,
  target,
  onClose,
  isFn,
  onJumpFn,
}: {
  blocks: ListingBlock[] | undefined
  target: ListingTarget
  onClose: () => void
  /** Whether a label resolves to an extracted function (renders it as a link). */
  isFn: (name: string) => boolean
  /** Label click-through: close the listing and open that function. */
  onJumpFn: (name: string) => void
}) {
  // Flatten blocks into uniform rows. Labels get their own row (like
  // Ghidra) so every row keeps the same fixed height for windowing.
  const { rows, blockRowIndex } = useMemo(() => {
    const rows: Row[] = []
    const blockRowIndex = new Map<string, number>()
    for (const b of blocks ?? []) {
      blockRowIndex.set(b.block, rows.length)
      rows.push({ kind: 'block', b })
      if (!b.initialized) {
        rows.push({ kind: 'note', text: 'uninitialized — no bytes in the file (allocated at load time)' })
        continue
      }
      for (const l of b.lines) {
        if (l.label) rows.push({ kind: 'label', addr: l.addr, label: l.label })
        rows.push({ kind: 'line', addr: l.addr, bytes: l.bytes, text: l.text })
      }
      if (b.truncated) {
        rows.push({ kind: 'note', text: '… listing truncated for this block (size cap) — the analysis JSON carries a bounded listing' })
      }
    }
    return { rows, blockRowIndex }
  }, [blocks])

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(600)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setViewH(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scrollToRow = useCallback((idx: number) => {
    scrollRef.current?.scrollTo({ top: Math.max(0, idx * ROW_H - ROW_H * 3) })
  }, [])

  // Nearest row for an address: exact normalized match wins; otherwise the
  // first line row at or past the target. Linear scan — it's a click, not a
  // render path, and even 250k rows scan in a few ms.
  const findAddrRow = useCallback((addr: string): number => {
    const want = normAddr(addr)
    const wantVal = addrValue(addr)
    if (want === null) return -1
    let nearest = -1
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (r.kind !== 'line' && r.kind !== 'label') continue
      if (normAddr(r.addr) === want) return i
      if (nearest === -1 && wantVal !== null) {
        const v = addrValue(r.addr)
        if (v !== null && v >= wantVal) nearest = i
      }
    }
    return nearest
  }, [rows])

  // Land on the requested block/address whenever the open target changes.
  useEffect(() => {
    if (target.addr) {
      const idx = findAddrRow(target.addr)
      if (idx >= 0) { scrollToRow(idx); return }
    }
    if (target.block) {
      const idx = blockRowIndex.get(target.block)
      if (idx != null) { scrollToRow(idx); return }
    }
    scrollRef.current?.scrollTo({ top: 0 })
  }, [target.nonce, target.addr, target.block, blockRowIndex, findAddrRow, scrollToRow])

  const [jumpDraft, setJumpDraft] = useState('')
  const [jumpMiss, setJumpMiss] = useState(false)
  const jump = useCallback(() => {
    if (!jumpDraft.trim()) return
    const idx = findAddrRow(jumpDraft)
    setJumpMiss(idx < 0)
    if (idx >= 0) scrollToRow(idx)
  }, [jumpDraft, findAddrRow, scrollToRow])

  if (!blocks || blocks.length === 0) {
    return (
      <main className="flex min-h-0 flex-col">
        <PaneHeader onClose={onClose} />
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-zinc-500">
          <div>
            <p>This analysis doesn't carry a full listing.</p>
            <p className="mt-2 text-xs">
              The per-section listing ships with the latest worker — run{' '}
              <code className="rounded bg-zinc-900 px-1 text-zinc-300">openbin update</code> and
              re-run the decompile to populate it. Per-function disassembly still works meanwhile.
            </p>
          </div>
        </div>
      </main>
    )
  }

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN)
  const slice = rows.slice(first, last)

  return (
    <main className="flex min-h-0 flex-col">
      <PaneHeader onClose={onClose}>
        <select
          value=""
          onChange={(e) => {
            const idx = blockRowIndex.get(e.target.value)
            if (idx != null) scrollToRow(idx)
          }}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200"
          title="Jump to section"
        >
          <option value="" disabled>Jump to section…</option>
          {blocks.map((b) => (
            <option key={b.start + b.block} value={b.block}>
              {b.block} ({b.executable ? 'x' : b.initialized ? 'data' : 'bss'})
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <input
            value={jumpDraft}
            onChange={(e) => { setJumpDraft(e.target.value); setJumpMiss(false) }}
            onKeyDown={(e) => { if (e.key === 'Enter') jump() }}
            placeholder="address (e.g. 0x401000)"
            className={`w-40 rounded border bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none ${
              jumpMiss ? 'border-red-700' : 'border-zinc-700 focus:border-purple-600'
            }`}
          />
          <button
            onClick={jump}
            className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
          >
            Go
          </button>
        </div>
      </PaneHeader>
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        className="min-h-0 flex-1 overflow-auto bg-zinc-900/40 font-mono text-[11px] leading-none"
      >
        <div className="relative min-w-max" style={{ height: rows.length * ROW_H }}>
          {slice.map((r, i) => {
            const idx = first + i
            const style = { position: 'absolute' as const, top: idx * ROW_H, height: ROW_H, left: 0, right: 0 }
            if (r.kind === 'block') {
              return (
                <div key={idx} style={style} className="flex items-center gap-3 border-y border-zinc-800 bg-zinc-900 px-4 text-zinc-300">
                  <span className="font-semibold text-purple-300">{r.b.block}</span>
                  <span className="text-zinc-500">{r.b.start} – {r.b.end}</span>
                  <span className={r.b.executable ? 'text-emerald-300' : 'text-zinc-500'}>
                    {r.b.executable ? 'executable' : r.b.initialized ? 'data' : 'uninitialized'}
                  </span>
                </div>
              )
            }
            if (r.kind === 'note') {
              return (
                <div key={idx} style={style} className="flex items-center px-4 text-zinc-600 italic">
                  {r.text}
                </div>
              )
            }
            if (r.kind === 'label') {
              const linked = isFn(r.label)
              return (
                <div key={idx} style={style} className="flex items-center gap-3 px-4">
                  <span className="w-32 shrink-0 text-zinc-600">{r.addr}</span>
                  {linked ? (
                    <button
                      onClick={() => onJumpFn(r.label)}
                      className="text-amber-300 underline decoration-amber-700/60 underline-offset-2 hover:text-amber-200"
                      title="Open this function"
                    >
                      {r.label}:
                    </button>
                  ) : (
                    <span className="text-amber-300/80">{r.label}:</span>
                  )}
                </div>
              )
            }
            return (
              <div key={idx} style={style} className="flex items-center gap-3 px-4 hover:bg-zinc-800/40">
                <span className="w-32 shrink-0 text-zinc-600">{r.addr}</span>
                <span className="w-[21rem] shrink-0 truncate text-zinc-500">{r.bytes}</span>
                <span className="whitespace-pre text-zinc-200">{r.text}</span>
              </div>
            )
          })}
        </div>
      </div>
    </main>
  )
}

function PaneHeader({ onClose, children }: { onClose: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-zinc-800 p-2 pl-3">
      <span className="text-xs font-medium text-zinc-200">Program Listing</span>
      {children}
      <button
        onClick={onClose}
        title="Back to code view"
        className="ml-auto rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
      >
        ✕ Close
      </button>
    </div>
  )
}
