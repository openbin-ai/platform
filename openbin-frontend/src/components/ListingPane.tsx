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

type BlockRange = {
  b: ListingBlock
  headerIdx: number
  firstRow: number
  endRow: number
  startVal: bigint | null
  endVal: bigint | null
}

/** Result of an address lookup: the row to show, and why it isn't exact. */
type Landing = { idx: number; exact: boolean; note?: string }

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
  // blockRanges remembers each block's row span and address range so an
  // address lookup can stay inside the section that owns it.
  const { rows, blockRowIndex, blockRanges } = useMemo(() => {
    const rows: Row[] = []
    const blockRowIndex = new Map<string, number>()
    const blockRanges: BlockRange[] = []
    for (const b of blocks ?? []) {
      const headerIdx = rows.length
      blockRowIndex.set(b.block, headerIdx)
      rows.push({ kind: 'block', b })
      const firstRow = rows.length
      if (!b.initialized) {
        rows.push({ kind: 'note', text: 'uninitialized: no bytes in the file (allocated at load time)' })
      } else {
        for (const l of b.lines) {
          if (l.label) rows.push({ kind: 'label', addr: l.addr, label: l.label })
          rows.push({ kind: 'line', addr: l.addr, bytes: l.bytes, text: l.text })
        }
        if (b.truncated) {
          rows.push({ kind: 'note', text: '… listing truncated for this block (size cap): the analysis JSON carries a bounded listing' })
        }
      }
      blockRanges.push({
        b, headerIdx, firstRow, endRow: rows.length,
        startVal: addrValue(b.start), endVal: addrValue(b.end),
      })
    }
    return { rows, blockRowIndex, blockRanges }
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

  // Row for an address. The search stays inside the block that owns the
  // address: an exact match wins, else the first code unit at or past it
  // (an address inside a multi-byte data item or a 16-byte hexdump row).
  // When the block has nothing to show there (.bss, or past the truncation
  // cap) we land on the block header and say why, instead of silently
  // scrolling to some row in the next section. Linear scan over one block:
  // it's a click, not a render path.
  const findAddrRow = useCallback((addr: string): Landing | null => {
    const want = normAddr(addr)
    const wantVal = addrValue(addr)
    if (want === null || wantVal === null) return null
    const owner = blockRanges.find((r) => r.startVal !== null && r.endVal !== null && wantVal >= r.startVal && wantVal <= r.endVal)
    if (!owner) return null
    if (!owner.b.initialized) {
      return { idx: owner.headerIdx, exact: false, note: `${addr} is in ${owner.b.block}, which is uninitialized: no bytes in the file.` }
    }
    let nearest = -1
    for (let i = owner.firstRow; i < owner.endRow; i++) {
      const r = rows[i]
      if (r.kind !== 'line' && r.kind !== 'label') continue
      if (normAddr(r.addr) === want) return { idx: i, exact: true }
      if (nearest === -1) {
        const v = addrValue(r.addr)
        if (v !== null && v > wantVal) nearest = i
      }
    }
    if (nearest !== -1) {
      // The address sits inside the previous code unit; show that unit.
      let j = nearest - 1
      while (j >= owner.firstRow && rows[j].kind !== 'line') j--
      return { idx: j >= owner.firstRow ? j : nearest, exact: false }
    }
    const why = owner.b.truncated ? 'past the listing cap for this block' : 'has no code unit in the listing'
    return { idx: owner.headerIdx, exact: false, note: `${addr} is in ${owner.b.block} but ${why}.` }
  }, [rows, blockRanges])

  // The row a jump landed on, flashed briefly (rows are windowed, so the
  // highlight is state-driven rather than a classList toggle on the DOM),
  // plus a note when the exact address could not be shown.
  const [landed, setLanded] = useState<number | null>(null)
  const [landNote, setLandNote] = useState<string | null>(null)
  useEffect(() => {
    if (landed === null) return
    const t = window.setTimeout(() => setLanded(null), 1600)
    return () => window.clearTimeout(t)
  }, [landed])

  const landOn = useCallback((l: Landing) => {
    scrollToRow(l.idx)
    setLanded(l.idx)
    setLandNote(l.note ?? null)
  }, [scrollToRow])

  // Land on the requested block/address whenever the open target changes.
  useEffect(() => {
    setLandNote(null)
    if (target.addr) {
      const l = findAddrRow(target.addr)
      if (l) { landOn(l); return }
    }
    if (target.block) {
      const idx = blockRowIndex.get(target.block)
      if (idx != null) { scrollToRow(idx); return }
    }
    scrollRef.current?.scrollTo({ top: 0 })
  }, [target.nonce, target.addr, target.block, blockRowIndex, findAddrRow, scrollToRow, landOn])

  const [jumpDraft, setJumpDraft] = useState('')
  const [jumpMiss, setJumpMiss] = useState(false)
  const jump = useCallback(() => {
    if (!jumpDraft.trim()) return
    const l = findAddrRow(jumpDraft)
    setJumpMiss(l === null)
    if (l) landOn(l)
  }, [jumpDraft, findAddrRow, landOn])

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
        {landNote && <span className="truncate text-[11px] text-amber-300" title={landNote}>{landNote}</span>}
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
            const flash = idx === landed ? ' search-flash' : ''
            if (r.kind === 'block') {
              return (
                <div key={idx} style={style} data-addr={r.b.start} className={`flex items-center gap-3 border-y border-zinc-800 bg-zinc-900 px-4 text-zinc-300${flash}`}>
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
                <div key={idx} style={style} data-addr={r.addr} className={`flex items-center gap-3 px-4${flash}`}>
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
              <div key={idx} style={style} data-addr={r.addr} className={`flex items-center gap-3 px-4 hover:bg-zinc-800/40${flash}`}>
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
