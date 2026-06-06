import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { Network } from 'lucide-react'
import { useApi } from '@shared/api/client'
import { canEdit, isOwner, type ProjectRole } from '@shared/api/collaborators'
import { ShareProjectModal } from '@shared/components/ShareProjectModal'
import { useStreamingApi } from '@shared/api/streaming'
import { highlightC } from '../syntax/highlight'
import { ReportEditor } from './Report'
import { Gallery } from '../components/Gallery'
import { ScreenshotModal } from '../components/ScreenshotModal'
import { captureScreen } from '../components/captureScreen'

// Identifier alphabet used to find function-name occurrences in both
// pseudocode (post-Shiki) and disassembly (raw text). Wider than a typical
// language tokenizer because mangled PE/Mach-O symbols can include `.`, `@`,
// `?` and `$`. First-char excludes digits + `.` so we don't accidentally
// match the leading byte of a hex address like `00401234` against a
// hypothetical function named `00401234`.
// Fetches a JSON body from a presigned URL (CloudFront-signed today). We
// deliberately do NOT pass the project's bearer token — the signed URL is
// the authorization. `referrerPolicy: 'no-referrer'` keeps the signature
// from leaking via the Referer header to any downstream service. On HTTP
// error we throw with the status so the caller's catch can surface a
// useful message; on JSON parse error we throw the underlying parse
// exception. Cache: 'no-store' because the URL itself rotates per render.
async function fetchFromSignedUrl<T>(url: string): Promise<T> {
  const resp = await fetch(url, {
    method: 'GET',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
  })
  if (!resp.ok) {
    throw new Error(`analysis download failed: status=${resp.status}`)
  }
  return (await resp.json()) as T
}

// Client-side port of RenameService.applyMapToBinaryAnalysisJson (Java).
// When the worker JSON is fetched directly from CloudFront the backend has
// no chance to apply user-applied renames, so we do it here over the
// in-memory analysis object.
//
// Two passes, order matters:
//   1. Variable-scope renames are stored against a specific function body
//      (sourcePath="function:<originalName>") because Ghidra reuses
//      placeholder names like uVar1/param_1 across every function — a
//      global pass would mass-rewrite identical names everywhere. So we
//      rewrite each owning function's decompiled/signature/disassembly
//      lines only, using the function's *original* name to match.
//   2. Global renames (function-scope and other non-variable scopes) get
//      a word-boundary substitution applied to every function name,
//      signature, decompiled body, disassembly line, xref entry, and
//      addressed-symbol name (exports/entry/tls). Function names move
//      after the variable pass so the function:<originalName> tag still
//      resolves above.
//
// SUGGESTED renames are ignored — only APPLIED ones change the view.
function applyRenamesToAnalysis(analysis: BinaryAnalysis, renames: Rename[]): BinaryAnalysis {
  const applied = renames.filter((r) => r.status === 'APPLIED')
  if (applied.length === 0) return analysis

  const varsByFn = new Map<string, Array<[string, string]>>()
  const globalRenames: Array<[string, string]> = []
  for (const r of applied) {
    if (r.scope === 'variable') {
      if (r.sourcePath && r.sourcePath.startsWith('function:')) {
        const fnName = r.sourcePath.slice('function:'.length)
        const list = varsByFn.get(fnName)
        if (list) list.push([r.original, r.suggested])
        else varsByFn.set(fnName, [[r.original, r.suggested]])
      }
      // Variable renames without a function: sourcePath are skipped —
      // they have no scope, so applying them globally would be unsafe
      // (mirrors the backend's behavior).
    } else {
      globalRenames.push([r.original, r.suggested])
    }
  }

  const applyPairs = (s: string, pairs: Array<[string, string]>): string => {
    if (!s || pairs.length === 0) return s
    let out = s
    for (const [orig, sugg] of pairs) {
      out = out.replace(new RegExp(`\\b${escapeRegex(orig)}\\b`, 'g'), sugg)
    }
    return out
  }

  // Pass 1: per-function variable rewrite using the function's ORIGINAL name.
  let fns = analysis.functions
  if (varsByFn.size > 0) {
    fns = fns.map((fn) => {
      const vars = varsByFn.get(fn.name)
      if (!vars) return fn
      return {
        ...fn,
        signature: applyPairs(fn.signature, vars),
        decompiled: fn.decompiled !== null ? applyPairs(fn.decompiled, vars) : fn.decompiled,
        disassembly: fn.disassembly
          ? fn.disassembly.map((l) => ({ ...l, text: applyPairs(l.text, vars) }))
          : fn.disassembly,
      }
    })
  }

  // Pass 2: global rename substitution everywhere a function name might appear.
  if (globalRenames.length === 0) {
    return { ...analysis, functions: fns }
  }
  const G = (s: string) => applyPairs(s, globalRenames)
  const fnsFinal = fns.map((fn) => ({
    ...fn,
    name: G(fn.name),
    signature: G(fn.signature),
    decompiled: fn.decompiled !== null ? G(fn.decompiled) : fn.decompiled,
    disassembly: fn.disassembly ? fn.disassembly.map((l) => ({ ...l, text: G(l.text) })) : fn.disassembly,
    xrefs: {
      callers: fn.xrefs.callers.map(G),
      callees: fn.xrefs.callees.map(G),
    },
  }))
  const mapNames = <T extends AddressedSymbol>(xs?: T[]): T[] | undefined =>
    xs ? xs.map((x) => ({ ...x, name: G(x.name) })) : xs
  return {
    ...analysis,
    functions: fnsFinal,
    exports: mapNames(analysis.exports),
    entry_points: mapNames(analysis.entry_points),
    tls_callbacks: mapNames(analysis.tls_callbacks),
  }
}

// Normalize an address string for map lookups. Accepts:
//   "140001180"         — Ghidra's raw form
//   "0x140001180"       — C / disasm form
//   "ram:140001180"     — Ghidra's space-qualified form
//   "00000000`140001180" — Windbg-style (rare but possible)
// Returns lowercase hex without prefix / leading zeros. Empty string on
// inputs that don't look hex at all.
function canonAddr(raw: string): string {
  if (!raw) return ''
  let s = raw.trim().toLowerCase()
  // Strip any ram:/rom:/etc. memory-space prefix Ghidra prepends.
  const colon = s.lastIndexOf(':')
  if (colon >= 0) s = s.slice(colon + 1)
  // Strip windbg-style segment backtick.
  const tick = s.lastIndexOf('`')
  if (tick >= 0) s = s.slice(tick + 1)
  if (s.startsWith('0x')) s = s.slice(2)
  // Drop leading zeros but keep at least one digit so "0" stays "0".
  s = s.replace(/^0+(?=.)/, '')
  return /^[0-9a-f]+$/.test(s) ? s : ''
}

// Panel layout — fixed left width, resizable right width, both collapsible
// to a 36px rail with a single expand button. State is persisted to
// localStorage so a refresh restores the user's preferred layout.
const LEFT_OPEN_KEY = 'openbin.leftPanelOpen'
const RIGHT_OPEN_KEY = 'openbin.rightPanelOpen'
const RIGHT_WIDTH_KEY = 'openbin.rightPanelWidth'
const LEFT_WIDTH = 280
const RAIL_WIDTH = 36
const RIGHT_WIDTH_DEFAULT = 320
const RIGHT_WIDTH_MIN = 280
const RIGHT_WIDTH_MAX = 900

// Mirrors the per-function payload that ghidra-worker/scripts/extract.py emits.
// Disassembly + decompiled are nullable: thunks and externals legitimately have
// neither (no body to walk), and we explicitly distinguish that case from
// "empty array" so the UI can render the right empty-state copy.
type DisasmLine = { addr: string; text: string }
type Xrefs = { callers: string[]; callees: string[] }
type BinaryFunction = {
  name: string
  address: string
  size: number
  signature: string
  decompiled: string | null
  disassembly: DisasmLine[] | null
  xrefs: Xrefs
  external: boolean
  thunk: boolean
  // True when Ghidra produced a body but extract.py skipped decompile/disasm
  // because the per-result MAX_DECOMPILE_BODIES budget was already spent.
  // Renders a distinct empty-state ("metadata only — body capped") so the
  // user can tell this apart from a thunk or an external import.
  body_skipped?: boolean
}
// All `*_symbols`/`entry_points`/etc. fields are optional because the v1.0
// CLI ingest schema doesn't ship them, and older worker JSON cached in the
// DB likewise won't have them. Code paths that read these must tolerate
// `undefined` and fall back to "no data" empty states.
type AddressedSymbol = { name: string; address: string }
type DataSymbol = {
  name: string
  address: string
  type: string
  // All four optional — v1 schema didn't carry them, so older cached
  // projects still render (with empty detail) when the user opens them.
  size?: number
  value?: string
  bytes_preview?: string
  ref_count?: number
}
type MemoryBlock = {
  name: string
  start: string
  end: string
  size: number
  permissions: string
  executable: boolean
  initialized: boolean
}
type BinaryAnalysis = {
  functions: BinaryFunction[]
  strings: string[]
  imports: string[]
  exports?: AddressedSymbol[]
  entry_points?: AddressedSymbol[]
  tls_callbacks?: AddressedSymbol[]
  data_symbols?: DataSymbol[]
  memory_blocks?: MemoryBlock[]
  metadata: Record<string, string | number>
}

type ProjectSummary = {
  id: string
  kind: 'APK' | 'BIN'
  name: string
  status: string
  arch: string | null
  executableFormat: string | null
  compiler: string | null
  languageId: string | null
  imageBase: string | null
  // BIN schema-2.0: short-TTL CloudFront signed URL for the worker JSON.
  // When non-empty the frontend fetches the body directly from CloudFront
  // instead of going through /api/projects/{id}/binary-analysis. Null/empty
  // means legacy inline JSONB — fall back to the backend endpoint.
  analysisDownloadUrl?: string | null
  analysisSizeBytes?: number
  // Caller's role on this project ('OWNER' | 'EDITOR' | 'VIEWER').
  // Null on pre-collab backends — treat as OWNER for back-compat.
  role?: ProjectRole | null
}

type ViewMode = 'pseudo' | 'disasm' | 'deobf'
type SidePanelKind =
  | 'xrefs' | 'chain' | 'network' | 'ask' | 'ai' | 'crypto'
  | 'renames' | 'report' | 'gallery'
  | 'strings' | 'imports'
// Tab in the LEFT sidebar (next to the Call Graph button). Default is the
// existing function list; the rest are symbol-navigation views surfaced
// from the v2 worker output. Lives on the LEFT because they share the
// "where do I go next?" intent with the function list, not the
// per-function inspector tools on the RIGHT.
type LeftTab = 'functions' | 'entry' | 'exports' | 'tls' | 'data' | 'sections'

// Server-side AI-cleaned versions of obfuscated functions. The original
// decompiled body in the analysis JSON is untouched — chain/xref/network/
// rename indexers continue to operate against it — so deobf is purely a
// view-layer overlay. Keyed by ORIGINAL function name (pre-rename) on the
// server; the ProjectView Map below uses the same key.
type Deobfuscation = {
  originalName: string
  deobfuscated: string
  explanation: string | null
  model: string
  inputTokens: number
  outputTokens: number
  createdAt: string
}

// Optional jump target passed to selectFn — lets a side-panel hit navigate
// to a specific line in the pseudocode (or address in the disassembly)
// rather than the function's first line. Nonce changes per click so the
// same target can be flashed again on a repeated click.
type JumpHint = { pseudoLine?: number; asmAddr?: string }

// Discriminated jump target used by the unified click dispatcher. `fn` =
// navigate to a function by name; `data` = surface a data symbol in the
// Data side panel; `addr` = resolve a hex literal or FUN_/DAT_-prefixed
// token to whichever index it matches (function-by-address takes precedence
// over data-by-address).
type JumpTarget =
  | { kind: 'fn'; value: string }
  | { kind: 'data'; value: string }
  | { kind: 'addr'; value: string }

// Bundle of address + name indexes used by render-time link wrapping and
// click dispatch. Passed as one object so adding a new index later (e.g.
// strings-by-address, future xref tables) doesn't churn every component
// signature in the prop chain.
type SymbolLookups = {
  fnByName: Map<string, BinaryFunction>
  fnByAddr: Map<string, BinaryFunction>
  dataByName: Map<string, DataSymbol>
  dataByAddr: Map<string, DataSymbol>
}
type PendingHighlight = {
  fnName: string
  pseudoLine?: number
  asmAddr?: string
  nonce: number
}

// Screenshot capture state shared between the project header buttons and the
// ScreenshotModal. `pick` opens the modal for paste/drop/browse; `capture`
// opens it pre-loaded with the cropped blob from the desktop capture.
type ShotState = null | { mode: 'pick' } | { mode: 'capture'; blob: Blob }

// Mirrors the backend RenameDto. Scope is open-text ("function", "variable",
// or legacy APK kinds); confidence is whatever the model returned plus
// "manual" for direct user renames via the inline name editor.
type Rename = {
  id: string
  original: string
  suggested: string
  scope: string
  status: 'SUGGESTED' | 'APPLIED'
  confidence: string
  sourcePath: string | null
  rationale: string | null
  createdAt: string
}

// Mirrors the backend's CredentialResponse / AnalysisResponse / Hotspot / Ioc
// records. We only type the fields we render — the bigger model-output blob
// is preserved by the server but the UI doesn't need it.
type Credential = {
  id: string
  provider: string
  label: string
}
type AnalysisMode = 'MALWARE' | 'VULN_RESEARCH'
type Hotspot = { path: string; severity: 'high' | 'medium' | 'low' | string; reason: string }
type Ioc = { type: string; value: string; occurrences: number }
type AnalysisResponse = {
  mode: AnalysisMode
  summary: string
  hotspots: Hotspot[]
  iocs: Ioc[]
  nextSteps: string[]
  model: string
  inputTokens: number
  outputTokens: number
}

export function ProjectView() {
  const { id = '' } = useParams<{ id: string }>()
  const api = useApi()

  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [analysis, setAnalysis] = useState<BinaryAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('pseudo')
  const [filter, setFilter] = useState('')
  const [sidePanel, setSidePanel] = useState<SidePanelKind>('ai')
  // Left-sidebar tab. Stays in URL-less local state because the user's
  // primary task is reading code; the tab choice doesn't deserve a route.
  const [leftTab, setLeftTab] = useState<LeftTab>('functions')

  // Set whenever a side-panel hit (Network call site today; Xrefs / Chain /
  // future Crypto and Search) wants the code view to scroll to + flash a
  // specific spot. Cleared on plain function selection so a later select
  // doesn't accidentally re-fire a stale jump.
  const [pendingHighlight, setPendingHighlight] = useState<PendingHighlight | null>(null)

  // When the user clicks a DAT_xxx token in decompiled C / disasm, we route
  // them to the Data side panel with this name pre-selected. Cleared when
  // the user dismisses or selects something else in the panel.
  const [selectedDataName, setSelectedDataName] = useState<string | null>(null)

  // Screenshot capture state + gallery refresh counter. Bumping galleryKey
  // forces the Gallery panel to refetch when a new shot is saved.
  const [shot, setShot] = useState<ShotState>(null)
  const [galleryKey, setGalleryKey] = useState(0)
  const [captureErr, setCaptureErr] = useState<string | null>(null)

  const startCapture = useCallback(async () => {
    setCaptureErr(null)
    try {
      const blob = await captureScreen()
      if (blob) setShot({ mode: 'capture', blob })
    } catch (e) {
      setCaptureErr((e as Error).message)
    }
  }, [])

  const onScreenshotSaved = useCallback(() => {
    setShot(null)
    setGalleryKey((k) => k + 1)
    setSidePanel('gallery')
  }, [])

  // Panel chrome — left collapsible, right collapsible + resizable. Initial
  // values come from localStorage so the layout survives a refresh; the
  // setters below mirror writes back. Width is clamped to [MIN, MAX] on
  // read so a hand-edited localStorage value can't break the layout.
  const [leftOpen, setLeftOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const v = window.localStorage.getItem(LEFT_OPEN_KEY)
    return v === null ? true : v === '1'
  })
  const [rightOpen, setRightOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const v = window.localStorage.getItem(RIGHT_OPEN_KEY)
    return v === null ? true : v === '1'
  })
  const [rightWidth, setRightWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return RIGHT_WIDTH_DEFAULT
    const v = window.localStorage.getItem(RIGHT_WIDTH_KEY)
    const n = v ? parseInt(v, 10) : NaN
    return Number.isFinite(n)
      ? Math.min(RIGHT_WIDTH_MAX, Math.max(RIGHT_WIDTH_MIN, n))
      : RIGHT_WIDTH_DEFAULT
  })
  useEffect(() => { window.localStorage.setItem(LEFT_OPEN_KEY, leftOpen ? '1' : '0') }, [leftOpen])
  useEffect(() => { window.localStorage.setItem(RIGHT_OPEN_KEY, rightOpen ? '1' : '0') }, [rightOpen])
  useEffect(() => { window.localStorage.setItem(RIGHT_WIDTH_KEY, String(rightWidth)) }, [rightWidth])

  // Drag-to-resize the right panel. Handle sits on the LEFT edge of the
  // panel, so dragging the mouse leftward widens. Listeners attach to the
  // window so a fast mouse exit doesn't lose the drag; body cursor +
  // user-select are flipped during the drag to suppress text selection.
  const startResizeRight = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = rightWidth
    const onMove = (ev: MouseEvent) => {
      const dx = startX - ev.clientX
      const next = Math.min(RIGHT_WIDTH_MAX, Math.max(RIGHT_WIDTH_MIN, startW + dx))
      setRightWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [rightWidth])

  // Cached AI deobfuscations for this project, keyed by the ORIGINAL (pre-
  // rename) function name — matches the server's storage key. The CodePane
  // checks this map to decide whether to enable the "Deobf" view tab and
  // whether the Deobfuscate button should say "Generate" or "View".
  const [deobfs, setDeobfs] = useState<Map<string, Deobfuscation>>(new Map())

  // Fetch project + analysis + deobf cache. Used on mount and after a
  // rename — the rename path calls reload(newName) so the freshly-renamed
  // view replaces the old one and the selected function tracks across the
  // rename. Deobf is fetched alongside (single round trip) so the third
  // view tab is immediately accurate on page load.
  //
  // Worker JSON sourcing (schema 2.0): project.analysisDownloadUrl is a
  // CloudFront signed URL minted by the backend when the analysis lives
  // in S3. Frontend fetches directly from CloudFront via the URL — no
  // backend hop, no inline JSONB streaming. Legacy projects (pre-S3
  // migration) have analysisDownloadUrl=null/missing and fall back to
  // the existing /api/projects/{id}/binary-analysis endpoint.
  const reload = useCallback(async (preserveName?: string) => {
    try {
      // Fetch project detail FIRST so we know whether to go CloudFront
      // or fall back to the legacy backend endpoint for the analysis.
      const p = await api<ProjectSummary>(`/api/projects/${id}`)
      const useCloudFront = !!p.analysisDownloadUrl
      const analysisFetch: Promise<BinaryAnalysis> =
        useCloudFront
          ? fetchFromSignedUrl<BinaryAnalysis>(p.analysisDownloadUrl!)
          : api<BinaryAnalysis>(`/api/projects/${id}/binary-analysis`)
      // On the CloudFront path the worker JSON is raw — backend never sees
      // it — so the frontend must apply user renames itself. On the legacy
      // /binary-analysis path the backend has already applied them, so we
      // skip the fetch (and skip applyRenamesToAnalysis below).
      const renamesFetch: Promise<Rename[]> = useCloudFront
        ? api<Rename[]>(`/api/projects/${id}/renames`).catch(() => [] as Rename[])
        : Promise.resolve([] as Rename[])
      const [aRaw, d, renames] = await Promise.all([
        analysisFetch,
        // Treat a deobf-fetch failure as "no deobfs yet" — endpoint is
        // BIN-only and returns [] when there's nothing stored. Crashing
        // the whole project load on this would be a regression.
        api<Deobfuscation[]>(`/api/projects/${id}/deobfuscations`).catch(() => [] as Deobfuscation[]),
        renamesFetch,
      ])
      const a = useCloudFront ? applyRenamesToAnalysis(aRaw, renames) : aRaw
      setProject(p)
      setAnalysis(a)
      setDeobfs(new Map(d.map((x) => [x.originalName, x])))
      setSelectedName((prev) => {
        if (preserveName) return preserveName
        if (prev && a.functions.some((f) => f.name === prev)) return prev
        // Default-select something useful: prefer "main", else first concrete,
        // else first entry.
        const fns = a.functions
        const main = fns.find((f) => f.name === 'main')
        const concrete = fns.find((f) => !f.external && !f.thunk)
        return main?.name ?? concrete?.name ?? fns[0]?.name ?? null
      })
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [api, id])

  useEffect(() => { void reload() }, [reload])

  const fnByName = useMemo(() => {
    if (!analysis) return new Map<string, BinaryFunction>()
    return new Map(analysis.functions.map((f) => [f.name, f]))
  }, [analysis])

  // Address-indexed lookups. Ghidra emits addresses without a 0x prefix and
  // with arbitrary leading-zero padding ("00140001180"); decompiled C and
  // disassembly emit them with `0x` and minimal padding ("0x140001180").
  // canonAddr normalizes both to a lowercase, unpadded hex string so the
  // map keys line up regardless of source.
  const fnByAddr = useMemo(() => {
    const m = new Map<string, BinaryFunction>()
    if (!analysis) return m
    for (const f of analysis.functions) {
      const k = canonAddr(f.address)
      if (k && !m.has(k)) m.set(k, f)
    }
    return m
  }, [analysis])

  // Data symbols indexed by both name and (normalized) address. Click-
  // through from the decompiled view uses these to resolve references to
  // DAT_xxx labels or to raw hex literals that point into a data region.
  const dataByName = useMemo(() => {
    const m = new Map<string, DataSymbol>()
    if (!analysis?.data_symbols) return m
    for (const d of analysis.data_symbols) {
      if (!m.has(d.name)) m.set(d.name, d)
    }
    return m
  }, [analysis])

  const dataByAddr = useMemo(() => {
    const m = new Map<string, DataSymbol>()
    if (!analysis?.data_symbols) return m
    for (const d of analysis.data_symbols) {
      const k = canonAddr(d.address)
      if (k && !m.has(k)) m.set(k, d)
    }
    return m
  }, [analysis])

  const filtered = useMemo(() => {
    if (!analysis) return []
    const q = filter.trim().toLowerCase()
    if (!q) return analysis.functions
    return analysis.functions.filter(
      (f) => f.name.toLowerCase().includes(q) || f.address.toLowerCase().includes(q),
    )
  }, [analysis, filter])

  // Bundle the lookup maps into a single object so deeper components don't
  // need a four-prop add. useMemo keeps the reference stable across renders
  // unless one of the underlying maps actually changes.
  const lookups: SymbolLookups = useMemo(() => ({
    fnByName, fnByAddr, dataByName, dataByAddr,
  }), [fnByName, fnByAddr, dataByName, dataByAddr])

  const selected = selectedName ? fnByName.get(selectedName) ?? null : null

  // Selecting a function whose body we can't display (external/thunk) auto-
  // flips the tab away from disasm so the user doesn't stare at an empty
  // pane wondering what went wrong.
  //
  // The optional {@link JumpHint} lets a side-panel hit drive both the
  // function selection AND a scroll-to-line / scroll-to-addr + flash inside
  // that function. Passing pseudoLine forces the pseudocode tab; asmAddr
  // forces the disassembly tab. Nonce uses Date.now() so clicking the
  // same hit twice still triggers a fresh flash (state shape changes via
  // the nonce even when the location is identical).
  const selectFn = useCallback((name: string, hint?: JumpHint) => {
    setSelectedName(name)
    const fn = fnByName.get(name)
    if (fn && (fn.external || fn.thunk)) {
      setView('pseudo')
      setPendingHighlight(null)
      return
    }
    if (hint?.pseudoLine != null) {
      setView('pseudo')
      setPendingHighlight({ fnName: name, pseudoLine: hint.pseudoLine, nonce: Date.now() })
    } else if (hint?.asmAddr != null) {
      setView('disasm')
      setPendingHighlight({ fnName: name, asmAddr: hint.asmAddr, nonce: Date.now() })
    } else {
      // No hint — drop any stale pending highlight from a previous panel
      // click so the new function paints clean.
      setPendingHighlight(null)
    }
  }, [fnByName])

  // Unified jump dispatcher for click-through from decompiled C / disasm.
  // Resolves a click target in priority order:
  //   1. function-by-name (e.g. `FUN_140001180` matches an extracted fn)
  //   2. function-by-address (the raw hex inside a FUN_/SUB_ name, or a bare
  //      `0x...` literal that points at a function entry)
  //   3. data-by-name (e.g. `DAT_140ae8d00` matches an extracted data symbol)
  //   4. data-by-address (a bare hex literal pointing into mapped data)
  // Returns a boolean so the caller can suppress default behavior on a hit
  // and skip wrapping on a miss (keeps unresolved tokens as plain text).
  const jumpToTarget = useCallback((target: { kind: 'fn' | 'data' | 'addr'; value: string }): boolean => {
    if (target.kind === 'fn') {
      const fn = fnByName.get(target.value)
      if (fn) { selectFn(fn.name); return true }
      return false
    }
    if (target.kind === 'data') {
      const d = dataByName.get(target.value)
      if (d) {
        setSelectedDataName(d.name)
        setLeftTab('data')
        return true
      }
      return false
    }
    // kind === 'addr' — canonicalize then probe both indexes.
    const k = canonAddr(target.value)
    if (!k) return false
    const fn = fnByAddr.get(k)
    if (fn) { selectFn(fn.name); return true }
    const d = dataByAddr.get(k)
    if (d) {
      setSelectedDataName(d.name)
      setLeftTab('data')
      return true
    }
    return false
  }, [fnByName, fnByAddr, dataByName, dataByAddr, selectFn])

  if (loading) {
    return <CenteredMessage>Loading analysis…</CenteredMessage>
  }
  if (error) {
    return (
      <CenteredMessage>
        <div className="text-red-400">{error}</div>
        <Link to="/" className="mt-4 inline-block text-xs text-purple-400 hover:underline">
          ← Back to projects
        </Link>
      </CenteredMessage>
    )
  }
  if (!project || !analysis) {
    return <CenteredMessage>No data.</CenteredMessage>
  }

  const gridCols =
    `${leftOpen ? LEFT_WIDTH : RAIL_WIDTH}px ` +
    `minmax(0,1fr) ` +
    `${rightOpen ? rightWidth : RAIL_WIDTH}px`

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      <Header
        project={project}
        functionCount={analysis.functions.length}
        onPickScreenshot={() => setShot({ mode: 'pick' })}
        onStartCapture={() => { void startCapture() }}
        onShare={() => setShareOpen(true)}
      />
      {shareOpen && (
        <ShareProjectModal
          projectId={project.id}
          accent="purple"
          onClose={() => setShareOpen(false)}
        />
      )}
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: gridCols }}>
        {leftOpen ? (
          <LeftSidebar
            projectId={id}
            tab={leftTab}
            onTabChange={setLeftTab}
            functions={filtered}
            filter={filter}
            onFilterChange={setFilter}
            selectedName={selectedName}
            onSelect={selectFn}
            total={analysis.functions.length}
            analysis={analysis}
            lookups={lookups}
            onJump={jumpToTarget}
            selectedDataName={selectedDataName}
            onSelectData={setSelectedDataName}
            onCollapse={() => setLeftOpen(false)}
          />
        ) : (
          <PanelRail
            side="left"
            label="Symbols"
            onExpand={() => setLeftOpen(true)}
          />
        )}
        <CodePane
          fn={selected}
          view={view}
          onViewChange={setView}
          projectId={id}
          onRenamed={reload}
          fnByName={fnByName}
          lookups={lookups}
          onSelect={selectFn}
          onJump={jumpToTarget}
          pendingHighlight={pendingHighlight}
          deobfs={deobfs}
          onDeobfChange={(originalName, deobf) => {
            setDeobfs((prev) => {
              const next = new Map(prev)
              if (deobf) next.set(originalName, deobf)
              else next.delete(originalName)
              return next
            })
          }}
        />
        {rightOpen ? (
          <SidePanel
            panel={sidePanel}
            onPanelChange={setSidePanel}
            projectId={id}
            fn={selected}
            analysis={analysis}
            fnByName={fnByName}
            onSelect={selectFn}
            onCollapse={() => setRightOpen(false)}
            onStartResize={startResizeRight}
            onRenameMutation={(newName) => void reload(newName)}
            galleryKey={galleryKey}
          />
        ) : (
          <PanelRail
            side="right"
            label="Inspector"
            onExpand={() => setRightOpen(true)}
          />
        )}
      </div>
      {shot && (
        <ScreenshotModal
          projectId={id}
          initialBlob={shot.mode === 'capture' ? shot.blob : undefined}
          cropFirst={shot.mode === 'capture'}
          onClose={() => setShot(null)}
          onInsert={onScreenshotSaved}
        />
      )}
      {captureErr && (
        <div className="pointer-events-none fixed bottom-4 right-4 rounded border border-red-900/60 bg-red-950/80 px-3 py-2 text-xs text-red-300 shadow">
          Capture failed: {captureErr}
        </div>
      )}
    </div>
  )
}

/**
 * Thin rail rendered in place of a collapsed panel. A single chevron button
 * pointing into the work area expands the panel back; a vertical label
 * tells the user what tab they're staring at.
 *
 * The chevron faces the right way per-side: a collapsed *left* rail's
 * chevron points right (toward the code) so clicking it visually "pushes
 * open" rightward; the right rail's chevron points left.
 */
function PanelRail({
  side,
  label,
  onExpand,
}: {
  side: 'left' | 'right'
  label: string
  onExpand: () => void
}) {
  const borderClass =
    side === 'left' ? 'border-r border-zinc-800' : 'border-l border-zinc-800'
  return (
    <aside className={`flex flex-col items-center py-2 ${borderClass}`}>
      <button
        onClick={onExpand}
        title={`Expand ${label.toLowerCase()} panel`}
        className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      >
        <span aria-hidden>{side === 'left' ? '›' : '‹'}</span>
      </button>
      <div
        className="mt-3 select-none text-[10px] uppercase tracking-widest text-zinc-600"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        {label}
      </div>
    </aside>
  )
}

function Header({
  project,
  functionCount,
  onPickScreenshot,
  onStartCapture,
  onShare,
}: {
  project: ProjectSummary
  functionCount: number
  onPickScreenshot: () => void
  onStartCapture: () => void
  onShare: () => void
}) {
  const callerIsOwner = isOwner(project.role)
  return (
    <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2.5 text-sm">
      <Link to="/" className="text-zinc-500 hover:text-zinc-300">
        ← Projects
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate font-medium text-zinc-100">{project.name}</div>
          {project.role === 'VIEWER' && (
            <span
              className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-400"
              title="View-only access on this project"
            >
              viewer
            </span>
          )}
          {project.role === 'EDITOR' && (
            <span
              className="shrink-0 rounded border border-emerald-700/60 bg-emerald-900/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-emerald-300"
              title="Shared with you — editor access"
            >
              editor
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-zinc-500">
          {project.executableFormat ?? '—'} · {project.arch ?? 'arch unknown'} ·{' '}
          {project.languageId ?? '—'} · {functionCount} functions
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={onPickScreenshot}
          title="Paste / drop / browse an image — saves to Gallery"
          className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800"
        >
          📷
        </button>
        <button
          onClick={onStartCapture}
          title="Capture a region of the screen — saves to Gallery"
          className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800"
        >
          📸
        </button>
        {callerIsOwner && (
          <button
            type="button"
            onClick={onShare}
            title="Invite collaborators to this project"
            className="rounded border border-purple-700/60 bg-purple-950/30 px-3 py-1 text-[11px] font-medium text-purple-200 hover:bg-purple-900/40"
          >
            Share
          </button>
        )}
        <Link
          to={`/projects/${project.id}/report`}
          target="_blank"
          rel="noopener noreferrer"
          title="Open report in a new tab"
          className="rounded border border-zinc-700 px-3 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800"
        >
          Report ↗
        </Link>
      </div>
    </header>
  )
}

// Tabs hosted in the left sidebar. Each row's count is shown next to the
// label so the user knows whether the tab has anything before clicking
// (no count when zero — visually quiet for binaries that don't ship the
// underlying field). Order is "Functions first" because that's the
// most-used view, then Entry/Exports/TLS/Data/Sections grouped together
// because they share the "symbol-as-label-on-an-address" semantic.
function LeftTabStrip({
  tab,
  onTabChange,
  totals,
}: {
  tab: LeftTab
  onTabChange: (t: LeftTab) => void
  totals: Record<LeftTab, number>
}) {
  const tabs: ReadonlyArray<{ id: LeftTab; label: string }> = [
    { id: 'functions', label: 'Funcs' },
    { id: 'entry',     label: 'Entry' },
    { id: 'exports',   label: 'Exports' },
    { id: 'tls',       label: 'TLS' },
    { id: 'data',      label: 'Data' },
    { id: 'sections',  label: 'Secs' },
  ]
  return (
    <div className="flex border-b border-zinc-800 text-[10px]">
      {tabs.map((t) => {
        const active = tab === t.id
        const n = totals[t.id] ?? 0
        return (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className={`flex-1 border-r border-zinc-800 px-1 py-1 last:border-r-0 ${
              active ? 'bg-zinc-900 text-purple-300' : 'text-zinc-500 hover:text-zinc-300'
            }`}
            title={`${t.label} (${n})`}
          >
            <span>{t.label}</span>
            {n > 0 && <span className="ml-0.5 text-zinc-600">·{n}</span>}
          </button>
        )
      })}
    </div>
  )
}

// Composes the Call Graph button + tab strip + active tab body. Renders
// the existing FunctionList for the default 'functions' tab, and the
// Entry/Exports/TLS/Data/Sections panels for the others. The bordered
// shell + collapse handle live here so each tab body can stay focused on
// just its own content.
function LeftSidebar({
  projectId,
  tab,
  onTabChange,
  functions,
  filter,
  onFilterChange,
  selectedName,
  onSelect,
  total,
  analysis,
  lookups,
  onJump,
  selectedDataName,
  onSelectData,
  onCollapse,
}: {
  projectId: string
  tab: LeftTab
  onTabChange: (t: LeftTab) => void
  functions: BinaryFunction[]
  filter: string
  onFilterChange: (v: string) => void
  selectedName: string | null
  onSelect: (name: string) => void
  total: number
  analysis: BinaryAnalysis
  lookups: SymbolLookups
  onJump: (target: JumpTarget) => boolean
  selectedDataName: string | null
  onSelectData: (name: string | null) => void
  onCollapse: () => void
}) {
  const graphHref = selectedName
    ? `/projects/${projectId}/graph?root=${encodeURIComponent(selectedName)}`
    : `/projects/${projectId}/graph`
  const totals: Record<LeftTab, number> = {
    functions: total,
    entry: analysis.entry_points?.length ?? 0,
    exports: analysis.exports?.length ?? 0,
    tls: analysis.tls_callbacks?.length ?? 0,
    data: analysis.data_symbols?.length ?? 0,
    sections: analysis.memory_blocks?.length ?? 0,
  }
  return (
    <aside className="flex min-h-0 flex-col border-r border-zinc-800">
      <div className="relative flex items-center gap-1 border-b border-zinc-800 p-2">
        <Link
          to={graphHref}
          target="_blank"
          rel="noopener noreferrer"
          className="group/graph relative flex min-w-0 flex-1 items-center justify-center gap-2 rounded border border-zinc-700 bg-zinc-900/60 px-2 py-1.5 text-[11px] font-medium text-zinc-200 hover:border-purple-700 hover:bg-purple-950/40 hover:text-purple-200"
        >
          <Network className="h-3.5 w-3.5" strokeWidth={2} />
          <span>Call Graph</span>
          <span className="text-zinc-500 group-hover/graph:text-purple-400">↗</span>
          <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 w-64 -translate-x-1/2 rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-[10px] leading-snug text-zinc-300 opacity-0 shadow-lg transition-opacity group-hover/graph:opacity-100">
            Opens an interactive tree of every function reachable from the entry point — see the full branching structure and control flow at a glance.
          </span>
        </Link>
        <button
          onClick={onCollapse}
          title="Collapse left panel"
          className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <span aria-hidden>‹</span>
        </button>
      </div>
      <LeftTabStrip tab={tab} onTabChange={onTabChange} totals={totals} />
      {tab === 'functions' && (
        <FunctionList
          functions={functions}
          filter={filter}
          onFilterChange={onFilterChange}
          selectedName={selectedName}
          onSelect={onSelect}
          total={total}
        />
      )}
      {tab === 'entry' && (
        <AddressedListPanel
          kind="entry"
          items={analysis.entry_points}
          lookups={lookups}
          emptyHint="No entry points were extracted. Older projects (pre-v2 worker JSON) don't carry this field — re-decompile with the latest CLI to populate it."
          onJump={onJump}
        />
      )}
      {tab === 'exports' && (
        <AddressedListPanel
          kind="exports"
          items={analysis.exports}
          lookups={lookups}
          emptyHint="No exports detected. For an executable this is normal; for a DLL or .so it usually means the export table wasn't parseable."
          onJump={onJump}
        />
      )}
      {tab === 'tls' && (
        <AddressedListPanel
          kind="tls"
          items={analysis.tls_callbacks}
          lookups={lookups}
          emptyHint="No TLS callbacks. Common for ELF binaries; on PE this means the loader doesn't run any code before the entry point."
          onJump={onJump}
        />
      )}
      {tab === 'data' && (
        <DataSymbolsPanel
          items={analysis.data_symbols}
          selectedName={selectedDataName}
          onSelectData={onSelectData}
        />
      )}
      {tab === 'sections' && (
        <SectionsPanel blocks={analysis.memory_blocks} />
      )}
    </aside>
  )
}

function FunctionList({
  functions,
  filter,
  onFilterChange,
  selectedName,
  onSelect,
  total,
}: {
  functions: BinaryFunction[]
  filter: string
  onFilterChange: (v: string) => void
  selectedName: string | null
  onSelect: (name: string) => void
  total: number
}) {
  return (
    <>
      <div className="border-b border-zinc-800 p-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder={`Filter ${total} functions…`}
          className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-purple-600 focus:outline-none"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {functions.length === 0 ? (
          <div className="px-3 py-4 text-xs text-zinc-500">No matches.</div>
        ) : (
          <ul className="text-xs">
            {functions.map((f) => (
              <li key={f.address}>
                <button
                  onClick={() => onSelect(f.name)}
                  className={`flex w-full items-center justify-between gap-2 border-b border-zinc-900 px-3 py-1.5 text-left font-mono hover:bg-zinc-900 ${
                    f.name === selectedName ? 'bg-purple-950/60 text-purple-200' : 'text-zinc-300'
                  }`}
                >
                  <span className="truncate">{f.name}</span>
                  <FunctionTag fn={f} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p
        className="border-t border-zinc-900 px-2 py-1 text-[10px] text-zinc-600"
        title="Function names in the pseudocode and disassembly are underlined — click any of them to jump to that function's definition."
      >
        Click underlined names in code to jump
      </p>
    </>
  )
}

function FunctionTag({ fn }: { fn: BinaryFunction }) {
  if (fn.external) return <span className="text-[10px] text-amber-400">ext</span>
  if (fn.thunk) return <span className="text-[10px] text-zinc-500">thunk</span>
  // body_skipped: function exists but extract.py hit its decompile budget
  // before reaching it. The list entry is still useful for navigation;
  // the orange tag tells the user clicking it will land on an empty body.
  if (fn.body_skipped) return <span className="text-[10px] text-orange-500" title="Body capped — metadata only">stub</span>
  return <span className="text-[10px] text-zinc-600">{fn.address.slice(-6)}</span>
}

function CodePane({
  fn,
  view,
  onViewChange,
  projectId,
  onRenamed,
  fnByName,
  lookups,
  onSelect,
  onJump,
  pendingHighlight,
  deobfs,
  onDeobfChange,
}: {
  fn: BinaryFunction | null
  view: ViewMode
  onViewChange: (v: ViewMode) => void
  projectId: string
  onRenamed: (newName: string) => Promise<void>
  fnByName: Map<string, BinaryFunction>
  // Address + data-symbol indexes used by render-time link wrapping so
  // hex literals + DAT_/FUN_-prefixed tokens become clickable when they
  // resolve. Passed as a bundle to keep the prop list manageable.
  lookups: SymbolLookups
  onSelect: (name: string) => void
  // Click-through dispatcher. CodePane's handleClick reads data-jump-*
  // attributes off the click target and invokes this. Returns boolean so
  // the caller can ignore misses (we still wrap on the way IN, but only
  // for resolved targets, so a miss here is exceptional).
  onJump: (target: JumpTarget) => boolean
  pendingHighlight: PendingHighlight | null
  // Project-wide deobf cache keyed by original (pre-rename) function name.
  // Look-ups in this map use the displayed fn.name directly since renames
  // are applied to the analysis JSON before the frontend ever sees it —
  // but the SERVER persists deobfs against the pre-rename key, which is
  // why generate/delete pass fn.name through and let the server inverse-
  // resolve via RenameService. The map key the frontend stores under is
  // whatever the server returned in `originalName`.
  deobfs: Map<string, Deobfuscation>
  // Called by the inline generate/regenerate/delete actions with the new
  // (originalName, deobf | null) so the parent's Map stays in sync.
  onDeobfChange: (originalName: string, deobf: Deobfuscation | null) => void
}) {
  // Plain click on a wrapped token navigates. addFunctionLinks wraps
  // resolved tokens at render time with one of three attributes:
  //   data-fn          — function name, navigate via onSelect (existing path)
  //   data-jump-data   — data symbol name (DAT_xxx), opens Data side panel
  //   data-jump-addr   — raw / address-suffixed reference, dispatched to
  //                      fn-by-addr or data-by-addr by jumpToTarget
  // Bare text and unresolved tokens never get a wrapper, so they remain inert.
  const handleClick = useCallback((e: React.MouseEvent) => {
    const t = (e.target as HTMLElement).closest(
      '[data-fn], [data-jump-data], [data-jump-addr]',
    ) as HTMLElement | null
    if (!t) return
    if (t.dataset.fn) {
      const name = t.dataset.fn
      if (!name || !fnByName.has(name) || name === fn?.name) return
      e.preventDefault()
      onSelect(name)
      return
    }
    if (t.dataset.jumpData) {
      e.preventDefault()
      onJump({ kind: 'data', value: t.dataset.jumpData })
      return
    }
    if (t.dataset.jumpAddr) {
      e.preventDefault()
      onJump({ kind: 'addr', value: t.dataset.jumpAddr })
      return
    }
  }, [fn?.name, fnByName, onSelect, onJump])

  if (!fn) {
    return (
      <main className="flex items-center justify-center text-zinc-600">
        Select a function from the list
      </main>
    )
  }

  const disasmDisabled = fn.external || fn.thunk
  return (
    <main className="flex min-h-0 flex-col">
      <div className="border-b border-zinc-800 p-3">
        <FunctionNameEditor
          fn={fn}
          projectId={projectId}
          onRenamed={onRenamed}
        />
        <div className="mt-0.5 truncate font-mono text-xs text-zinc-500">
          {fn.signature}
        </div>
        <div className="mt-0.5 text-[11px] text-zinc-600">
          @ {fn.address} · {fn.size} bytes
          {fn.external && <span className="ml-2 text-amber-400">external</span>}
          {fn.thunk && <span className="ml-2 text-zinc-500">thunk</span>}
        </div>
      </div>
      <div className="flex border-b border-zinc-800 text-xs">
        <TabButton
          active={view === 'pseudo'}
          onClick={() => onViewChange('pseudo')}
        >
          Pseudocode
        </TabButton>
        <TabButton
          active={view === 'disasm'}
          disabled={disasmDisabled}
          onClick={() => !disasmDisabled && onViewChange('disasm')}
        >
          Disassembly
        </TabButton>
        {/* Deobf is enabled when the function has a body to send. Sparkle
            marks it as AI-generated; the chip annotates whether a deobf
            already exists (instant view) vs needs to be generated. */}
        <TabButton
          active={view === 'deobf'}
          disabled={disasmDisabled || !fn.decompiled}
          onClick={() => !(disasmDisabled || !fn.decompiled) && onViewChange('deobf')}
        >
          ✨ Deobf
          {deobfs.has(fn.name) && (
            <span className="ml-1 rounded bg-emerald-900/60 px-1 text-[9px] text-emerald-200">
              cached
            </span>
          )}
        </TabButton>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto bg-zinc-900/40"
        onClick={handleClick}
      >
        {view === 'pseudo' && (
          <PseudocodeView fn={fn} lookups={lookups} pendingHighlight={pendingHighlight} />
        )}
        {view === 'disasm' && (
          <DisassemblyView fn={fn} lookups={lookups} pendingHighlight={pendingHighlight} />
        )}
        {view === 'deobf' && (
          <DeobfView
            projectId={projectId}
            fn={fn}
            deobf={deobfs.get(fn.name) ?? null}
            onDeobfChange={onDeobfChange}
          />
        )}
      </div>
    </main>
  )
}

function FunctionNameEditor({
  fn,
  projectId,
  onRenamed,
}: {
  fn: BinaryFunction
  projectId: string
  onRenamed: (newName: string) => Promise<void>
}) {
  const api = useApi()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(fn.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Reset draft + clear any prior error whenever the user selects a new
  // function, otherwise the editor would show stale state from the last edit.
  useEffect(() => {
    setDraft(fn.name)
    setEditing(false)
    setError(null)
  }, [fn.name])

  function start() {
    setDraft(fn.name)
    setEditing(true)
    setError(null)
    // Focus + select-all on next tick so the user can immediately type over.
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }

  async function save() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === fn.name) {
      setEditing(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api(`/api/projects/${projectId}/renames/manual`, {
        method: 'POST',
        body: JSON.stringify({
          original: fn.name,
          suggested: trimmed,
          scope: 'function',
        }),
      })
      // Reload first so the new view is on screen, then settle the editor.
      await onRenamed(trimmed)
      setEditing(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function cancel() {
    setDraft(fn.name)
    setEditing(false)
    setError(null)
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="truncate font-mono text-sm text-zinc-100" title={fn.name}>
          {fn.name}
        </span>
        <button
          onClick={start}
          className="rounded border border-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
          title="Rename this function — applies across pseudocode, disassembly, xrefs, and AI prompts"
        >
          Rename
        </button>
      </div>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      className="flex flex-col gap-1"
    >
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
          disabled={busy}
          className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-amber-500 px-3 py-1 text-xs font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
        >
          {busy ? '…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error && <div className="text-[11px] text-red-400">{error}</div>}
    </form>
  )
}

function TabButton({
  children,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`border-r border-zinc-800 px-4 py-1.5 ${
        active
          ? 'bg-zinc-900 text-purple-300'
          : 'text-zinc-500 hover:text-zinc-300 disabled:cursor-not-allowed disabled:text-zinc-700 disabled:hover:text-zinc-700'
      }`}
    >
      {children}
    </button>
  )
}

function PseudocodeView({
  fn,
  lookups,
  pendingHighlight,
}: {
  fn: BinaryFunction
  lookups: SymbolLookups
  pendingHighlight: PendingHighlight | null
}) {
  // Run Shiki async whenever the selected function changes. The first call
  // pays the WASM + grammar download (~250kb gzipped, cached by the browser
  // afterward); subsequent calls are sync-fast. We keep a cancel flag so a
  // rapid function switch doesn't paint a stale highlight onto the new fn.
  // The post-Shiki pass wraps function-name occurrences in clickable spans
  // — see addFunctionLinks below for the DOM-walking logic that keeps the
  // syntax-highlight color spans intact.
  const [html, setHtml] = useState<string | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (fn.external || fn.thunk || !fn.decompiled) {
      setHtml(null)
      return
    }
    let cancelled = false
    setHtml(null)
    void highlightC(fn.decompiled).then((rendered) => {
      if (cancelled) return
      setHtml(addFunctionLinks(rendered, lookups, fn.name))
    })
    return () => { cancelled = true }
  }, [fn, lookups])

  // Scroll-to-line + flash, mirroring openapk's HighlightedCode behavior.
  // Fires when html is rendered AND a pending highlight targets this exact
  // function with a pseudoLine. The nonce in pendingHighlight makes a
  // repeated click on the same hit re-trigger the flash. Shiki emits one
  // `.line` per source line so the nth-line lookup is a simple index.
  useEffect(() => {
    if (html === null) return
    if (!pendingHighlight || pendingHighlight.fnName !== fn.name) return
    const line = pendingHighlight.pseudoLine
    if (line == null || line < 1) return
    const host = hostRef.current
    if (!host) return
    const lines = host.querySelectorAll<HTMLElement>('.line')
    const el = lines[line - 1]
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('search-flash')
    const t = setTimeout(() => el.classList.remove('search-flash'), 1600)
    return () => clearTimeout(t)
  }, [html, fn.name, pendingHighlight])

  if (fn.external) {
    return (
      <EmptyState>
        External function — no body to decompile. This is a PLT slot or import
        stub; the real implementation lives outside the binary.
      </EmptyState>
    )
  }
  if (fn.thunk) {
    return (
      <EmptyState>
        Thunk — Ghidra classified this as a trampoline. Check the callers/callees
        panel to see what it forwards to.
      </EmptyState>
    )
  }
  if (fn.body_skipped) {
    return (
      <EmptyState>
        Body capped — this function is present in the analysis but its
        decompilation was skipped because the per-result budget was already
        spent on functions at lower addresses. The xrefs, signature, and
        address are still navigable. Re-decompile with a tuned worker (or
        increase <code>MAX_DECOMPILE_BODIES</code> in extract.py) to fill
        this in.
      </EmptyState>
    )
  }
  if (!fn.decompiled) {
    return <EmptyState>Decompiler produced no output for this function.</EmptyState>
  }
  // While the highlighter spins up on first paint, show the raw text so the
  // user sees the code immediately rather than an empty pane.
  if (html === null) {
    return (
      <pre className="whitespace-pre p-4 font-mono text-[13px] leading-relaxed text-zinc-200">
        {fn.decompiled}
      </pre>
    )
  }
  return (
    <div
      ref={hostRef}
      className="shiki-host p-4"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/**
 * Resolve a single token (identifier or hex literal) against the symbol
 * lookups. Returns the click attribute payload to wrap the token with, or
 * null if nothing resolves. Shared by addFunctionLinks (pseudocode pass)
 * and DisasmTokens (disassembly per-line) so the click-through rules
 * stay in one place.
 *
 * Resolution order:
 *   1. fnByName        — direct hit on a known function (existing behavior)
 *   2. dataByName      — DAT_xxx or user-named global data
 *   3. FUN_/SUB_-prefix → fnByAddr by the trailing hex
 *   4. DAT_-prefix     → dataByAddr by the trailing hex (handles the case
 *                        where the symbol was renamed but the auto-name
 *                        still shows up in stale decompiled output)
 *   5. bare 0x... hex  → fnByAddr then dataByAddr
 * Self-name is filtered so clicking `int main(...)` doesn't try to navigate
 * to main again.
 */
type LinkPayload = { className: string; attr: string; value: string }

function resolveJump(token: string, lookups: SymbolLookups, selfName: string): LinkPayload | null {
  if (token === selfName) return null
  if (lookups.fnByName.has(token)) {
    return { className: 'fn-link', attr: 'data-fn', value: token }
  }
  if (lookups.dataByName.has(token)) {
    return { className: 'data-link', attr: 'data-jump-data', value: token }
  }
  const ghidra = /^(?:FUN|SUB|DAT|LAB)_([0-9a-fA-F]{5,})$/i.exec(token)
  if (ghidra) {
    const k = canonAddr(ghidra[1])
    if (k && (lookups.fnByAddr.has(k) || lookups.dataByAddr.has(k))) {
      return { className: 'addr-link', attr: 'data-jump-addr', value: token }
    }
  }
  if (/^0x[0-9a-fA-F]{5,}$/i.test(token)) {
    const k = canonAddr(token)
    if (k && (lookups.fnByAddr.has(k) || lookups.dataByAddr.has(k))) {
      return { className: 'addr-link', attr: 'data-jump-addr', value: token }
    }
  }
  return null
}

// Combined token regex: identifiers (existing FN_IDENT shape) OR hex
// literals with a `0x` prefix (5+ digits to avoid wrapping small magic
// numbers). Ordering matters: identifiers first so a token like `0x` —
// not that this ever appears alone — wouldn't get mis-classified.
const PSEUDO_TOKEN = /([A-Za-z_$@?][A-Za-z0-9_$@.?]*)|(0x[0-9a-fA-F]{5,})/g

/**
 * Walk the text nodes of a parsed-Shiki HTML fragment and wrap every
 * resolvable click target — function names, data symbols (DAT_xxx),
 * Ghidra-prefixed address tokens (FUN_xxx), and bare hex literals
 * (0x140001180) — in a click-target span. Color spans and structural
 * elements emitted by Shiki are left untouched: only text nodes are
 * split, so syntax highlighting survives the pass.
 */
function addFunctionLinks(
  html: string,
  lookups: SymbolLookups,
  selfName: string,
): string {
  if (lookups.fnByName.size === 0 && lookups.dataByName.size === 0 &&
      lookups.fnByAddr.size === 0 && lookups.dataByAddr.size === 0) {
    return html
  }
  // Wrap in a sentinel so we can read innerHTML back out without the
  // <html>/<body> boilerplate DOMParser adds.
  const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html')
  const root = doc.getElementById('r')
  if (!root) return html
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  let cur: Node | null
  while ((cur = walker.nextNode())) texts.push(cur as Text)
  for (const node of texts) {
    const text = node.data
    PSEUDO_TOKEN.lastIndex = 0
    const frag = doc.createDocumentFragment()
    let lastIndex = 0
    let mutated = false
    let m: RegExpExecArray | null
    while ((m = PSEUDO_TOKEN.exec(text)) !== null) {
      const word = m[0]
      const payload = resolveJump(word, lookups, selfName)
      if (!payload) continue
      mutated = true
      if (m.index > lastIndex) {
        frag.appendChild(doc.createTextNode(text.slice(lastIndex, m.index)))
      }
      const span = doc.createElement('span')
      span.className = payload.className
      span.setAttribute(payload.attr, payload.value)
      span.textContent = word
      frag.appendChild(span)
      lastIndex = m.index + word.length
    }
    if (mutated) {
      if (lastIndex < text.length) {
        frag.appendChild(doc.createTextNode(text.slice(lastIndex)))
      }
      node.replaceWith(frag)
    }
  }
  return root.innerHTML
}

// Register-name set used by the disassembly syntax highlighter. Covers the
// architectures Ghidra most commonly targets — x86 / x86-64, ARM / AArch64,
// MIPS, plus the SIMD register banks. Lookups are case-insensitive (we
// lowercase the token first) because Ghidra emits uppercase for some
// processor modules (x86) and lowercase for others (ARM). False negatives
// are harmless — an unrecognized register just renders as a plain
// identifier; we never miscolor a function name as a register because
// fn-link wins first.
const ASM_REGISTERS: ReadonlySet<string> = new Set([
  // x86 / x86-64 general purpose, 64/32/16/8 bit
  'rax', 'rbx', 'rcx', 'rdx', 'rsi', 'rdi', 'rbp', 'rsp', 'rip',
  'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15',
  'eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'ebp', 'esp', 'eip',
  'r8d', 'r9d', 'r10d', 'r11d', 'r12d', 'r13d', 'r14d', 'r15d',
  'ax', 'bx', 'cx', 'dx', 'si', 'di', 'bp', 'sp',
  'r8w', 'r9w', 'r10w', 'r11w', 'r12w', 'r13w', 'r14w', 'r15w',
  'ah', 'al', 'bh', 'bl', 'ch', 'cl', 'dh', 'dl',
  'sil', 'dil', 'bpl', 'spl',
  'r8b', 'r9b', 'r10b', 'r11b', 'r12b', 'r13b', 'r14b', 'r15b',
  // x86 segment / flags / control / debug
  'cs', 'ds', 'es', 'fs', 'gs', 'ss',
  'eflags', 'rflags', 'flags',
  'cr0', 'cr1', 'cr2', 'cr3', 'cr4', 'cr8',
  'dr0', 'dr1', 'dr2', 'dr3', 'dr6', 'dr7',
  // x87 / MMX / SIMD banks (xmm/ymm/zmm 0-31)
  'mm0', 'mm1', 'mm2', 'mm3', 'mm4', 'mm5', 'mm6', 'mm7',
  ...Array.from({ length: 32 }, (_, i) => `xmm${i}`),
  ...Array.from({ length: 32 }, (_, i) => `ymm${i}`),
  ...Array.from({ length: 32 }, (_, i) => `zmm${i}`),
  // AArch64 (x0-x30, w0-w30, s/d/q SIMD 0-31)
  ...Array.from({ length: 31 }, (_, i) => `x${i}`),
  ...Array.from({ length: 31 }, (_, i) => `w${i}`),
  ...Array.from({ length: 32 }, (_, i) => `s${i}`),
  ...Array.from({ length: 32 }, (_, i) => `d${i}`),
  ...Array.from({ length: 32 }, (_, i) => `q${i}`),
  ...Array.from({ length: 32 }, (_, i) => `v${i}`),
  'sp', 'lr', 'pc', 'fp', 'ip', 'xzr', 'wzr', 'wsp', 'cpsr', 'spsr',
  // ARM/Thumb 32-bit (r0-r15)
  ...Array.from({ length: 16 }, (_, i) => `r${i}`),
  // MIPS (zero, at, v/a/t/s/k regs, gp/sp/fp/ra) — common names
  'zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3',
  't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9',
  's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8',
  'k0', 'k1', 'gp', 'ra',
])

// Operand size / type keywords that show up in Ghidra's listing output —
// `dword ptr [eax]`, `qword ptr [...]`, etc. Colored distinctly from
// registers so the eye can split the operand structure quickly.
const ASM_SIZE_KEYWORDS: ReadonlySet<string> = new Set([
  'byte', 'word', 'dword', 'qword', 'tword', 'tbyte', 'oword', 'xword', 'yword', 'zword',
  'ptr', 'short', 'near', 'far',
])

// Single-pass tokenizer for one disassembly line. Emits typed tokens in
// order; the renderer below maps each kind to a tailwind color class.
// Comment start (`;`) ends the line — everything past it is one comment
// token. We do NOT try to honor `;` inside string literals because Ghidra
// disassembly listings don't contain string literals at this layer.
type AsmToken =
  | { kind: 'comment'; text: string }
  | { kind: 'number'; text: string }
  | { kind: 'ident'; text: string }
  | { kind: 'punct'; text: string }
  | { kind: 'ws'; text: string }

function tokenizeAsmLine(line: string): AsmToken[] {
  const out: AsmToken[] = []
  // Split off trailing comment first so the main tokenizer doesn't need to
  // think about it. Ghidra appends auto-comments with ` = ...` for resolved
  // references on some processors — those use `=` not `;`, so they fall
  // through as normal tokens (intentional).
  const semi = line.indexOf(';')
  const body = semi >= 0 ? line.slice(0, semi) : line
  const comment = semi >= 0 ? line.slice(semi) : ''

  // Token regex — ordering matters: number must come before ident so that
  // `0x123` isn't sliced into `0` + `x123` (which would mis-color `x123`
  // as the AArch64 register x123).
  const re =
    /(\s+)|(#?-?0x[0-9a-fA-F]+|#-?\d+|-?\b\d+\b)|([A-Za-z_$@?][A-Za-z0-9_$@.?]*)|([,+\-*:!=<>(){}\[\]])/g
  let m: RegExpExecArray | null
  let lastIndex = 0
  while ((m = re.exec(body)) !== null) {
    // Any unrecognized run between matches falls through as punctuation —
    // keeps us robust against odd characters in operand markup.
    if (m.index > lastIndex) out.push({ kind: 'punct', text: body.slice(lastIndex, m.index) })
    if (m[1] !== undefined) out.push({ kind: 'ws', text: m[1] })
    else if (m[2] !== undefined) out.push({ kind: 'number', text: m[2] })
    else if (m[3] !== undefined) out.push({ kind: 'ident', text: m[3] })
    else if (m[4] !== undefined) out.push({ kind: 'punct', text: m[4] })
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < body.length) out.push({ kind: 'punct', text: body.slice(lastIndex) })
  if (comment) out.push({ kind: 'comment', text: comment })
  return out
}

/**
 * JSX-time tokenizer + colorizer for a single disassembly instruction.
 * Produces colored spans for mnemonic, registers, immediates, size
 * keywords, comments, and punctuation. Function names that exist in
 * `fnByName` (other than the one currently being viewed) become `.fn-link`
 * spans so a click bubbles up to the CodePane handler and navigates —
 * preserving the click-to-jump behavior the rest of the inspector relies on.
 */
function DisasmTokens({
  text,
  lookups,
  selfName,
}: {
  text: string
  lookups: SymbolLookups
  selfName: string
}) {
  const tokens = tokenizeAsmLine(text)
  const parts: React.ReactNode[] = []
  let mnemonicSeen = false
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const key = i
    switch (t.kind) {
      case 'ws':
        parts.push(t.text)
        break
      case 'comment':
        parts.push(
          <span key={key} className="italic text-zinc-500">{t.text}</span>,
        )
        break
      case 'number': {
        // Numbers in disassembly are usually immediates. A `0x…` operand may
        // be an address pointing into code or data — try to resolve it and
        // promote to a clickable addr-link if we hit either index.
        const payload = resolveJump(t.text, lookups, selfName)
        if (payload && payload.attr === 'data-jump-addr') {
          parts.push(
            <span key={key} className="addr-link text-orange-300" data-jump-addr={payload.value}>
              {t.text}
            </span>,
          )
        } else {
          parts.push(
            <span key={key} className="text-orange-300">{t.text}</span>,
          )
        }
        break
      }
      case 'punct':
        parts.push(
          <span key={key} className="text-zinc-500">{t.text}</span>,
        )
        break
      case 'ident': {
        const lc = t.text.toLowerCase()
        // Function/data/addr link wins first — even if a function happens
        // to share a name with a register (rare but possible for short
        // imports like `sp` or `lr` in pathological binaries), navigation
        // is more valuable than the color hint.
        const payload = resolveJump(t.text, lookups, selfName)
        if (payload) {
          parts.push(
            <span
              key={key}
              className={payload.className}
              {...{ [payload.attr]: payload.value }}
            >
              {t.text}
            </span>,
          )
        } else if (!mnemonicSeen) {
          // First identifier on the line is the mnemonic. Bright color so
          // the eye can scan a column of instructions quickly.
          parts.push(
            <span key={key} className="font-semibold text-sky-300">{t.text}</span>,
          )
          mnemonicSeen = true
        } else if (ASM_REGISTERS.has(lc)) {
          parts.push(
            <span key={key} className="text-amber-300">{t.text}</span>,
          )
        } else if (ASM_SIZE_KEYWORDS.has(lc)) {
          parts.push(
            <span key={key} className="text-violet-300">{t.text}</span>,
          )
        } else {
          parts.push(
            <span key={key} className="text-zinc-200">{t.text}</span>,
          )
        }
        break
      }
    }
  }
  return <>{parts}</>
}

function DisassemblyView({
  fn,
  lookups,
  pendingHighlight,
}: {
  fn: BinaryFunction
  lookups: SymbolLookups
  pendingHighlight: PendingHighlight | null
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  // Scroll-to-addr + flash when a side-panel hit targets this function with
  // an asmAddr. `data-addr` on each row gives us a direct querySelector
  // anchor; the CSS rule in index.css colors any `[data-addr].search-flash`
  // so the disassembly + pseudocode share the same fade-out transition.
  useEffect(() => {
    if (!pendingHighlight || pendingHighlight.fnName !== fn.name) return
    const addr = pendingHighlight.asmAddr
    if (!addr) return
    const host = hostRef.current
    if (!host) return
    const el = host.querySelector<HTMLElement>(`[data-addr="${CSS.escape(addr)}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('search-flash')
    const t = setTimeout(() => el.classList.remove('search-flash'), 1600)
    return () => clearTimeout(t)
  }, [fn.name, pendingHighlight])

  if (!fn.disassembly || fn.disassembly.length === 0) {
    if (fn.body_skipped) {
      return (
        <EmptyState>
          Body capped — disassembly was skipped because the per-result
          MAX_DECOMPILE_BODIES budget was spent before reaching this
          function. Re-decompile with a higher budget to populate it.
        </EmptyState>
      )
    }
    return <EmptyState>No disassembly available for this function.</EmptyState>
  }
  return (
    <div ref={hostRef} className="font-mono text-[12px] leading-relaxed">
      {fn.disassembly.map((line, i) => (
        <div
          key={i}
          data-addr={line.addr}
          className="flex gap-4 px-4 py-0.5 hover:bg-zinc-900/40"
        >
          <span className="w-20 shrink-0 text-zinc-600">{line.addr}</span>
          <span className="text-zinc-200">
            <DisasmTokens text={line.text} lookups={lookups} selfName={fn.name} />
          </span>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-6 text-xs text-zinc-500">{children}</div>
  )
}

// Token-estimate thresholds. Decompiled C runs ~3 chars/token (denser than
// English), so we approximate with chars/3 for the upper bound. The token
// estimate displayed below is intentionally conservative — better to scare
// a user away from a borderline call than surprise them with a 50¢ bill.
const TOKENS_PER_CHAR = 1 / 3
// Above this, show a yellow caution chip. Below it, generate silently.
const DEOBF_WARN_THRESHOLD = 8_000
// Above this, require an explicit confirm() before sending. Catches the
// "a 4000-line obfuscated function" case where users probably didn't
// realize how much code was hiding in there.
const DEOBF_CONFIRM_THRESHOLD = 25_000

/**
 * Pre-flight heuristic — count obfuscation-shaped signals in a decompiled
 * function body so the user can avoid spending tokens on already-clean
 * code. Each signal is a textual pattern that the Ghidra decompiler emits
 * when the binary was control-flow-flattened or dispatcher-obfuscated.
 *
 * Score >= 3 means "looks obfuscated, deobf will probably help". Score
 * <= 1 means "looks clean, deobf may not change much". This is heuristic
 * only — the user can still generate either way; we just label the
 * Generate button accordingly so the verdict isn't a surprise.
 */
function detectObfuscationSignals(decompiled: string): { score: number; signals: string[] } {
  const signals: string[] = []
  let score = 0

  // Big magic constants (>=7 hex digits) — dispatcher state values dwarf
  // typical real-program constants (page sizes, flags, errno values).
  const bigConsts = decompiled.match(/\b-?0x[0-9a-fA-F]{7,}\b/g) ?? []
  if (bigConsts.length >= 5) {
    signals.push(`${bigConsts.length} dispatcher-sized constants`)
    score += 2
  }

  // `if (var == 0xMAGIC)` cascades — the spine of a flattened control
  // flow. Three or more in one function is a strong tell.
  const magicCmps = decompiled.match(/(?:if|else\s+if)\s*\([^)]+==\s*-?0x[0-9a-fA-F]{6,}/g) ?? []
  if (magicCmps.length >= 3) {
    signals.push(`${magicCmps.length} magic-constant comparisons`)
    score += 2
  }

  // do { … } while ( true ) — outer dispatcher loop wrapper. Ghidra emits
  // this when a single block had no natural loop bound and was reached
  // via state-machine jumps.
  if (/do\s*\{[\s\S]*\}\s*while\s*\(\s*true\s*\)/.test(decompiled)) {
    signals.push('do-while(true) dispatcher loop')
    score += 1
  }

  // LAB_xxxxx: labels mid-function. Ghidra emits these for jumps it
  // couldn't structure into if/while — common in CFF output.
  const labels = decompiled.match(/LAB_[0-9a-fA-F]+:/g) ?? []
  if (labels.length >= 2) {
    signals.push(`${labels.length} goto labels`)
    score += 1
  }

  return { score, signals }
}

/**
 * Pull a `// AI-deobf: <verdict>` line off the front of a deobf body and
 * return both the verdict and the body without it. The current
 * SYSTEM_PROMPT requires this exact form as the first line; older rows
 * (generated before that prompt change) won't have one — verdict comes
 * back null and we render the body as-is.
 */
function splitDeobfVerdict(body: string): { verdict: string | null; code: string } {
  const m = /^\s*\/\/\s*AI-deobf:\s*(.+?)\s*$/m.exec(body)
  if (!m || m.index > 32) return { verdict: null, code: body }
  // Strip the matched line plus the following newline if present.
  const before = body.slice(0, m.index)
  const after = body.slice(m.index + m[0].length).replace(/^\n/, '')
  return { verdict: m[1].trim(), code: (before + after).trimStart() }
}

/**
 * Third view mode in CodePane. When no deobf exists for this function we
 * render an in-tab generate flow: token estimate, credential picker, big
 * Generate button (with confirm for huge functions). Once a deobf is
 * cached, we render the cleaned C through the same Shiki C highlighter
 * pseudocode uses, plus a metadata strip + regenerate/delete controls.
 *
 * Deobf is per-function and lives in a separate table — it does NOT
 * replace the original decompiled string in the analysis JSON, so chain /
 * xref / network / click-to-jump all stay accurate against the original
 * (which is what they were indexed against).
 */
function DeobfView({
  projectId,
  fn,
  deobf,
  onDeobfChange,
}: {
  projectId: string
  fn: BinaryFunction
  deobf: Deobfuscation | null
  onDeobfChange: (originalName: string, deobf: Deobfuscation | null) => void
}) {
  const api = useApi()
  const [credentials, setCredentials] = useState<Credential[] | null>(null)
  const [credentialId, setCredentialId] = useState<string>('')
  const [busy, setBusy] = useState<'generate' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const creds = await api<Credential[]>('/api/credentials')
        if (cancelled) return
        setCredentials(creds)
        if (creds.length > 0) setCredentialId((prev) => prev || creds[0].id)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [api])

  // Strip the `// AI-deobf:` verdict line off the front of the body before
  // syntax-highlighting + display. Verdict is shown separately in the
  // metadata strip; the rest of the body goes through Shiki.
  const { verdict, code: deobfCode } = useMemo(
    () => (deobf ? splitDeobfVerdict(deobf.deobfuscated) : { verdict: null, code: '' }),
    [deobf?.deobfuscated],
  )

  // Run Shiki on the cached deobf body whenever the deobf or function
  // changes. Mirrors PseudocodeView's pattern — same highlighter, same
  // cancel-flag guard against rapid switches painting stale highlights.
  useEffect(() => {
    if (!deobf) {
      setHtml(null)
      return
    }
    let cancelled = false
    setHtml(null)
    void highlightC(deobfCode).then((rendered) => {
      if (!cancelled) setHtml(rendered)
    })
    return () => { cancelled = true }
  }, [deobfCode, fn.name, deobf])

  // Pre-flight: scan the ORIGINAL decompiled body for obfuscation signals
  // so we can surface them in the generate panel below. Recomputed only
  // when the function changes; cheap regex scan.
  const obfSignals = useMemo(
    () => (fn.decompiled ? detectObfuscationSignals(fn.decompiled) : { score: 0, signals: [] }),
    [fn.decompiled],
  )

  const estTokens = Math.ceil((fn.decompiled?.length ?? 0) * TOKENS_PER_CHAR)
  const overWarn = estTokens > DEOBF_WARN_THRESHOLD
  const overConfirm = estTokens > DEOBF_CONFIRM_THRESHOLD

  async function generate() {
    if (!credentialId) {
      setError('Pick an LLM credential first.')
      return
    }
    if (overConfirm) {
      const ok = window.confirm(
        `This function decompiles to ~${estTokens.toLocaleString()} input tokens, ` +
        `which is unusually large. Generate anyway?`,
      )
      if (!ok) return
    }
    setBusy('generate')
    setError(null)
    try {
      const resp = await api<Deobfuscation>(`/api/projects/${projectId}/deobfuscations`, {
        method: 'POST',
        body: JSON.stringify({ functionName: fn.name, credentialId }),
      })
      onDeobfChange(resp.originalName, resp)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function deleteDeobf() {
    if (!deobf) return
    if (!window.confirm('Delete this cached deobfuscation? Regenerating later will cost tokens again.')) return
    setBusy('delete')
    setError(null)
    try {
      await api(
        `/api/projects/${projectId}/deobfuscations?functionName=${encodeURIComponent(fn.name)}`,
        { method: 'DELETE' },
      )
      onDeobfChange(deobf.originalName, null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  // --------- Generate flow (no deobf yet) ----------
  if (!deobf) {
    if (credentials === null) {
      return <EmptyState>Loading credentials…</EmptyState>
    }
    if (credentials.length === 0) {
      return (
        <div className="space-y-2 p-4 text-xs text-zinc-500">
          <p>No LLM credentials configured yet.</p>
          <Link
            to="/settings/api-keys"
            className="inline-block rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500"
          >
            Add a credential
          </Link>
        </div>
      )
    }
    return (
      <div className="space-y-3 p-4 text-xs">
        <div>
          <h3 className="text-sm font-medium text-zinc-200">AI deobfuscation</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
            Sends this function's decompiled C to the LLM and asks for a
            cleaned, readable rewrite — unwinding control-flow flattening,
            dispatcher state machines, opaque predicates. The original
            decompiled view above stays untouched; deobf is a separate
            display layer so call-chain, xrefs, network, and click-to-jump
            keep working against the unobfuscated indexer state.
          </p>
        </div>

        <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="flex items-baseline justify-between">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              Estimate
            </div>
            <div className="font-mono text-zinc-200">
              ~{estTokens.toLocaleString()} input tokens
            </div>
          </div>
          {overConfirm && (
            <div className="mt-2 rounded border border-amber-800 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-300">
              This function is unusually large. You'll be asked to confirm
              before the request is sent.
            </div>
          )}
          {overWarn && !overConfirm && (
            <div className="mt-2 text-[10px] text-amber-400/80">
              Note: this is above the typical function size — generation
              may cost more than usual.
            </div>
          )}

          {/* Pre-flight verdict from the heuristic scan. Score ≥ 3 means
              dispatcher patterns are present; ≤ 1 means likely clean and
              the user will probably get back an unchanged body. */}
          <div className="mt-3 border-t border-zinc-800 pt-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
              Pre-flight scan
            </div>
            {obfSignals.score >= 3 ? (
              <>
                <div className="text-[11px] text-amber-300">
                  ✦ Looks obfuscated — deobf should help.
                </div>
                <ul className="mt-1 space-y-0.5 text-[10px] text-zinc-400">
                  {obfSignals.signals.map((s) => (
                    <li key={s}>· {s}</li>
                  ))}
                </ul>
              </>
            ) : obfSignals.score >= 1 ? (
              <>
                <div className="text-[11px] text-zinc-300">
                  Mild obfuscation signals — deobf may help marginally.
                </div>
                <ul className="mt-1 space-y-0.5 text-[10px] text-zinc-500">
                  {obfSignals.signals.map((s) => (
                    <li key={s}>· {s}</li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="text-[11px] text-emerald-300">
                ✓ Looks clean — no dispatcher / opaque-predicate signals
                detected. Deobf will probably return the same code.
              </div>
            )}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
            Credential
          </span>
          <select
            value={credentialId}
            onChange={(e) => setCredentialId(e.target.value)}
            className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-200"
          >
            {credentials.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.provider})
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={() => void generate()}
          disabled={busy !== null || !credentialId}
          className="w-full rounded bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'generate' ? 'Generating…' : '✨ Generate deobfuscation'}
        </button>

        {error && (
          <div className="rounded border border-red-800 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
            {error}
          </div>
        )}
      </div>
    )
  }

  // --------- Cached deobf — render + controls ----------
  // The verdict tells the user what the model thought it was doing. If
  // the line is missing (legacy row generated before the prompt change),
  // fall back to "cleaned" so the chip still reads sensibly.
  const noChange = verdict?.toLowerCase().includes('no obfuscation detected')
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-[10px] text-zinc-500">
        <span
          className={
            noChange
              ? 'rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300'
              : 'rounded bg-emerald-900/60 px-1.5 py-0.5 text-emerald-200'
          }
        >
          {noChange ? '○ unchanged' : '✨ cleaned'}
        </span>
        <span className="font-mono">{deobf.model}</span>
        <span>·</span>
        <span>
          {deobf.inputTokens.toLocaleString()} in · {deobf.outputTokens.toLocaleString()} out
        </span>
        <span>·</span>
        <span>{new Date(deobf.createdAt).toLocaleString()}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => void generate()}
            disabled={busy !== null}
            title="Regenerate — replaces the cached version"
            className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            {busy === 'generate' ? '…' : '↻ Regenerate'}
          </button>
          <button
            onClick={() => void deleteDeobf()}
            disabled={busy !== null}
            title="Delete this cached deobfuscation"
            className="rounded border border-red-900/60 px-2 py-0.5 text-red-300 hover:bg-red-950/40 disabled:opacity-50"
          >
            {busy === 'delete' ? '…' : '✕'}
          </button>
        </div>
      </div>
      {verdict && (
        <div className="border-b border-zinc-800 bg-zinc-950/30 px-3 py-1.5 text-[11px] italic text-zinc-300">
          {verdict}
        </div>
      )}
      {error && (
        <div className="border-b border-red-900/60 bg-red-950/30 px-3 py-1 text-[11px] text-red-300">
          {error}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {html === null ? (
          <pre className="whitespace-pre p-4 font-mono text-[13px] leading-relaxed text-zinc-200">
            {deobfCode}
          </pre>
        ) : (
          <div className="shiki-host p-4" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </div>
  )
}

function SidePanel({
  panel,
  onPanelChange,
  projectId,
  fn,
  analysis,
  fnByName,
  onSelect,
  onCollapse,
  onStartResize,
  onRenameMutation,
  galleryKey,
}: {
  panel: SidePanelKind
  onPanelChange: (p: SidePanelKind) => void
  projectId: string
  fn: BinaryFunction | null
  analysis: BinaryAnalysis
  fnByName: Map<string, BinaryFunction>
  // Optional JumpHint lets Xrefs / Chain / Network rows scroll to + flash
  // a specific call site inside the navigated function.
  onSelect: (name: string, hint?: JumpHint) => void
  onCollapse: () => void
  onStartResize: (e: React.MouseEvent) => void
  onRenameMutation: (newName?: string) => void
  // Bumped by parent each time a screenshot is saved so the Gallery
  // refetches; passing the literal number is enough — Gallery resets its
  // useEffect deps on the new value.
  galleryKey: number
}) {
  // Tabs that have ever been opened. Each one stays mounted (just visually
  // hidden when inactive) so its internal state — AskPanel threads,
  // CryptoPanel result map, ChainPanel narrations, ReportEditor dirty
  // buffer, etc. — survives a tab switch. First-activation lazy mount
  // means the Report + Gallery tabs (each ~1 round trip on mount) don't
  // fire their fetches until the user first opens them, matching the
  // openapk pattern.
  const [activated, setActivated] = useState<Set<SidePanelKind>>(() => new Set([panel]))
  useEffect(() => {
    setActivated((prev) => (prev.has(panel) ? prev : new Set([...prev, panel])))
  }, [panel])
  return (
    <aside className="relative flex min-h-0 flex-col border-l border-zinc-800">
      {/* Resize handle — invisible 6px column on the leftmost edge with a
          col-resize cursor. Hovering paints a thin purple line so users
          know it's grabbable. Sits above the tab strip with z-20 so the
          tab buttons don't eat the mousedown. */}
      <div
        onMouseDown={onStartResize}
        title="Drag to resize"
        className="group absolute left-0 top-0 z-20 h-full w-1.5 -translate-x-1/2 cursor-col-resize"
      >
        <div className="h-full w-px bg-transparent group-hover:bg-purple-500/60" />
      </div>
      <div className="flex items-center border-b border-zinc-800 text-xs">
        <div className="flex min-w-0 flex-1 overflow-x-auto whitespace-nowrap">
          <SideTab active={panel === 'ai'} onClick={() => onPanelChange('ai')}>
            AI Analysis
          </SideTab>
          <SideTab active={panel === 'xrefs'} onClick={() => onPanelChange('xrefs')}>
            Xrefs
          </SideTab>
          <SideTab active={panel === 'chain'} onClick={() => onPanelChange('chain')}>
            Chain
          </SideTab>
          <SideTab active={panel === 'network'} onClick={() => onPanelChange('network')}>
            Network
          </SideTab>
          <SideTab active={panel === 'ask'} onClick={() => onPanelChange('ask')}>
            Ask
          </SideTab>
          <SideTab active={panel === 'crypto'} onClick={() => onPanelChange('crypto')}>
            Crypto
          </SideTab>
          <SideTab active={panel === 'renames'} onClick={() => onPanelChange('renames')}>
            Renames
          </SideTab>
          <SideTab active={panel === 'report'} onClick={() => onPanelChange('report')}>
            Report
          </SideTab>
          <SideTab active={panel === 'gallery'} onClick={() => onPanelChange('gallery')}>
            Gallery
          </SideTab>
          <SideTab active={panel === 'strings'} onClick={() => onPanelChange('strings')}>
            Strings
          </SideTab>
          <SideTab active={panel === 'imports'} onClick={() => onPanelChange('imports')}>
            Imports
          </SideTab>
        </div>
        <button
          onClick={onCollapse}
          title="Collapse inspector panel"
          className="shrink-0 px-2 py-1.5 text-zinc-500 hover:text-zinc-100"
        >
          <span aria-hidden>›</span>
        </button>
      </div>
      {/* Each panel is wrapped in a `hidden`-toggled div so its internal
          state (AskPanel threads, CryptoPanel results, ChainPanel
          narrations, ReportEditor draft) survives a tab switch. The
          activated Set gates first-mount so Report + Gallery don't fetch
          until the user opens them. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activated.has('xrefs') && (
          <div className={panel === 'xrefs' ? '' : 'hidden'}>
            <XrefsPanel fn={fn} fnByName={fnByName} onSelect={onSelect} />
          </div>
        )}
        {activated.has('chain') && (
          <div className={panel === 'chain' ? '' : 'hidden'}>
            <ChainPanel
              projectId={projectId}
              fn={fn}
              fnByName={fnByName}
              onSelect={onSelect}
            />
          </div>
        )}
        {activated.has('network') && (
          <div className={panel === 'network' ? '' : 'hidden'}>
            <NetworkPanel analysis={analysis} fnByName={fnByName} onSelect={onSelect} />
          </div>
        )}
        {activated.has('ask') && (
          <div className={`h-full ${panel === 'ask' ? '' : 'hidden'}`}>
            <AskPanel projectId={projectId} fn={fn} />
          </div>
        )}
        {activated.has('ai') && (
          <div className={panel === 'ai' ? '' : 'hidden'}>
            <AIPanel projectId={projectId} fnByName={fnByName} onSelect={onSelect} />
          </div>
        )}
        {activated.has('crypto') && (
          <div className={`h-full ${panel === 'crypto' ? '' : 'hidden'}`}>
            <CryptoPanel projectId={projectId} fn={fn} />
          </div>
        )}
        {activated.has('renames') && (
          <div className={`h-full ${panel === 'renames' ? '' : 'hidden'}`}>
            <RenamesPanel
              projectId={projectId}
              fn={fn}
              onMutation={onRenameMutation}
            />
          </div>
        )}
        {activated.has('report') && (
          <div className={`p-3 ${panel === 'report' ? '' : 'hidden'}`}>
            <ReportEditor
              projectId={projectId}
              compact
              toolbarExtra={
                <Link
                  to={`/projects/${projectId}/report`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open report in a new tab"
                  className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
                >
                  ↗ Full tab
                </Link>
              }
            />
          </div>
        )}
        {activated.has('gallery') && (
          <div className={panel === 'gallery' ? '' : 'hidden'}>
            <Gallery projectId={projectId} refreshKey={galleryKey} />
          </div>
        )}
        {activated.has('strings') && (
          <div className={panel === 'strings' ? '' : 'hidden'}>
            <StringsPanel strings={analysis.strings} />
          </div>
        )}
        {activated.has('imports') && (
          <div className={panel === 'imports' ? '' : 'hidden'}>
            <ImportsPanel imports={analysis.imports} />
          </div>
        )}
      </div>
    </aside>
  )
}

function SideTab({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 border-r border-zinc-800 px-2 py-1.5 last:border-r-0 ${
        active ? 'bg-zinc-900 text-purple-300' : 'text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {children}
    </button>
  )
}

function XrefsPanel({
  fn,
  fnByName,
  onSelect,
}: {
  fn: BinaryFunction | null
  fnByName: Map<string, BinaryFunction>
  onSelect: (name: string, hint?: JumpHint) => void
}) {
  if (!fn) {
    return <EmptyState>Select a function to see xrefs.</EmptyState>
  }
  const { callers, callees } = fn.xrefs
  // Clicking a caller jumps to the line in that caller's body where the
  // current fn is referenced. Clicking a callee just navigates — the
  // callee's first line is the function header; there's no specific
  // "interesting" line within the destination function to flash.
  const onCallerClick = (callerName: string) => {
    const callerFn = fnByName.get(callerName)
    if (callerFn) {
      const hint = findCallSiteIn(callerFn, fn.name)
      onSelect(callerName, hint)
    } else {
      onSelect(callerName)
    }
  }
  return (
    <div className="space-y-4 p-3">
      <XrefList
        title="Called by"
        names={callers}
        fnByName={fnByName}
        onClick={onCallerClick}
        empty="No incoming references."
      />
      <XrefList
        title="Calls"
        names={callees}
        fnByName={fnByName}
        onClick={(name) => onSelect(name)}
        empty="No outgoing references."
      />
    </div>
  )
}

function XrefList({
  title,
  names,
  fnByName,
  onClick,
  empty,
}: {
  title: string
  names: string[]
  fnByName: Map<string, BinaryFunction>
  onClick: (name: string) => void
  empty: string
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wider text-zinc-500">
        {title} ({names.length})
      </div>
      {names.length === 0 ? (
        <div className="text-[11px] text-zinc-600">{empty}</div>
      ) : (
        <ul className="space-y-0.5">
          {names.map((n) => {
            // External names won't appear in fnByName (they're not in the
            // functions list); render them as inert text rather than a button
            // that goes nowhere.
            const target = fnByName.get(n)
            return (
              <li key={n}>
                {target ? (
                  <button
                    onClick={() => onClick(n)}
                    className="block w-full truncate text-left font-mono text-xs text-zinc-300 hover:text-purple-300"
                  >
                    {n}
                  </button>
                ) : (
                  <span className="block truncate font-mono text-xs text-zinc-500">
                    {n}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// =========================================================================
// Call chain panel
// =========================================================================

// One node in the call-chain tree we render. `fn` is null for externals
// (imports / PLT entries) — we still surface them as inert leaves so the
// user can see "this function calls printf" even though we have no body
// for printf.
type ChainNode = {
  name: string
  fn: BinaryFunction | null
  children: ChainNode[]
  // Depth limit hit at this node and there were more neighbours below.
  // Surfaces an honest "+N more" hint in the UI.
  truncated: number
  // We saw this name higher up the same branch. Render once as a leaf with a
  // cycle marker so the tree stays finite.
  cyclic: boolean
}

type ChainDirection = 'callers' | 'callees'

const CHAIN_MAX_DEPTH = 5
const CHAIN_DEFAULT_DEPTH = 3
// Cap fan-out at each node so hot functions like _printf with thousands of
// callers don't lock the renderer. The truncation count is surfaced in the
// UI alongside the kept children.
const CHAIN_MAX_FANOUT = 12

function neighbours(fn: BinaryFunction, dir: ChainDirection): string[] {
  return dir === 'callers' ? fn.xrefs.callers : fn.xrefs.callees
}

/**
 * Walk the in-memory call graph rooted at {@code rootName}. Dedupe visited
 * names across the whole tree (not just the current branch) — diamond
 * structures collapse to a cycle leaf the second time we see them, which
 * keeps the rendered tree small and self-similar.
 */
function buildChain(
  rootName: string,
  fnByName: Map<string, BinaryFunction>,
  maxDepth: number,
  dir: ChainDirection,
): ChainNode {
  const visited = new Set<string>([rootName])
  function walk(name: string, depth: number): ChainNode {
    const fn = fnByName.get(name) ?? null
    if (!fn) return { name, fn: null, children: [], truncated: 0, cyclic: false }
    const ns = neighbours(fn, dir)
    if (depth >= maxDepth) {
      return { name, fn, children: [], truncated: ns.length, cyclic: false }
    }
    const kept: ChainNode[] = []
    let dropped = 0
    for (const next of ns) {
      if (kept.length >= CHAIN_MAX_FANOUT) { dropped++; continue }
      if (visited.has(next)) {
        kept.push({ name: next, fn: fnByName.get(next) ?? null, children: [], truncated: 0, cyclic: true })
        continue
      }
      visited.add(next)
      kept.push(walk(next, depth + 1))
    }
    return { name, fn, children: kept, truncated: dropped, cyclic: false }
  }
  return walk(rootName, 0)
}

/**
 * Recursively walk both chain trees and yield every unique function name
 * present (root + all descendants). Used for two things:
 *
 *   1. Narrate — flat list sent to the backend so it can pull each
 *      function's decompiled body from the analysis JSON.
 *   2. Markdown render for "Add to report".
 *
 * Dedup is name-only since the openbin chain already collapses cycles +
 * diamonds during construction; a name only appears once per tree even at
 * arbitrary depth.
 */
function collectChainNames(callers: ChainNode | null, callees: ChainNode | null): string[] {
  const out = new Set<string>()
  function walk(n: ChainNode | null) {
    if (!n) return
    out.add(n.name)
    for (const c of n.children) walk(c)
  }
  walk(callers)
  walk(callees)
  return Array.from(out)
}

function ChainPanel({
  projectId,
  fn,
  fnByName,
  onSelect,
}: {
  projectId: string
  fn: BinaryFunction | null
  fnByName: Map<string, BinaryFunction>
  onSelect: (name: string, hint?: JumpHint) => void
}) {
  const api = useApi()
  const [depth, setDepth] = useState(CHAIN_DEFAULT_DEPTH)

  // Narrate flow — credential dropdown + per-name narrations the chain
  // tree renders inline. Narrations are keyed by chain root name AND project,
  // and loaded from localStorage on root change so previously-paid-for
  // narrations come back after a refresh / tab switch / function jump.
  const [credentials, setCredentials] = useState<Credential[] | null>(null)
  const [credentialId, setCredentialId] = useState<string>('')
  const [narrations, setNarrations] = useState<Map<string, string>>(new Map())
  const [busy, setBusy] = useState<'narrate' | 'report' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const creds = await api<Credential[]>('/api/credentials')
        if (cancelled) return
        setCredentials(creds)
        if (creds.length > 0) setCredentialId((prev) => prev || creds[0].id)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [api])

  // Swap narrations + status messages whenever the root changes. Each
  // (project, root) pair has its own localStorage slot — the map's keys
  // belong to that specific chain, so a different root needs a different
  // map. Empty Map on miss; populated from storage when present.
  useEffect(() => {
    if (!fn) {
      setNarrations(new Map())
    } else {
      setNarrations(loadStringRecord<string>(chainNarrationsKey(projectId, fn.name)))
    }
    setError(null)
    setHint(null)
  }, [fn?.name, projectId])

  // Recompute both trees when the root or depth changes. fnByName changes on
  // every reload (rename, re-analyze) so a rename in the middle of browsing
  // refreshes the chain too.
  const callers = useMemo(
    () => (fn ? buildChain(fn.name, fnByName, depth, 'callers') : null),
    [fn?.name, fnByName, depth],
  )
  const callees = useMemo(
    () => (fn ? buildChain(fn.name, fnByName, depth, 'callees') : null),
    [fn?.name, fnByName, depth],
  )

  const chainNames = useMemo(
    () => collectChainNames(callers, callees),
    [callers, callees],
  )

  async function narrate() {
    if (!fn || !credentialId) return
    setBusy('narrate')
    setError(null)
    setHint(null)
    try {
      const resp = await api<{
        summaries: { name: string; narration: string }[]
        inputTokens: number
        outputTokens: number
        model: string
      }>(`/api/projects/${projectId}/callchains/narrate-bin`, {
        method: 'POST',
        body: JSON.stringify({ functionNames: chainNames, credentialId }),
      })
      const next = new Map(narrations)
      for (const s of resp.summaries) next.set(s.name, s.narration)
      setNarrations(next)
      saveStringRecord(chainNarrationsKey(projectId, fn.name), next)
      setHint(
        `${resp.summaries.length} narration${resp.summaries.length === 1 ? '' : 's'} ` +
        `(in ${resp.inputTokens.toLocaleString()} · out ${resp.outputTokens.toLocaleString()} · ${resp.model})`,
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function addToReport() {
    if (!fn) return
    setBusy('report')
    setError(null)
    setHint(null)
    try {
      // Pull current report, append a chain section, PUT back. The report
      // service has no chain-specific endpoint — this is the same pattern
      // openapk's CallChain uses for symmetry.
      const current = await api<{
        title: string
        sections: { id: string; title: string; content: string }[]
      }>(`/api/projects/${projectId}/report`)
      const md = renderChainMarkdown(fn, callers, callees, narrations)
      const newSection = {
        id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `chain-${Date.now()}`,
        title: `Call chain: ${fn.name}`,
        content: md,
      }
      await api(`/api/projects/${projectId}/report`, {
        method: 'PUT',
        body: JSON.stringify({
          title: current.title,
          sections: [...current.sections, newSection],
        }),
      })
      setHint('Added a new section to the report.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!fn) {
    return <EmptyState>Select a function to trace its call chain.</EmptyState>
  }

  const noCreds = credentials !== null && credentials.length === 0
  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          Call chain
        </h3>
        <label
          className="flex items-center gap-1 text-[10px] text-zinc-400"
          title={`How many levels in each direction (1–${CHAIN_MAX_DEPTH})`}
        >
          depth
          <input
            type="number"
            min={1}
            max={CHAIN_MAX_DEPTH}
            value={depth}
            onChange={(e) =>
              setDepth(Math.min(CHAIN_MAX_DEPTH, Math.max(1, Number(e.target.value) || 1)))
            }
            className="w-10 rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-[10px] text-zinc-200"
          />
        </label>
      </div>

      <div className="rounded border border-purple-500/40 bg-zinc-950/60 p-2">
        <div className="text-[9px] uppercase tracking-wider text-purple-300">Root</div>
        <div className="truncate font-mono text-xs text-zinc-100" title={fn.name}>
          {fn.name}
        </div>
        <div className="text-[10px] text-zinc-600">@ {fn.address}</div>
        {narrations.get(fn.name) && (
          <p className="mt-1 text-[11px] italic text-zinc-300">
            {narrations.get(fn.name)}
          </p>
        )}
      </div>

      <ChainSection
        title="Callers"
        hint="Who invokes this"
        root={callers}
        direction="callers"
        fnByName={fnByName}
        narrations={narrations}
        onSelect={onSelect}
      />
      <ChainSection
        title="Callees"
        hint="What this invokes"
        root={callees}
        direction="callees"
        fnByName={fnByName}
        narrations={narrations}
        onSelect={onSelect}
      />

      <div className="space-y-2 border-t border-zinc-800 pt-3">
        {credentials === null ? (
          <div className="text-[10px] text-zinc-500">Loading credentials…</div>
        ) : noCreds ? (
          <div className="text-[11px] text-zinc-500">
            No LLM credentials yet.{' '}
            <Link to="/settings/api-keys" className="text-purple-300 hover:underline">
              Add one
            </Link>
            .
          </div>
        ) : (
          <select
            value={credentialId}
            onChange={(e) => setCredentialId(e.target.value)}
            className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-200"
          >
            {credentials.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.provider})
              </option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={() => void narrate()}
            disabled={busy !== null || noCreds || credentials === null || chainNames.length === 0}
            title={
              chainNames.length === 0
                ? 'Empty chain — nothing to narrate'
                : 'Send every function in the chain to the LLM for a one-sentence summary'
            }
            className="flex-1 rounded bg-purple-600 px-2 py-1 font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'narrate' ? 'Narrating…' : '✨ Narrate with AI'}
          </button>
          <button
            onClick={() => void addToReport()}
            disabled={busy !== null}
            title="Append a new Markdown section to the project report with this chain"
            className="rounded border border-zinc-700 px-2 py-1 text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            {busy === 'report' ? '…' : '＋ Report'}
          </button>
        </div>
        {hint && <div className="text-[10px] text-emerald-400/80">{hint}</div>}
        {error && (
          <div className="rounded border border-red-800 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Render the current chain as a Markdown section for the project report.
 * Each tree is indented by depth; narrations (if present) follow the
 * function name as italic.
 */
function renderChainMarkdown(
  root: BinaryFunction,
  callers: ChainNode | null,
  callees: ChainNode | null,
  narrations: Map<string, string>,
): string {
  const lines: string[] = []
  lines.push(`**Root** — \`${root.name}\` @ \`${root.address}\``)
  const rootNarr = narrations.get(root.name)
  if (rootNarr) lines.push('', `> ${rootNarr}`)
  if (callers && callers.children.length > 0) {
    lines.push('', '### Callers (who invokes this)', '')
    for (const c of callers.children) renderChainNodeMd(c, 0, narrations, lines)
  }
  if (callees && callees.children.length > 0) {
    lines.push('', '### Callees (what this invokes)', '')
    for (const c of callees.children) renderChainNodeMd(c, 0, narrations, lines)
  }
  return lines.join('\n')
}

function renderChainNodeMd(
  node: ChainNode,
  depth: number,
  narrations: Map<string, string>,
  out: string[],
): void {
  const indent = '  '.repeat(depth)
  const cyclic = node.cyclic ? ' _(cycle)_' : ''
  out.push(`${indent}- **\`${node.name}\`**${cyclic}`)
  const narr = narrations.get(node.name)
  if (narr) out.push(`${indent}  - _${narr}_`)
  for (const c of node.children) renderChainNodeMd(c, depth + 1, narrations, out)
}

function ChainSection({
  title,
  hint,
  root,
  direction,
  fnByName,
  narrations,
  onSelect,
}: {
  title: string
  hint: string
  root: ChainNode | null
  // 'callers': clicked node CALLS its parent — we can compute a call-site
  // line inside the clicked node's body. 'callees': clicked node is CALLED
  // BY its parent — no in-body line to highlight; navigate plain.
  direction: ChainDirection
  fnByName: Map<string, BinaryFunction>
  // Optional name → narration map populated by the AI narrate flow. When
  // a node's name has an entry, ChainNodeView renders it as italic text
  // under the function name.
  narrations: Map<string, string>
  onSelect: (name: string, hint?: JumpHint) => void
}) {
  const total = root ? countChainNodes(root) - 1 : 0
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
          {title} ({total})
        </div>
        <div className="text-[10px] text-zinc-600">{hint}</div>
      </div>
      {!root || root.children.length === 0 ? (
        <div className="text-[11px] text-zinc-600">No {title.toLowerCase()}.</div>
      ) : (
        <ul className="space-y-0.5">
          {root.children.map((c, i) => (
            <ChainNodeView
              key={`${c.name}:${i}`}
              node={c}
              depth={0}
              parentName={root.name}
              direction={direction}
              fnByName={fnByName}
              narrations={narrations}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function countChainNodes(node: ChainNode): number {
  let n = 1
  for (const c of node.children) n += countChainNodes(c)
  return n
}

function ChainNodeView({
  node,
  depth,
  parentName,
  direction,
  fnByName,
  narrations,
  onSelect,
}: {
  node: ChainNode
  depth: number
  // The node one level closer to root in the rendered tree. In callers
  // direction, node CALLS parentName; in callees direction, parentName
  // CALLS node.
  parentName: string
  direction: ChainDirection
  fnByName: Map<string, BinaryFunction>
  narrations: Map<string, string>
  onSelect: (name: string, hint?: JumpHint) => void
}) {
  const [open, setOpen] = useState(depth < 1)
  const hasChildren = node.children.length > 0

  // In callers direction the clicked node calls its parent — we can scan
  // the node's body for the parent name and flash that call site. In
  // callees direction the call site lives in the parent (not in the
  // clicked node), so a plain navigation is the right behavior.
  const handleClick = () => {
    if (direction === 'callers' && node.fn) {
      const jumpHint = findCallSiteIn(node.fn, parentName)
      onSelect(node.name, jumpHint)
    } else {
      onSelect(node.name)
    }
  }

  return (
    <li
      className="border-l border-zinc-800 pl-2"
      style={{ marginLeft: depth * 6 }}
    >
      <div className="flex items-center gap-1">
        {hasChildren ? (
          <button
            onClick={() => setOpen((o) => !o)}
            className="w-3 text-zinc-500 hover:text-zinc-200"
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-3 text-zinc-700">·</span>
        )}
        {node.fn ? (
          <button
            onClick={handleClick}
            className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-zinc-200 hover:text-purple-300"
            title={
              direction === 'callers'
                ? `${node.name} — calls ${parentName}`
                : `${node.name} — called by ${parentName}`
            }
          >
            {node.name}
          </button>
        ) : (
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-500"
            title={`${node.name} (external — no body)`}
          >
            {node.name}
          </span>
        )}
        {node.cyclic && (
          <span className="shrink-0 text-[9px] text-amber-400/80" title="Already shown above — cycle/diamond avoided">
            ↻
          </span>
        )}
      </div>
      {/* AI-narrate output: one-sentence summary keyed by function name.
          Renders only when a narration exists for this node (cyclic nodes
          get one too — same name on the other branch ran the LLM). */}
      {narrations.get(node.name) && (
        <p className="ml-3 mt-0.5 text-[11px] italic text-zinc-300">
          {narrations.get(node.name)}
        </p>
      )}
      {open && hasChildren && (
        <ul className="mt-0.5 space-y-0.5">
          {node.children.map((c, i) => (
            <ChainNodeView
              key={`${c.name}:${i}`}
              node={c}
              depth={depth + 1}
              parentName={node.name}
              direction={direction}
              fnByName={fnByName}
              narrations={narrations}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
      {node.truncated > 0 && (
        <div
          className="ml-3 text-[10px] text-amber-400/80"
          title={`Depth/fan-out cap hit — ${node.truncated} more neighbour${node.truncated === 1 ? '' : 's'} below this node not expanded.`}
        >
          + {node.truncated} more
        </div>
      )}
    </li>
  )
}

// =========================================================================
// Renames panel
// =========================================================================

/**
 * AI rename UX for the currently-selected function. Two halves:
 *
 *   1. Top section — kicks off /renames/suggest-function for the function
 *      the user is looking at right now. The model returns suggestions for
 *      the function name and its parameters / locals.
 *
 *   2. Bottom list — every SUGGESTED + APPLIED rename row for the project,
 *      grouped by status. Suggested rows have checkboxes + "Apply selected";
 *      applied rows have an inline unapply. Mirrors the openapk Renames
 *      component but scoped to function/variable rather than class/field.
 *
 * Mutations call onMutation so the parent can refetch the analysis JSON —
 * server-side rename application is what makes the renames actually visible
 * in the viewer. When the currently-selected function is the one being
 * renamed, the parent gets the new name back via onMutation(newName) so the
 * selection follows the rename.
 */
function RenamesPanel({
  projectId,
  fn,
  onMutation,
}: {
  projectId: string
  fn: BinaryFunction | null
  onMutation: (newName?: string) => void
}) {
  const api = useApi()

  const [items, setItems] = useState<Rename[] | null>(null)
  const [credentials, setCredentials] = useState<Credential[] | null>(null)
  const [credentialId, setCredentialId] = useState<string>('')
  const [busy, setBusy] = useState<'suggest' | 'apply' | 'unapply' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Pull both the cred list and the rename list on mount. /credentials is
  // shared with the AI/Ask panels; the user's first credential becomes the
  // default for the Suggest button.
  const reload = useCallback(async () => {
    setError(null)
    try {
      const list = await api<Rename[]>(`/api/projects/${projectId}/renames`)
      setItems(list)
      setSelected((prev) => {
        const stillThere = new Set(list.map((r) => r.original))
        const next = new Set<string>()
        for (const o of prev) if (stillThere.has(o)) next.add(o)
        return next
      })
    } catch (e) {
      setError((e as Error).message)
    }
  }, [api, projectId])

  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      try {
        const [creds, list] = await Promise.all([
          api<Credential[]>('/api/credentials'),
          api<Rename[]>(`/api/projects/${projectId}/renames`),
        ])
        if (cancelled) return
        setCredentials(creds)
        if (creds.length > 0) setCredentialId((prev) => prev || creds[0].id)
        setItems(list)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    }
    void bootstrap()
    return () => { cancelled = true }
  }, [api, projectId])

  async function suggest() {
    if (!fn) return
    if (!credentialId) {
      setError('Pick an LLM credential first.')
      return
    }
    setBusy('suggest')
    setError(null)
    setHint(null)
    try {
      const resp = await api<{
        suggestions: Rename[]
        inputTokens: number
        outputTokens: number
        model: string
      }>(`/api/projects/${projectId}/renames/suggest-function`, {
        method: 'POST',
        body: JSON.stringify({ functionName: fn.name, credentialId }),
      })
      setHint(
        `${resp.suggestions.length} suggestion${resp.suggestions.length === 1 ? '' : 's'} ` +
        `(in ${resp.inputTokens.toLocaleString()} · out ${resp.outputTokens.toLocaleString()} · ${resp.model})`,
      )
      await reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function applySelected() {
    if (selected.size === 0 || !items) return
    setBusy('apply')
    setError(null)
    setHint(null)
    // Track whether the currently-viewed function is among the renames being
    // applied. If yes, hand its new name back to the parent so the selection
    // follows. Only function-scope rename can rename the outer function.
    const fnRenameMatch = items.find(
      (r) =>
        r.status === 'SUGGESTED' &&
        selected.has(r.original) &&
        r.scope === 'function' &&
        fn != null &&
        r.original === fn.name,
    )
    try {
      await api(`/api/projects/${projectId}/renames/apply`, {
        method: 'POST',
        body: JSON.stringify({ originals: Array.from(selected) }),
      })
      setSelected(new Set())
      await reload()
      onMutation(fnRenameMatch?.suggested)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function unapply(original: string, suggested: string) {
    if (!window.confirm(`Remove the rename "${original}" → "${suggested}"?`)) return
    setBusy('unapply')
    setError(null)
    setHint(null)
    // If we're unapplying the rename of the currently-viewed function, the
    // selection should follow back to the original name.
    const isCurrent = fn != null && fn.name === suggested
    try {
      await api(
        `/api/projects/${projectId}/renames?original=${encodeURIComponent(original)}`,
        { method: 'DELETE' },
      )
      await reload()
      onMutation(isCurrent ? original : undefined)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (items === null || credentials === null) {
    return <EmptyState>Loading…</EmptyState>
  }

  const suggested = items.filter((r) => r.status === 'SUGGESTED')
  const applied = items.filter((r) => r.status === 'APPLIED')
  const fnDisabled = !fn || fn.external || fn.thunk
  const credDisabled = credentials.length === 0

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="space-y-2 border-b border-zinc-800 p-3">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
          Suggest names for current function
        </div>
        {credDisabled ? (
          <div className="text-[11px] text-zinc-500">
            No LLM credentials yet.{' '}
            <Link to="/settings/api-keys" className="text-purple-300 hover:underline">
              Add one
            </Link>
            .
          </div>
        ) : (
          <select
            value={credentialId}
            onChange={(e) => setCredentialId(e.target.value)}
            className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-200"
          >
            {credentials.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.provider})
              </option>
            ))}
          </select>
        )}
        <button
          onClick={() => void suggest()}
          disabled={busy !== null || fnDisabled || credDisabled}
          title={
            !fn
              ? 'Select a function first'
              : fn.external
                ? 'External functions have no body to analyze'
                : fn.thunk
                  ? 'Thunks have no body to analyze'
                  : 'Send this function to the LLM for rename suggestions'
          }
          className="w-full rounded bg-purple-600 px-3 py-1.5 font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'suggest'
            ? 'Analyzing…'
            : fn
              ? `✨ Suggest for ${fn.name}`
              : '✨ Select a function first'}
        </button>
        {hint && <div className="text-[10px] text-zinc-500">{hint}</div>}
        {error && (
          <div className="rounded border border-red-800 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
            {error}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {suggested.length === 0 && applied.length === 0 && (
          <div className="text-[11px] text-zinc-500">
            No renames yet. Use the Suggest button above, or rename inline from
            the code pane header.
          </div>
        )}

        {suggested.length > 0 && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                Suggested ({suggested.length})
              </h3>
              <div className="flex gap-1">
                <button
                  onClick={() => setSelected(new Set(suggested.map((s) => s.original)))}
                  className="text-[10px] text-zinc-400 hover:text-zinc-200"
                >
                  Select all
                </button>
                <span className="text-[10px] text-zinc-600">·</span>
                <button
                  onClick={() => setSelected(new Set())}
                  disabled={selected.size === 0}
                  className="text-[10px] text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
                >
                  Clear
                </button>
              </div>
            </div>
            <ul className="space-y-2">
              {suggested.map((r) => (
                <li key={r.id} className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.original)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(r.original)
                          else next.delete(r.original)
                          return next
                        })
                      }
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        <span className="font-mono text-zinc-400 line-through">{r.original}</span>
                        <span className="text-zinc-500">→</span>
                        <span className="font-mono text-purple-300">{r.suggested}</span>
                        <ScopePill scope={r.scope} />
                        <ConfPill confidence={r.confidence} />
                      </div>
                      {r.sourcePath?.startsWith('function:') && (
                        <div className="mt-0.5 text-[10px] text-zinc-600">
                          in <span className="font-mono">{r.sourcePath.slice('function:'.length)}</span>
                        </div>
                      )}
                      {r.rationale && (
                        <p className="mt-1 text-[11px] text-zinc-400">{r.rationale}</p>
                      )}
                    </div>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => void applySelected()}
                disabled={busy !== null || selected.size === 0}
                className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy === 'apply' ? 'Applying…' : `Apply selected (${selected.size})`}
              </button>
              <span className="text-[10px] text-zinc-600">
                Function renames apply project-wide; variable renames only
                affect that function's body.
              </span>
            </div>
          </section>
        )}

        {applied.length > 0 && (
          <section>
            <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Active ({applied.length})
            </h3>
            <ul className="space-y-1">
              {applied.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-2 rounded border border-emerald-900/40 bg-emerald-950/20 px-2 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate font-mono">
                    <span className="text-zinc-500 line-through">{r.original}</span>
                    <span className="mx-1 text-zinc-600">→</span>
                    <span className="text-emerald-200">{r.suggested}</span>
                  </span>
                  <ScopePill scope={r.scope} />
                  <button
                    onClick={() => void unapply(r.original, r.suggested)}
                    disabled={busy !== null}
                    title="Unapply this rename"
                    className="rounded text-[11px] text-zinc-400 hover:text-red-300 disabled:opacity-30"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

function ScopePill({ scope }: { scope: string }) {
  const styles: Record<string, string> = {
    function: 'bg-sky-950/60 text-sky-300',
    variable: 'bg-amber-950/60 text-amber-300',
    class: 'bg-purple-950/60 text-purple-300',
    method: 'bg-sky-950/60 text-sky-300',
    field: 'bg-amber-950/60 text-amber-300',
  }
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${
        styles[scope] ?? 'bg-zinc-800 text-zinc-300'
      }`}
    >
      {scope}
    </span>
  )
}

function ConfPill({ confidence }: { confidence: string }) {
  const styles =
    confidence === 'high'
      ? 'bg-emerald-950/60 text-emerald-300'
      : confidence === 'manual'
        ? 'bg-zinc-700 text-zinc-200'
        : 'bg-zinc-800 text-zinc-300'
  return (
    <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${styles}`}>
      {confidence}
    </span>
  )
}

// =========================================================================
// Crypto panel — AI-generated Python decryptor
// =========================================================================

type BinDecryptor = {
  script: string
  explanation: string
  algorithm: string
  inputTokens: number
  outputTokens: number
  model: string
}

/**
 * Generates a Python decryptor that recreates whatever crypto / obfuscation
 * / packed-string-decoding the currently-viewed function implements. The
 * user picks a function (the Crypto panel reflects whichever fn the rest
 * of the inspector is showing), clicks Generate, and gets a script back.
 *
 * Per-function workflow — no list of "crypto hits" like the APK Crypto
 * panel. The user decides which function looks suspicious (often from
 * Suggest renames, AI hotspots, or string analysis) and asks for a
 * decryptor on the spot. Results are kept in a Map keyed by function
 * name so switching functions and back doesn't lose the previously-
 * generated script.
 */
function CryptoPanel({
  projectId,
  fn,
}: {
  projectId: string
  fn: BinaryFunction | null
}) {
  const api = useApi()
  const [credentials, setCredentials] = useState<Credential[] | null>(null)
  const [credentialId, setCredentialId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Map per function so the user can flip back to a previously-generated
  // script. Kept in a ref because we mutate without needing a re-render
  // on the keystroke that runs generate(); the result state below drives
  // what the panel actually shows. Loaded from localStorage so generated
  // scripts survive page refresh — they're the most expensive thing in
  // the panel to regenerate.
  const resultsRef = useRef<Map<string, BinDecryptor>>(
    loadStringRecord<BinDecryptor>(cryptoStorageKey(projectId)),
  )
  const [result, setResult] = useState<BinDecryptor | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const creds = await api<Credential[]>('/api/credentials')
        if (cancelled) return
        setCredentials(creds)
        if (creds.length > 0) setCredentialId((prev) => prev || creds[0].id)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [api])

  // Cross-project navigation reuses this component instance with a new
  // projectId prop; the useRef above already loaded the previous project's
  // data and won't re-init. Reload it from storage when projectId changes.
  useEffect(() => {
    resultsRef.current = loadStringRecord<BinDecryptor>(cryptoStorageKey(projectId))
  }, [projectId])

  // When the user switches functions (or the project changes and we just
  // reloaded the ref above), swap the visible result for the cached one
  // (if we generated one for that function before). Clear copy + error
  // state so they don't bleed across functions.
  useEffect(() => {
    if (!fn) {
      setResult(null)
      setError(null)
      setCopied(false)
      return
    }
    setResult(resultsRef.current.get(fn.name) ?? null)
    setError(null)
    setCopied(false)
  }, [fn?.name, projectId])

  async function generate() {
    if (!fn) return
    if (!credentialId) {
      setError('Pick an LLM credential first.')
      return
    }
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const resp = await api<BinDecryptor>(`/api/projects/${projectId}/crypto/generate-bin`, {
        method: 'POST',
        body: JSON.stringify({ functionName: fn.name, credentialId }),
      })
      resultsRef.current.set(fn.name, resp)
      saveStringRecord(cryptoStorageKey(projectId), resultsRef.current)
      setResult(resp)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function copyScript() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.script)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API unavailable (insecure context etc.) — silently
      // ignore; the user can still select + copy the rendered <pre>.
    }
  }

  if (credentials === null) {
    return <EmptyState>Loading credentials…</EmptyState>
  }
  if (credentials.length === 0) {
    return (
      <div className="space-y-2 p-3 text-xs text-zinc-500">
        <p>No LLM credentials configured yet.</p>
        <Link
          to="/settings/api-keys"
          className="inline-block rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500"
        >
          Add a credential
        </Link>
      </div>
    )
  }

  const fnDisabled = !fn || fn.external || fn.thunk

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="space-y-2 border-b border-zinc-800 p-3">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
          Generate Python decryptor
        </div>
        {fn ? (
          <div className="truncate font-mono text-zinc-200" title={fn.name}>
            {fn.name}
          </div>
        ) : (
          <div className="text-zinc-500">
            Select a function from the list to generate a decryptor for it.
          </div>
        )}
        <select
          value={credentialId}
          onChange={(e) => setCredentialId(e.target.value)}
          className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-200"
        >
          {credentials.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} ({c.provider})
            </option>
          ))}
        </select>
        <button
          onClick={() => void generate()}
          disabled={busy || fnDisabled}
          title={
            !fn
              ? 'Select a function first'
              : fn.external
                ? 'External functions have no body to analyze'
                : fn.thunk
                  ? 'Thunks have no body to analyze'
                  : 'Send the decompiled C to the LLM and generate a Python decryptor'
          }
          className="w-full rounded bg-purple-600 px-3 py-1.5 font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy
            ? 'Generating…'
            : result
              ? '↻ Regenerate'
              : '🔓 Generate decryptor'}
        </button>
        {error && (
          <div className="rounded border border-red-800 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
            {error}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!result && !busy && (
          <div className="text-[11px] text-zinc-600">
            Pick a function the user suspects implements obfuscation, packed
            strings, custom encryption, or a known cipher (XOR / AES / RC4 /
            Base64-ish). The model returns a self-contained Python 3 script
            with a single <span className="font-mono">decrypt(…)</span>{' '}
            function that reproduces the operation.
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                  Algorithm
                </div>
                <div className="text-[10px] text-zinc-600">
                  {result.model} · {result.inputTokens.toLocaleString()} in ·{' '}
                  {result.outputTokens.toLocaleString()} out
                </div>
              </div>
              <div className="font-mono text-[11px] text-amber-300">
                {result.algorithm || '(no label)'}
              </div>
            </div>

            {result.explanation && (
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                  Explanation
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-200">
                  {result.explanation}
                </p>
              </div>
            )}

            <div>
              <div className="mb-1 flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                  Python script
                </div>
                <button
                  onClick={() => void copyScript()}
                  className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800"
                >
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
              <pre className="max-h-[60vh] overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11px] leading-relaxed text-zinc-200">
                {result.script}
              </pre>
              <div className="mt-1 text-[10px] text-zinc-600">
                Scripts aren't persisted — copy out anything you want to keep.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// =========================================================================
// Network panel
// =========================================================================

/**
 * Known networking functions across libc, Winsock, WinINet, WinHTTP, BSD
 * sockets, and common high-level HTTP libraries. Used to:
 *
 *   1. Highlight import entries in the Network panel as "this binary can
 *      reach the network at all".
 *   2. Scan each function's decompiled body + xrefs.callees to discover
 *      "which functions actually touch the network" without needing a
 *      backend pass — the analysis JSON already has everything we need.
 *
 * Kept in sync with the backend BinaryDigestService networking entries;
 * a few extras (HTTP/TLS libs) are added here because the digest only
 * surfaces import-level signals, not call-site evidence.
 */
const NETWORK_IMPORTS = new Set<string>([
  // BSD sockets (libc)
  'socket', 'connect', 'bind', 'listen', 'accept',
  'send', 'sendto', 'sendmsg', 'recv', 'recvfrom', 'recvmsg',
  'shutdown', 'gethostbyname', 'gethostbyaddr', 'getaddrinfo', 'freeaddrinfo',
  'inet_pton', 'inet_ntop', 'inet_addr', 'inet_aton', 'inet_ntoa',
  'htons', 'htonl', 'ntohs', 'ntohl',
  // Winsock
  'WSAStartup', 'WSACleanup', 'WSASocketA', 'WSASocketW',
  'WSAConnect', 'WSASend', 'WSARecv', 'WSAAccept',
  'closesocket', 'ioctlsocket', 'select', 'setsockopt', 'getsockopt',
  // WinINet (high-level HTTP for old Windows code)
  'InternetOpenA', 'InternetOpenW',
  'InternetOpenUrlA', 'InternetOpenUrlW',
  'InternetConnectA', 'InternetConnectW',
  'InternetReadFile', 'InternetWriteFile', 'InternetCloseHandle',
  'HttpOpenRequestA', 'HttpOpenRequestW',
  'HttpSendRequestA', 'HttpSendRequestW',
  'HttpAddRequestHeadersA', 'HttpAddRequestHeadersW',
  'HttpQueryInfoA', 'HttpQueryInfoW',
  'URLDownloadToFileA', 'URLDownloadToFileW',
  // WinHTTP (newer high-level HTTP)
  'WinHttpOpen', 'WinHttpConnect', 'WinHttpOpenRequest',
  'WinHttpSendRequest', 'WinHttpReceiveResponse',
  'WinHttpReadData', 'WinHttpWriteData', 'WinHttpCloseHandle',
  // libcurl
  'curl_easy_init', 'curl_easy_setopt', 'curl_easy_perform',
  'curl_easy_cleanup', 'curl_global_init', 'curl_global_cleanup',
  'curl_slist_append',
  // TLS — OpenSSL / mbedTLS / Schannel
  'SSL_new', 'SSL_connect', 'SSL_read', 'SSL_write',
  'SSL_CTX_new', 'SSL_set_fd',
  'mbedtls_ssl_setup', 'mbedtls_ssl_handshake',
  'mbedtls_ssl_write', 'mbedtls_ssl_read',
  // CFNetwork / Foundation (macOS / iOS)
  'CFReadStreamOpen', 'CFWriteStreamOpen', 'CFStreamCreatePairWithSocketToHost',
])

// URL: scheme://… (loose, matches whatever non-whitespace follows the
// scheme). Captures the most common application-layer schemes that show
// up in binaries — http(s), ws(s), ftp(s), file, smb, tcp, udp.
const URL_RE = /\b(?:https?|wss?|ftps?|file|smb|tcp|udp):\/\/[^\s<>"')\]]+/gi

// IPv4 with optional port. Each octet validated 0-255 to weed out version
// strings like "1.2.3.400". Skips 0.0.0.0, 127.0.0.1, and 255.255.255.255
// at the rendering layer because they're rarely useful as IoCs (loopback
// + sentinel values dominate any binary that does sockets at all).
const IPV4_RE = /\b((?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})(?::(\d{1,5}))?\b/g
const IPV4_NOISE = new Set<string>(['0.0.0.0', '127.0.0.1', '255.255.255.255'])

/**
 * One call site evidence row. Exactly one of {@link pseudoLine} /
 * {@link asmAddr} is set when source location is known; both null means
 * we only saw the call in xrefs.callees (no inline source evidence —
 * function was resolved via plt/import table or similar). The UI uses
 * pseudoLine when present (users default to the pseudocode view),
 * falling back to asmAddr.
 */
type NetworkSiteHit = {
  name: string
  pseudoLine?: number
  asmAddr?: string
  snippet?: string
}

type NetworkFnHits = { fn: BinaryFunction; hits: NetworkSiteHit[] }

type NetworkExtractions = {
  urls: string[]
  ips: string[]
  networkImports: string[]
  functions: NetworkFnHits[]
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Find the first source-level call site of {@code calleeName} inside
 * {@code caller}'s body. Used by Xrefs ("Called by") + Chain (callers
 * direction) so a click on a caller can jump to + flash the line where
 * the call actually appears.
 *
 * Preference: pseudocode line first (users default to pseudo view),
 * disasm address as a fallback when the decompiler dropped or inlined
 * the call. Returns undefined when there's no in-body evidence — caller
 * falls back to a plain navigation (function start).
 */
function findCallSiteIn(caller: BinaryFunction, calleeName: string): JumpHint | undefined {
  const re = new RegExp(`\\b${escapeRegex(calleeName)}\\b`)
  if (caller.decompiled) {
    const lines = caller.decompiled.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(calleeName) && re.test(lines[i])) {
        return { pseudoLine: i + 1 }
      }
    }
  }
  if (caller.disassembly) {
    for (const d of caller.disassembly) {
      if (d.text.includes(calleeName) && re.test(d.text)) {
        return { asmAddr: d.addr }
      }
    }
  }
  return undefined
}

function extractNetwork(
  analysis: BinaryAnalysis,
  fnByName: Map<string, BinaryFunction>,
): NetworkExtractions {
  const urlSet = new Set<string>()
  const ipSet = new Set<string>()
  for (const s of analysis.strings) {
    URL_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = URL_RE.exec(s)) !== null) urlSet.add(m[0])
    IPV4_RE.lastIndex = 0
    while ((m = IPV4_RE.exec(s)) !== null) {
      const ip = m[1]
      if (IPV4_NOISE.has(ip)) continue
      ipSet.add(m[2] ? `${ip}:${m[2]}` : ip)
    }
  }

  const networkImports = analysis.imports.filter((i) => NETWORK_IMPORTS.has(i)).sort()

  // Per-function evidence. For each function we want every individual call
  // site (line in pseudocode OR addr in disasm) so the side-panel can
  // jump-to-and-flash that exact spot. xrefs.callees-only hits (no source
  // evidence) are kept as zero-location rows so the user can at least open
  // the function — the call must be there somewhere.
  const fnHits: NetworkFnHits[] = []
  for (const fn of fnByName.values()) {
    if (fn.external || fn.thunk) continue
    const sites: NetworkSiteHit[] = []
    const pseudoNamesSeen = new Set<string>()

    // Pass 1 — pseudocode lines. Cheap split + per-name contains check
    // before regex so we don't pay for the word-boundary scan unless the
    // name is actually in the line. Multiple occurrences of the same name
    // in different lines yield distinct rows.
    if (fn.decompiled) {
      const lines = fn.decompiled.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i]
        for (const name of NETWORK_IMPORTS) {
          if (!text.includes(name)) continue
          const re = new RegExp(`\\b${escapeRegex(name)}\\b`)
          if (re.test(text)) {
            pseudoNamesSeen.add(name)
            sites.push({ name, pseudoLine: i + 1, snippet: text.trim() })
          }
        }
      }
    }

    // Pass 2 — disasm rows for names not already pinned by pseudocode.
    // Same name appearing in BOTH views is the same call site rendered
    // twice; preferring pseudocode keeps the panel from doubling up.
    // Names with no pseudocode evidence still get an asm hit so the user
    // can navigate to the instruction.
    if (fn.disassembly) {
      for (const dline of fn.disassembly) {
        for (const name of NETWORK_IMPORTS) {
          if (pseudoNamesSeen.has(name)) continue
          if (!dline.text.includes(name)) continue
          const re = new RegExp(`\\b${escapeRegex(name)}\\b`)
          if (re.test(dline.text)) {
            sites.push({ name, asmAddr: dline.addr, snippet: dline.text.trim() })
          }
        }
      }
    }

    // Pass 3 — callees with no inline evidence. Sentinel row (no location)
    // means "the binary's xref table says this call exists; we just can't
    // point at a single line for it". Click navigates to function start.
    const covered = new Set(sites.map((s) => s.name))
    for (const callee of fn.xrefs.callees) {
      if (NETWORK_IMPORTS.has(callee) && !covered.has(callee)) {
        sites.push({ name: callee })
      }
    }

    if (sites.length > 0) fnHits.push({ fn, hits: sites })
  }
  fnHits.sort((a, b) => b.hits.length - a.hits.length || a.fn.name.localeCompare(b.fn.name))

  return {
    urls: Array.from(urlSet).sort(),
    ips: Array.from(ipSet).sort(),
    networkImports,
    functions: fnHits,
  }
}

function NetworkPanel({
  analysis,
  fnByName,
  onSelect,
}: {
  analysis: BinaryAnalysis
  fnByName: Map<string, BinaryFunction>
  // Accepts an optional JumpHint so a call-site row can scroll to + flash
  // its exact pseudocode line or disasm address.
  onSelect: (name: string, hint?: JumpHint) => void
}) {
  // Recompute on rename / re-analysis (fnByName identity changes) so the
  // network view stays in sync with the rest of the inspector.
  const ext = useMemo(() => extractNetwork(analysis, fnByName), [analysis, fnByName])

  const empty =
    ext.urls.length === 0 &&
    ext.ips.length === 0 &&
    ext.networkImports.length === 0 &&
    ext.functions.length === 0

  if (empty) {
    return (
      <EmptyState>
        No network indicators found. The binary doesn't link any known
        networking APIs and no URLs / IPs are present in extracted strings.
      </EmptyState>
    )
  }

  return (
    <div className="space-y-4 p-3 text-xs">
      {ext.urls.length > 0 && (
        <NetworkSection title="URLs" count={ext.urls.length}>
          <ul className="space-y-0.5">
            {ext.urls.map((u) => (
              <li key={u} className="break-all font-mono text-[11px] text-purple-300" title={u}>
                {u}
              </li>
            ))}
          </ul>
        </NetworkSection>
      )}

      {ext.ips.length > 0 && (
        <NetworkSection title="IP addresses" count={ext.ips.length}>
          <ul className="space-y-0.5">
            {ext.ips.map((ip) => (
              <li key={ip} className="font-mono text-[11px] text-amber-300">
                {ip}
              </li>
            ))}
          </ul>
        </NetworkSection>
      )}

      {ext.networkImports.length > 0 && (
        <NetworkSection title="Networking imports" count={ext.networkImports.length}>
          <ul className="flex flex-wrap gap-1">
            {ext.networkImports.map((n) => (
              <li
                key={n}
                className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200"
              >
                {n}
              </li>
            ))}
          </ul>
        </NetworkSection>
      )}

      {ext.functions.length > 0 && (
        <NetworkSection title="Call sites" count={ext.functions.reduce((n, f) => n + f.hits.length, 0)}>
          <ul className="space-y-2">
            {ext.functions.map(({ fn, hits }) => (
              <li key={fn.address} className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
                <button
                  onClick={() => onSelect(fn.name)}
                  className="block w-full truncate text-left font-mono text-[11px] text-zinc-200 hover:text-purple-300"
                  title={`${fn.name} — open at top`}
                >
                  {fn.name}
                </button>
                <ul className="mt-1 space-y-0.5">
                  {hits.map((h, i) => (
                    <li key={`${fn.address}:${i}`}>
                      <button
                        onClick={() => {
                          if (h.pseudoLine != null) {
                            onSelect(fn.name, { pseudoLine: h.pseudoLine })
                          } else if (h.asmAddr != null) {
                            onSelect(fn.name, { asmAddr: h.asmAddr })
                          } else {
                            // xref-only hit — no source location available;
                            // just navigate to function start.
                            onSelect(fn.name)
                          }
                        }}
                        className="block w-full rounded px-1 py-0.5 text-left hover:bg-zinc-800"
                        title={
                          h.pseudoLine != null
                            ? `${fn.name} — pseudocode line ${h.pseudoLine}`
                            : h.asmAddr != null
                              ? `${fn.name} — disasm ${h.asmAddr}`
                              : `${fn.name} — call known from xref table only`
                        }
                      >
                        <div className="flex items-baseline gap-2 truncate">
                          <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                            {h.name}
                          </span>
                          {h.pseudoLine != null && (
                            <span className="shrink-0 text-[10px] text-zinc-500">:{h.pseudoLine}</span>
                          )}
                          {h.pseudoLine == null && h.asmAddr != null && (
                            <span className="shrink-0 font-mono text-[10px] text-zinc-500">@ {h.asmAddr}</span>
                          )}
                          {h.pseudoLine == null && h.asmAddr == null && (
                            <span className="shrink-0 text-[10px] text-zinc-600">(xref only)</span>
                          )}
                        </div>
                        {h.snippet && (
                          <div className="truncate font-mono text-[10px] text-zinc-500">
                            {h.snippet}
                          </div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </NetworkSection>
      )}
    </div>
  )
}

function NetworkSection({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
        {title} ({count})
      </div>
      {children}
    </section>
  )
}

function StringsPanel({ strings }: { strings: string[] }) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return strings
    return strings.filter((s) => s.toLowerCase().includes(needle))
  }, [strings, q])
  return (
    <div className="p-2">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Filter ${strings.length} strings…`}
        className="mb-2 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-purple-600 focus:outline-none"
      />
      <ul className="space-y-0.5">
        {filtered.map((s, i) => (
          <li
            key={i}
            className="truncate font-mono text-[11px] text-zinc-300"
            title={s}
          >
            {s}
          </li>
        ))}
      </ul>
    </div>
  )
}

// One side of the per-function chat thread. Roles match the LLM convention
// so the backend can forward them verbatim into the priorTurns array.
type ChatTurn = { role: 'user' | 'assistant'; content: string; meta?: { model: string; in: number; out: number } }

// localStorage persistence for LLM-paid panel state. We persist things the
// user spent tokens on (Ask threads, Crypto scripts, Chain narrations) so
// they survive page refresh — the in-memory state already survives tab
// switches via the SidePanel mount-once pattern. Keys are namespaced by
// projectId so each project has its own slot and a project delete doesn't
// require pruning.
//
// Failures (storage quota exceeded, security errors in sandboxed contexts,
// JSON parse errors from a hand-edited slot) all degrade silently to "no
// stored state" — chats still work in-memory.
const askStorageKey = (projectId: string) => `openbin.ask.${projectId}`
const cryptoStorageKey = (projectId: string) => `openbin.crypto.${projectId}`
const chainNarrationsKey = (projectId: string, rootName: string) =>
  `openbin.chainNarrations.${projectId}.${rootName}`

function loadAskThreads(projectId: string): Map<string, ChatTurn[]> {
  if (typeof window === 'undefined') return new Map()
  try {
    const raw = window.localStorage.getItem(askStorageKey(projectId))
    if (!raw) return new Map()
    const obj = JSON.parse(raw) as Record<string, ChatTurn[]>
    return new Map(Object.entries(obj))
  } catch {
    return new Map()
  }
}

function saveAskThreads(projectId: string, threads: Map<string, ChatTurn[]>) {
  if (typeof window === 'undefined') return
  try {
    const obj: Record<string, ChatTurn[]> = {}
    threads.forEach((v, k) => { obj[k] = v })
    if (Object.keys(obj).length === 0) {
      window.localStorage.removeItem(askStorageKey(projectId))
    } else {
      window.localStorage.setItem(askStorageKey(projectId), JSON.stringify(obj))
    }
  } catch {
    // localStorage may throw on quota exceeded — silently drop the write
    // rather than crashing the chat send path.
  }
}

// Generic JSON-record persistence used by Crypto results (function → script)
// and Chain narrations (function → narration string). Both keyed by project
// + an extra discriminator the caller computes (root name for chain).
function loadStringRecord<V>(key: string): Map<string, V> {
  if (typeof window === 'undefined') return new Map()
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return new Map()
    const obj = JSON.parse(raw) as Record<string, V>
    return new Map(Object.entries(obj))
  } catch {
    return new Map()
  }
}

function saveStringRecord<V>(key: string, m: Map<string, V>): void {
  if (typeof window === 'undefined') return
  try {
    const obj: Record<string, V> = {}
    m.forEach((v, k) => { obj[k] = v })
    if (Object.keys(obj).length === 0) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, JSON.stringify(obj))
    }
  } catch {
    // see saveAskThreads — silent drop on storage failure.
  }
}

function AskPanel({
  projectId,
  fn,
}: {
  projectId: string
  fn: BinaryFunction | null
}) {
  const api = useApi()
  const streamingApi = useStreamingApi()

  const [credentials, setCredentials] = useState<Credential[] | null>(null)
  const [credentialId, setCredentialId] = useState<string>('')

  // Threads per function name. Switching functions stashes the prior
  // function's thread, so coming back restores the conversation. Kept in a
  // ref because we mutate inside async stream callbacks and don't want each
  // chunk to invalidate the whole map.
  //
  // Initialized from localStorage so threads survive a page refresh — the
  // tokens spent generating them are real money and the user shouldn't
  // pay twice for the same conversation. Persistence keyed by projectId so
  // each project keeps its own conversation set.
  const threadsRef = useRef<Map<string, ChatTurn[]>>(loadAskThreads(projectId))
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [question, setQuestion] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const answerEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const creds = await api<Credential[]>('/api/credentials')
        if (cancelled) return
        setCredentials(creds)
        if (creds.length > 0) setCredentialId((prev) => prev || creds[0].id)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [api])

  // Cross-project navigation (/projects/A → /projects/B) re-renders this
  // component without remounting, so the useRef above is still pinned to
  // project A's data. Reload it whenever projectId changes so threads
  // from project B come back and we don't overwrite B's storage slot
  // with A's map.
  useEffect(() => {
    threadsRef.current = loadAskThreads(projectId)
  }, [projectId])

  // When the user selects a different function (or the project changes
  // and we just reloaded the ref above), swap the visible thread for that
  // function's stored thread. Errors are local to the previous attempt —
  // don't carry them over.
  useEffect(() => {
    if (!fn) {
      setTurns([])
      setError(null)
      return
    }
    setTurns(threadsRef.current.get(fn.name) ?? [])
    setError(null)
  }, [fn?.name, projectId])

  // Keep the threads ref in sync with the visible thread, and mirror to
  // localStorage so threads survive page refresh. Skip when turns is
  // empty — that's either the initial transient before the swap effect
  // above populates from storage, OR the post-clearThread state (which
  // has already handled its own save/delete). Persisting empty here
  // would race with the swap effect and blow away storage on every mount.
  useEffect(() => {
    if (!fn || turns.length === 0) return
    threadsRef.current.set(fn.name, turns)
    saveAskThreads(projectId, threadsRef.current)
  }, [turns, fn?.name, projectId])

  function clearThread() {
    if (!fn) return
    threadsRef.current.delete(fn.name)
    saveAskThreads(projectId, threadsRef.current)
    setTurns([])
    setError(null)
  }

  async function send() {
    if (!fn) return
    if (!credentialId) {
      setError('Pick an LLM credential first.')
      return
    }
    const trimmed = question.trim()
    if (!trimmed) return

    setError(null)
    setStreaming(true)

    // Snapshot what we send as priorTurns BEFORE we mutate state — replaying
    // the full thread the model has seen so far. Then optimistically append
    // the user's new turn + a placeholder assistant turn that we'll grow
    // with each chunk.
    const priorTurns = turns.map((t) => ({ role: t.role, content: t.content }))
    const userTurn: ChatTurn = { role: 'user', content: trimmed }
    const assistantTurn: ChatTurn = { role: 'assistant', content: '' }
    setTurns((prev) => [...prev, userTurn, assistantTurn])
    setQuestion('')

    await streamingApi(
      `/api/projects/${projectId}/ask-function/stream`,
      {
        functionName: fn.name,
        question: trimmed,
        credentialId,
        priorTurns,
      },
      {
        onChunk: (text) => {
          // Grow the last turn (the placeholder assistant message). Using the
          // functional form keeps us correct against React's batched renders.
          setTurns((prev) => {
            if (prev.length === 0) return prev
            const next = prev.slice()
            const last = next[next.length - 1]
            next[next.length - 1] = { ...last, content: last.content + text }
            return next
          })
          requestAnimationFrame(() => {
            answerEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
          })
        },
        onDone: (info) => {
          setTurns((prev) => {
            if (prev.length === 0) return prev
            const next = prev.slice()
            const last = next[next.length - 1]
            next[next.length - 1] = {
              ...last,
              meta: { model: info.model, in: info.inputTokens, out: info.outputTokens },
            }
            return next
          })
          setStreaming(false)
        },
        onError: (message) => {
          setError(message)
          setStreaming(false)
          // Drop the placeholder assistant message so a failed turn doesn't
          // pollute the next priorTurns payload.
          setTurns((prev) => {
            if (prev.length === 0 || prev[prev.length - 1].role !== 'assistant') return prev
            if (prev[prev.length - 1].content !== '') return prev
            return prev.slice(0, -1)
          })
        },
      },
    )
  }

  if (credentials === null) {
    return <EmptyState>Loading credentials…</EmptyState>
  }
  if (credentials.length === 0) {
    return (
      <div className="space-y-2 p-3 text-xs text-zinc-500">
        <p>No LLM credentials configured yet.</p>
        <Link
          to="/settings/api-keys"
          className="inline-block rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500"
        >
          Add a credential
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 p-3">
        <div className="min-w-0">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Asking about
          </div>
          {fn ? (
            <div className="truncate font-mono text-zinc-200" title={fn.name}>
              {fn.name}
            </div>
          ) : (
            <div className="text-zinc-500">
              Select a function from the list to ask about it.
            </div>
          )}
        </div>
        {turns.length > 0 && !streaming && (
          <button
            onClick={clearThread}
            title="Discard this thread and start over"
            className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800"
          >
            Clear
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {turns.length === 0 && !streaming && (
          <div className="text-[11px] text-zinc-600">
            Ask any question about this function — calling conventions,
            suspicious patterns, what an unfamiliar instruction sequence
            does, etc. The model gets the signature, decompiled C, and
            first ~500 disasm lines as context. Follow-ups stay in the
            thread until you click Clear.
          </div>
        )}
        {turns.map((t, i) => (
          <ChatTurnView key={i} turn={t} />
        ))}
        <div ref={answerEndRef} />
        {error && (
          <div className="mt-2 rounded border border-red-800 bg-red-950/40 px-2 py-1.5 text-red-300">
            {error}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-zinc-800 p-3">
        <select
          value={credentialId}
          onChange={(e) => setCredentialId(e.target.value)}
          className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-200"
        >
          {credentials.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} ({c.provider})
            </option>
          ))}
        </select>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder={
            fn
              ? turns.length > 0
                ? 'Follow-up… (⌘/Ctrl+Enter to send)'
                : `What does ${fn.name} actually do? (⌘/Ctrl+Enter to send)`
              : 'Select a function first…'
          }
          disabled={!fn || streaming}
          rows={3}
          className="w-full resize-none rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-zinc-200 placeholder:text-zinc-600 focus:border-purple-600 focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={() => void send()}
          disabled={!fn || !question.trim() || streaming}
          className="w-full rounded bg-purple-600 px-3 py-1.5 font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {streaming ? 'Streaming…' : turns.length > 0 ? 'Send follow-up' : 'Ask'}
        </button>
      </div>
    </div>
  )
}

function ChatTurnView({ turn }: { turn: ChatTurn }) {
  if (turn.role === 'user') {
    return (
      <div className="mb-3 rounded border border-zinc-800 bg-zinc-900/60 p-2">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">You</div>
        <div className="whitespace-pre-wrap font-mono text-[11px] text-zinc-300">{turn.content}</div>
      </div>
    )
  }
  return (
    <div className="mb-3">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-purple-300">Assistant</div>
      <div className="markdown-answer text-zinc-200">
        <ReactMarkdown>{turn.content || '…'}</ReactMarkdown>
      </div>
      {turn.meta && (
        <div className="mt-1 text-[10px] text-zinc-600">
          {turn.meta.model} · {turn.meta.in.toLocaleString()} in · {turn.meta.out.toLocaleString()} out
        </div>
      )}
    </div>
  )
}

function AIPanel({
  projectId,
  fnByName,
  onSelect,
}: {
  projectId: string
  fnByName: Map<string, BinaryFunction>
  onSelect: (name: string) => void
}) {
  const api = useApi()

  const [credentials, setCredentials] = useState<Credential[] | null>(null)
  const [credentialId, setCredentialId] = useState<string>('')
  const [mode, setMode] = useState<AnalysisMode>('MALWARE')

  const [result, setResult] = useState<AnalysisResponse | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pull the user's saved LLM credentials and any prior cached analysis the
  // first time this panel opens. Both calls are cheap and idempotent, so the
  // panel can be re-opened without spending tokens. /analysis returns 204
  // when nothing has run yet — useApi treats that as undefined.
  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      try {
        const [creds, cached] = await Promise.all([
          api<Credential[]>('/api/credentials'),
          api<AnalysisResponse | undefined>(`/api/projects/${projectId}/analysis`),
        ])
        if (cancelled) return
        setCredentials(creds)
        // Default to the first credential the user has if they haven't picked one yet.
        if (creds.length > 0) setCredentialId((prev) => prev || creds[0].id)
        if (cached) {
          setResult(cached)
          setMode(cached.mode)
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    }
    void bootstrap()
    return () => { cancelled = true }
  }, [api, projectId])

  async function run() {
    if (!credentialId) {
      setError('Pick an LLM credential first.')
      return
    }
    setRunning(true)
    setError(null)
    try {
      const resp = await api<AnalysisResponse>(`/api/projects/${projectId}/analyze`, {
        method: 'POST',
        body: JSON.stringify({ mode, credentialId }),
      })
      setResult(resp)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  if (credentials === null) {
    return <EmptyState>Loading credentials…</EmptyState>
  }
  if (credentials.length === 0) {
    return (
      <div className="space-y-2 p-3 text-xs text-zinc-500">
        <p>
          No LLM credentials configured yet. Credentials are shared with
          OpenAPK — the same key works in both products.
        </p>
        <Link
          to="/settings/api-keys"
          className="inline-block rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500"
        >
          Add a credential
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="space-y-2 rounded border border-zinc-800 bg-zinc-900/40 p-2">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
            Mode
          </span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as AnalysisMode)}
            className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-200"
          >
            <option value="MALWARE">Malware analysis</option>
            <option value="VULN_RESEARCH">Vulnerability research</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
            Credential
          </span>
          <select
            value={credentialId}
            onChange={(e) => setCredentialId(e.target.value)}
            className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-200"
          >
            {credentials.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.provider})
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => void run()}
          disabled={running || !credentialId}
          className="w-full rounded bg-purple-600 px-3 py-1.5 font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? 'Analyzing…' : result ? 'Re-run analysis' : 'Run analysis'}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-800 bg-red-950/40 px-2 py-1.5 text-red-300">
          {error}
        </div>
      )}

      {result && (
        <AnalysisResult result={result} fnByName={fnByName} onSelect={onSelect} />
      )}
    </div>
  )
}

function AnalysisResult({
  result,
  fnByName,
  onSelect,
}: {
  result: AnalysisResponse
  fnByName: Map<string, BinaryFunction>
  onSelect: (name: string) => void
}) {
  return (
    <div className="space-y-4">
      <section>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
          Summary · {result.model}
        </div>
        <p className="text-[11px] leading-relaxed text-zinc-200">{result.summary}</p>
      </section>

      {result.hotspots.length > 0 && (
        <section>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Hotspots ({result.hotspots.length})
          </div>
          <ul className="space-y-2">
            {result.hotspots.map((h, i) => (
              <li key={i} className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
                <div className="flex items-center justify-between gap-2">
                  {fnByName.has(h.path) ? (
                    <button
                      onClick={() => onSelect(h.path)}
                      className="truncate font-mono text-[11px] text-purple-300 hover:underline"
                      title={h.path}
                    >
                      {h.path}
                    </button>
                  ) : (
                    <span
                      className="truncate font-mono text-[11px] text-zinc-400"
                      title={`${h.path} (not in functions list)`}
                    >
                      {h.path}
                    </span>
                  )}
                  <SeverityChip severity={h.severity} />
                </div>
                <p className="mt-1 text-[11px] leading-snug text-zinc-300">{h.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.iocs.length > 0 && (
        <section>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            IoCs ({result.iocs.length})
          </div>
          <ul className="space-y-0.5">
            {result.iocs.slice(0, 30).map((ioc, i) => (
              <li
                key={i}
                className="flex items-baseline gap-2 text-[11px]"
                title={`${ioc.occurrences} occurrence${ioc.occurrences === 1 ? '' : 's'}`}
              >
                <span className="shrink-0 text-zinc-500">{ioc.type}</span>
                <span className="truncate font-mono text-zinc-300">{ioc.value}</span>
              </li>
            ))}
            {result.iocs.length > 30 && (
              <li className="text-[10px] text-zinc-600">
                + {result.iocs.length - 30} more
              </li>
            )}
          </ul>
        </section>
      )}

      {result.nextSteps.length > 0 && (
        <section>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            Next steps
          </div>
          <ul className="list-disc space-y-1 pl-4 text-[11px] leading-snug text-zinc-300">
            {result.nextSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="text-[10px] text-zinc-600">
        {result.inputTokens.toLocaleString()} in · {result.outputTokens.toLocaleString()} out tokens
      </div>
    </div>
  )
}

function SeverityChip({ severity }: { severity: string }) {
  const tone =
    severity === 'high'   ? 'bg-red-900/40 text-red-300'
  : severity === 'medium' ? 'bg-amber-900/40 text-amber-300'
                          : 'bg-zinc-800 text-zinc-400'
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}>
      {severity}
    </span>
  )
}

function ImportsPanel({ imports }: { imports: string[] }) {
  return (
    <ul className="p-2">
      {imports.map((n) => (
        <li key={n} className="truncate py-0.5 font-mono text-[11px] text-zinc-300" title={n}>
          {n}
        </li>
      ))}
    </ul>
  )
}

// Shared panel for entry points / exports / TLS callbacks. All three are
// "list of (name, address) pairs that navigate to a function". The `kind`
// only affects the empty-state copy and the accent color; the behavior
// is identical. Clicking a row calls onJump with kind='addr' so the
// dispatcher can resolve it to fn-by-addr or data-by-addr.
//
// Rows surface the resolved function name when the address maps to an
// extracted function — making it visible that Ghidra exports/entries/TLS
// callbacks ARE the underlying function records, not separate entities.
// When no function record exists at the address (because Ghidra didn't
// promote it), the row still jumps to disassembly via the address.
function AddressedListPanel({
  kind,
  items,
  lookups,
  emptyHint,
  onJump,
}: {
  kind: 'entry' | 'exports' | 'tls'
  items: AddressedSymbol[] | undefined
  lookups: SymbolLookups
  emptyHint: string
  onJump: (target: JumpTarget) => boolean
}) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    if (!items) return []
    const needle = q.trim().toLowerCase()
    if (!needle) return items
    return items.filter(
      (it) => it.name.toLowerCase().includes(needle) || it.address.toLowerCase().includes(needle),
    )
  }, [items, q])
  if (!items || items.length === 0) {
    return (
      <div className="p-3 text-[11px] text-zinc-500">{emptyHint}</div>
    )
  }
  const accent =
    kind === 'entry' ? 'text-emerald-300' :
    kind === 'exports' ? 'text-purple-300' :
    'text-amber-300'
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Filter ${items.length}…`}
        className="mb-2 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-purple-600 focus:outline-none"
      />
      <ul className="space-y-0.5">
        {filtered.map((it) => {
          const k = canonAddr(it.address)
          const resolvedFn = k ? lookups.fnByAddr.get(k) : undefined
          const displayName = it.name || (resolvedFn ? resolvedFn.name : '')
          // Show "→ realFnName" only when the export/entry/tls name
          // differs from the underlying function name (the user's #4
          // request: surface the Ghidra semantic that these labels live
          // ON a function, not next to one).
          const showResolved = resolvedFn && resolvedFn.name !== displayName
          return (
            <li key={it.address + it.name}>
              <button
                type="button"
                onClick={() => onJump({ kind: 'addr', value: it.address })}
                className="w-full rounded px-1.5 py-1 text-left font-mono text-[11px] hover:bg-zinc-900"
              >
                <div className={`truncate ${accent}`} title={displayName}>
                  {displayName || '(unnamed)'}
                </div>
                {showResolved && (
                  <div className="truncate text-cyan-400" title={resolvedFn.name}>
                    → {resolvedFn.name}
                  </div>
                )}
                <div className="truncate text-zinc-600">
                  {it.address}
                  {!resolvedFn && (
                    <span className="ml-1 text-zinc-700" title="No function record at this address — click still jumps via disassembly view">
                      · no fn
                    </span>
                  )}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// Data symbols panel. Lists every defined data location with its
// Ghidra-inferred type, and on click expands to a Ghidra-Listing-style
// detail strip showing the address, type, size, default value, raw
// bytes preview, and reference count. The expansion is inline (no
// modal) so the user can compare against the function they're reading
// without losing context.
//
// `selectedName` comes from outside (the user clicked DAT_xxx in code);
// when it changes, scroll + flash + auto-expand that row.
function DataSymbolsPanel({
  items,
  selectedName,
  onSelectData,
}: {
  items: DataSymbol[] | undefined
  selectedName: string | null
  onSelectData: (name: string | null) => void
}) {
  const [q, setQ] = useState('')
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map())
  const filtered = useMemo(() => {
    if (!items) return []
    const needle = q.trim().toLowerCase()
    if (!needle) return items
    return items.filter(
      (d) =>
        d.name.toLowerCase().includes(needle) ||
        d.address.toLowerCase().includes(needle) ||
        d.type.toLowerCase().includes(needle) ||
        (d.value ?? '').toLowerCase().includes(needle),
    )
  }, [items, q])
  useEffect(() => {
    if (!selectedName) return
    const el = rowRefs.current.get(selectedName)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('search-flash')
    const t = setTimeout(() => el.classList.remove('search-flash'), 1600)
    return () => clearTimeout(t)
  }, [selectedName])
  if (!items || items.length === 0) {
    return (
      <div className="p-3 text-[11px] text-zinc-500">
        No data symbols were extracted. Older projects (pre-v2 worker JSON)
        don't carry this field — re-decompile with the latest CLI to
        populate it.
      </div>
    )
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Filter ${items.length} data symbols…`}
        className="mb-2 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
      />
      <ul className="space-y-0.5">
        {filtered.map((d) => {
          const isSel = d.name === selectedName
          return (
            <li
              key={d.address + d.name}
              ref={(el) => {
                if (el) rowRefs.current.set(d.name, el)
                else rowRefs.current.delete(d.name)
              }}
              data-addr={d.address}
              className={`rounded px-1.5 py-1 font-mono text-[11px] hover:bg-zinc-900 ${isSel ? 'bg-amber-900/30 ring-1 ring-amber-700/40' : ''}`}
              onClick={() => onSelectData(isSel ? null : d.name)}
            >
              <div className="flex items-baseline gap-2">
                <span className="truncate text-amber-300" title={d.name}>{d.name}</span>
                {d.type && (
                  <span className="shrink-0 text-zinc-500" title={d.type}>{d.type}</span>
                )}
                {(d.ref_count ?? 0) > 0 && (
                  <span className="shrink-0 text-cyan-500" title="Number of references">
                    ×{d.ref_count}
                  </span>
                )}
              </div>
              <div className="truncate text-zinc-600">{d.address}</div>
              {isSel && <DataSymbolDetail d={d} />}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// Expanded detail for a selected data symbol — mimics the relevant rows
// of Ghidra's Listing view: address, type label, size, default value
// representation, and a raw-byte hex preview when available. Read-only
// today; future work could let the user edit the type or rename inline.
function DataSymbolDetail({ d }: { d: DataSymbol }) {
  return (
    <div className="mt-1 rounded border border-zinc-800 bg-zinc-950/60 p-2 text-[10px]">
      <DetailRow label="address" value={d.address} mono />
      {d.type && <DetailRow label="type" value={d.type} mono />}
      {(d.size ?? 0) > 0 && <DetailRow label="size" value={`${d.size} bytes`} />}
      {d.value && (
        <DetailRow label="value" value={d.value} mono valueClass="text-emerald-300 break-all" />
      )}
      {d.bytes_preview && (
        <DetailRow
          label="bytes"
          value={d.bytes_preview}
          mono
          valueClass="text-zinc-400 break-all"
        />
      )}
      {(d.ref_count ?? 0) > 0 && <DetailRow label="refs" value={String(d.ref_count)} />}
    </div>
  )
}

function DetailRow({
  label,
  value,
  mono,
  valueClass,
}: {
  label: string
  value: string
  mono?: boolean
  valueClass?: string
}) {
  return (
    <div className="flex gap-2 py-0.5">
      <span className="w-14 shrink-0 text-zinc-600">{label}</span>
      <span className={`min-w-0 flex-1 ${mono ? 'font-mono' : ''} ${valueClass ?? 'text-zinc-300'}`}>
        {value}
      </span>
    </div>
  )
}

// Memory map / sections panel. Renders one row per loader-mapped block
// with its permission triple. Read-only today — clicking a row could
// later filter the function/data lists to that range, but the immediate
// value is just letting the user see whether 0x1405ec170 is in .text
// vs a packed/overlay section.
function SectionsPanel({ blocks }: { blocks: MemoryBlock[] | undefined }) {
  if (!blocks || blocks.length === 0) {
    return (
      <div className="p-3 text-[11px] text-zinc-500">
        No memory blocks were extracted. Older projects (pre-v2 worker JSON)
        don't carry this field — re-decompile with the latest CLI to
        populate it.
      </div>
    )
  }
  return (
    <div className="p-2">
      <ul className="space-y-1">
        {blocks.map((b) => (
          <li key={b.start + b.name} className="rounded border border-zinc-800 bg-zinc-900/40 p-2 font-mono text-[11px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-semibold text-zinc-200" title={b.name}>{b.name}</span>
              <span className={`shrink-0 ${b.executable ? 'text-emerald-300' : 'text-zinc-500'}`}>
                {b.permissions}
              </span>
            </div>
            <div className="mt-0.5 text-zinc-500">
              {b.start} – {b.end}
              {b.size > 0 && <span className="ml-2 text-zinc-600">{b.size.toLocaleString()} B</span>}
              {!b.initialized && <span className="ml-2 text-zinc-600">uninitialized</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-zinc-400">
      <div className="text-center">{children}</div>
    </div>
  )
}
