import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApi } from '@shared/api/client'
import { SCRIPT_PATHS, type ScriptFinding, type ScriptFindingsResponse, type Severity } from '@shared/api/scripts'
import { SEVERITY_ORDER } from '@shared/api/scripts'
import { extractTarGz, buildTree, type FileNode, type TarEntry } from '../syntax/untar'
import { highlightScript } from '../syntax/highlight'
import { ScriptFindings } from '../components/ScriptFindings'
import { AskAiPanel } from '../components/AskAiPanel'
import { ReportEditor } from './Report'

const ORIGINAL_PREFIX = 'original/'
const DEOBF_PREFIX = 'deobfuscated/'

// localStorage keys for layout persistence — namespaced under
// openbin.script so they don't collide with the BIN view's keys.
const LS_LEFT_OPEN = 'openbin.script.leftOpen'
const LS_RIGHT_WIDTH = 'openbin.script.rightWidth'
const LS_FINDINGS_RATIO = 'openbin.script.findingsRatio'
const LS_BOTTOM_TAB = 'openbin.script.bottomTab'

type BottomTab = 'report' | 'ask'

const LEFT_WIDTH = 260
const RIGHT_WIDTH_DEFAULT = 420
const RIGHT_WIDTH_MIN = 320
const RIGHT_WIDTH_MAX = 800
const FINDINGS_RATIO_DEFAULT = 0.55  // findings takes 55% of the right column by default
const FINDINGS_RATIO_MIN = 0.15
const FINDINGS_RATIO_MAX = 0.85

type BundleState = {
  tree: FileNode
  files: Map<string, Uint8Array>
  deobfPaths: Set<string>
  deobfFiles: Map<string, Uint8Array>
}

/**
 * SCRIPT-kind ProjectView. Edge-to-edge three-pane workspace:
 *
 *   [collapsible tree] | [code, flex-1] | [findings | report, drag-split]
 *
 * The right column has a drag handle on its left edge for horizontal
 * resize, and an internal drag handle for the vertical findings/report
 * split. Both persist to localStorage.
 *
 * Code viewer uses a single outer scrollbar with sticky line-number +
 * gutter columns — no per-line scrollbars (that was the old version's
 * cardinal UX sin).
 */
export function ScriptProjectView() {
  const { id = '' } = useParams<{ id: string }>()
  const api = useApi()
  const [findings, setFindings] = useState<ScriptFindingsResponse | null>(null)
  const [bundle, setBundle] = useState<BundleState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingFindings, setLoadingFindings] = useState(true)
  const [loadingBundle, setLoadingBundle] = useState(true)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [sourceMode, setSourceMode] = useState<'original' | 'deobfuscated'>('original')
  const [pendingLine, setPendingLine] = useState<number | null>(null)

  // Layout state — all persisted.
  const [leftOpen, setLeftOpen] = useState<boolean>(() => readBool(LS_LEFT_OPEN, true))
  const [rightWidth, setRightWidth] = useState<number>(() =>
    clamp(readNum(LS_RIGHT_WIDTH, RIGHT_WIDTH_DEFAULT), RIGHT_WIDTH_MIN, RIGHT_WIDTH_MAX),
  )
  const [findingsRatio, setFindingsRatio] = useState<number>(() =>
    clamp(readNum(LS_FINDINGS_RATIO, FINDINGS_RATIO_DEFAULT), FINDINGS_RATIO_MIN, FINDINGS_RATIO_MAX),
  )
  const [bottomTab, setBottomTab] = useState<BottomTab>(() =>
    (window.localStorage.getItem(LS_BOTTOM_TAB) as BottomTab) || 'ask',
  )

  useEffect(() => { localStorage.setItem(LS_LEFT_OPEN, leftOpen ? '1' : '0') }, [leftOpen])
  useEffect(() => { localStorage.setItem(LS_RIGHT_WIDTH, String(rightWidth)) }, [rightWidth])
  useEffect(() => { localStorage.setItem(LS_FINDINGS_RATIO, String(findingsRatio)) }, [findingsRatio])
  useEffect(() => { localStorage.setItem(LS_BOTTOM_TAB, bottomTab) }, [bottomTab])

  // Data load.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await api<ScriptFindingsResponse>(SCRIPT_PATHS.findings(id))
        if (!cancelled) setFindings(data)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoadingFindings(false)
      }
    })()
    void (async () => {
      try {
        const { url } = await api<{ url: string }>(SCRIPT_PATHS.bundleUrl(id))
        const entries = await extractTarGz(url)
        if (cancelled) return
        setBundle(buildBundle(entries))
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoadingBundle(false)
      }
    })()
    return () => { cancelled = true }
  }, [api, id])

  useEffect(() => {
    if (selectedPath || !bundle) return
    const firstFinding = findings?.findings.find((f) => f.file && f.file !== 'package.json')
    if (firstFinding && bundle.files.has(firstFinding.file)) {
      setSelectedPath(firstFinding.file)
      setPendingLine(firstFinding.line || null)
      return
    }
    if (bundle.files.has('package.json')) {
      setSelectedPath('package.json')
      return
    }
    const first = findFirstFile(bundle.tree)
    if (first) setSelectedPath(first)
  }, [bundle, findings, selectedPath])

  useEffect(() => { setSourceMode('original') }, [selectedPath])

  const onJump = (f: ScriptFinding) => {
    if (!f.file || !bundle?.files.has(f.file)) return
    setSelectedPath(f.file)
    setPendingLine(f.line || null)
  }

  const hasDeobf = selectedPath ? bundle?.deobfPaths.has(selectedPath) ?? false : false

  // Horizontal resize of the right column. Handle sits on the LEFT edge of
  // the right column; dragging leftward widens it.
  const startResizeRight = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = rightWidth
    const onMove = (ev: MouseEvent) => {
      const dx = startX - ev.clientX
      setRightWidth(clamp(startW + dx, RIGHT_WIDTH_MIN, RIGHT_WIDTH_MAX))
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

  // Vertical drag for the findings/report split. Handle is the bar between
  // them; ratio is findings-height / total-right-column-height. We compute
  // off the actual measured column height so the drag tracks the cursor.
  const rightColRef = useRef<HTMLDivElement | null>(null)
  const startResizeFindings = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const colEl = rightColRef.current
    if (!colEl) return
    const colRect = colEl.getBoundingClientRect()
    const onMove = (ev: MouseEvent) => {
      const rel = (ev.clientY - colRect.top) / colRect.height
      setFindingsRatio(clamp(rel, FINDINGS_RATIO_MIN, FINDINGS_RATIO_MAX))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [])

  return (
    <div className="flex h-full flex-col px-2 py-2">
      <header className="flex items-center justify-between border-b border-zinc-800 px-1 pb-2">
        <div className="flex items-center gap-3">
          <Link to="/projects" className="text-sm text-zinc-400 hover:text-zinc-100">
            ← Projects
          </Link>
          <h1 className="text-lg font-semibold text-zinc-100">
            {findings?.summary?.package?.name || 'Script analysis'}
            {findings?.summary?.package?.version && (
              <span className="ml-1 text-zinc-500">@{findings.summary.package.version}</span>
            )}
          </h1>
          {findings && <EcosystemBadge ecosystem={findings.summary?.ecosystem} />}
          {findings && (
            <SummaryPills counts={findings.summary?.countsBySeverity || {}} />
          )}
        </div>
      </header>

      {error && (
        <div className="mx-1 mt-2 rounded border border-red-900/60 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mt-2 flex min-h-0 flex-1 gap-2">
        {/* Left tree (collapsible) */}
        {leftOpen ? (
          <div
            style={{ width: `${LEFT_WIDTH}px` }}
            className="flex shrink-0 flex-col overflow-hidden rounded border border-zinc-800 bg-zinc-900/40"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-2 py-1.5 text-xs uppercase tracking-wide text-zinc-400">
              <span>Files {bundle && `· ${countFiles(bundle.tree)}`}</span>
              <button
                onClick={() => setLeftOpen(false)}
                title="Collapse file tree"
                className="rounded px-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              >
                ‹
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {loadingBundle ? (
                <p className="px-3 py-2 text-sm text-zinc-500">Loading bundle…</p>
              ) : bundle ? (
                <FileTreeView
                  node={bundle.tree}
                  selectedPath={selectedPath}
                  onSelect={(p) => { setSelectedPath(p); setPendingLine(null) }}
                  deobfPaths={bundle.deobfPaths}
                />
              ) : (
                <p className="px-3 py-2 text-sm text-zinc-500">No bundle.</p>
              )}
            </div>
          </div>
        ) : (
          <button
            onClick={() => setLeftOpen(true)}
            title="Show file tree"
            className="flex shrink-0 items-center rounded border border-zinc-800 bg-zinc-900/40 px-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            ›
          </button>
        )}

        {/* Code viewer (flex-1) */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded border border-zinc-800 bg-zinc-900/40">
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
            <span className="truncate font-mono text-xs text-zinc-300">
              {selectedPath || '(select a file)'}
            </span>
            {hasDeobf && (
              <div className="flex gap-1 text-[11px]">
                <button
                  onClick={() => setSourceMode('original')}
                  className={`rounded px-2 py-0.5 ${sourceMode === 'original' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
                >Original</button>
                <button
                  onClick={() => setSourceMode('deobfuscated')}
                  className={`rounded px-2 py-0.5 ${sourceMode === 'deobfuscated' ? 'bg-purple-900/60 text-purple-200' : 'text-purple-400 hover:text-purple-200'}`}
                >Deobfuscated</button>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {selectedPath && bundle ? (
              <CodePane
                key={`${selectedPath}:${sourceMode}`}
                bytes={(sourceMode === 'deobfuscated' ? bundle.deobfFiles : bundle.files).get(selectedPath)}
                filename={selectedPath}
                jumpToLine={pendingLine}
                highlights={findingsForFile(findings, selectedPath)}
              />
            ) : (
              <p className="p-4 text-sm text-zinc-500">Pick a file from the tree to view its source.</p>
            )}
          </div>
        </div>

        {/* Right column: drag handle + findings (top) + drag split + report (bottom) */}
        <div
          onMouseDown={startResizeRight}
          title="Drag to resize"
          className="w-1 shrink-0 cursor-col-resize bg-zinc-800/60 hover:bg-purple-600/60"
        />
        <div
          ref={rightColRef}
          style={{ width: `${rightWidth}px` }}
          className="flex shrink-0 flex-col gap-1 overflow-hidden"
        >
          <div
            style={{ flex: `${findingsRatio * 100} 0 0` }}
            className="flex min-h-0 flex-col overflow-hidden rounded border border-zinc-800 bg-zinc-900/40"
          >
            <div className="border-b border-zinc-800 px-3 py-1.5 text-xs uppercase tracking-wide text-zinc-400">
              Findings
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {loadingFindings && <p className="text-sm text-zinc-500">Loading findings…</p>}
              {findings && <ScriptFindings data={findings} onJump={onJump} />}
            </div>
          </div>
          {/* Vertical drag handle between findings and report */}
          <div
            onMouseDown={startResizeFindings}
            title="Drag to resize"
            className="h-1 shrink-0 cursor-row-resize bg-zinc-800/60 hover:bg-purple-600/60"
          />
          <div
            style={{ flex: `${(1 - findingsRatio) * 100} 0 0` }}
            className="flex min-h-0 flex-col overflow-hidden rounded border border-zinc-800 bg-zinc-900/40"
          >
            <div className="flex items-center gap-1 border-b border-zinc-800 px-2 py-1 text-xs">
              <TabBtn active={bottomTab === 'ask'} onClick={() => setBottomTab('ask')}>Ask AI</TabBtn>
              <TabBtn active={bottomTab === 'report'} onClick={() => setBottomTab('report')}>Report</TabBtn>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {bottomTab === 'ask' ? (
                <AskAiPanel
                  projectId={id}
                  filePath={selectedPath}
                  fileBytes={selectedPath
                    ? (sourceMode === 'deobfuscated' ? bundle?.deobfFiles : bundle?.files)?.get(selectedPath)
                    : undefined}
                  sourceMode={sourceMode}
                />
              ) : (
                <div className="h-full overflow-auto p-2">
                  <ReportEditor projectId={id} compact />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-0.5 transition ${
        active ? 'bg-purple-900/50 text-purple-100' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  )
}

function EcosystemBadge({ ecosystem }: { ecosystem?: 'npm' | 'pypi' }) {
  // Older findings (pre-JS-2) have no ecosystem field — they were always
  // npm so we render the npm chip when undefined.
  const eco = ecosystem ?? 'npm'
  const style = eco === 'pypi'
    ? 'border-sky-700/60 bg-sky-950/40 text-sky-200'
    : 'border-emerald-700/60 bg-emerald-950/40 text-emerald-200'
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${style}`}>
      {eco}
    </span>
  )
}

function SummaryPills({ counts }: { counts: Partial<Record<Severity, number>> }) {
  return (
    <div className="flex items-center gap-1.5">
      {SEVERITY_ORDER.map((s) => {
        const n = counts[s] ?? 0
        if (n === 0) return null
        return (
          <span key={s} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${pillStyle(s)}`}>
            {s} {n}
          </span>
        )
      })}
    </div>
  )
}

function pillStyle(s: Severity): string {
  return {
    CRITICAL: 'bg-red-950/60 text-red-200 border-red-800/60',
    HIGH: 'bg-amber-950/60 text-amber-200 border-amber-800/60',
    MEDIUM: 'bg-yellow-950/60 text-yellow-200 border-yellow-800/60',
    INFO: 'bg-zinc-800/70 text-zinc-300 border-zinc-700',
  }[s]
}

function buildBundle(entries: TarEntry[]): BundleState {
  const originals = entries.filter((e) => e.type === 'file' && e.name.startsWith(ORIGINAL_PREFIX))
  const deobfs = entries.filter((e) => e.type === 'file' && e.name.startsWith(DEOBF_PREFIX))
  const files = new Map<string, Uint8Array>()
  for (const e of originals) files.set(e.name.slice(ORIGINAL_PREFIX.length), e.bytes)
  const deobfFiles = new Map<string, Uint8Array>()
  for (const e of deobfs) deobfFiles.set(e.name.slice(DEOBF_PREFIX.length), e.bytes)
  const tree = buildTree(originals, ORIGINAL_PREFIX)
  return { tree, files, deobfPaths: new Set(deobfFiles.keys()), deobfFiles }
}

function findFirstFile(node: FileNode): string | null {
  if (node.kind === 'file') return node.path
  for (const c of node.children || []) {
    const found = findFirstFile(c)
    if (found) return found
  }
  return null
}

function countFiles(node: FileNode): number {
  if (node.kind === 'file') return 1
  return (node.children || []).reduce((n, c) => n + countFiles(c), 0)
}

function findingsForFile(
  findings: ScriptFindingsResponse | null,
  path: string,
): Map<number, ScriptFinding[]> {
  const m = new Map<number, ScriptFinding[]>()
  if (!findings) return m
  for (const f of findings.findings) {
    if (f.file !== path || !f.line) continue
    const arr = m.get(f.line) || []
    arr.push(f)
    m.set(f.line, arr)
  }
  return m
}

function readBool(k: string, def: boolean): boolean {
  if (typeof window === 'undefined') return def
  const v = window.localStorage.getItem(k)
  return v === null ? def : v === '1'
}
function readNum(k: string, def: number): number {
  if (typeof window === 'undefined') return def
  const v = window.localStorage.getItem(k)
  const n = v == null ? NaN : Number(v)
  return Number.isFinite(n) ? n : def
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

// -----------------------------------------------------------------------

function FileTreeView({
  node,
  selectedPath,
  onSelect,
  deobfPaths,
  depth = 0,
}: {
  node: FileNode
  selectedPath: string | null
  onSelect: (path: string) => void
  deobfPaths: Set<string>
  depth?: number
}) {
  if (depth === 0) {
    return (
      <div className="py-1 text-sm">
        {(node.children || []).map((c) => (
          <FileTreeView
            key={c.path}
            node={c}
            selectedPath={selectedPath}
            onSelect={onSelect}
            deobfPaths={deobfPaths}
            depth={1}
          />
        ))}
      </div>
    )
  }
  const [open, setOpen] = useState(depth <= 2)
  const isSel = node.kind === 'file' && selectedPath === node.path
  const indent = { paddingLeft: `${depth * 0.75}rem` }
  if (node.kind === 'dir') {
    return (
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          style={indent}
          className="flex w-full items-center gap-1 truncate py-0.5 pr-2 text-left text-zinc-300 hover:bg-zinc-800/60"
        >
          <span className="text-zinc-500">{open ? '▾' : '▸'}</span>
          <span className="truncate">{node.name}/</span>
        </button>
        {open && (node.children || []).map((c) => (
          <FileTreeView
            key={c.path}
            node={c}
            selectedPath={selectedPath}
            onSelect={onSelect}
            deobfPaths={deobfPaths}
            depth={depth + 1}
          />
        ))}
      </div>
    )
  }
  return (
    <button
      onClick={() => onSelect(node.path)}
      style={indent}
      className={`flex w-full items-center gap-1.5 truncate py-0.5 pr-2 text-left ${
        isSel ? 'bg-purple-900/40 text-purple-100' : 'text-zinc-200 hover:bg-zinc-800/60'
      }`}
      title={node.path}
    >
      <span className="shrink-0 text-zinc-500">·</span>
      <span className="truncate font-mono text-[12px]">{node.name}</span>
      {deobfPaths.has(node.path) && (
        <span className="ml-auto rounded bg-purple-900/60 px-1 text-[9px] text-purple-200" title="Deobfuscated version available">d</span>
      )}
    </button>
  )
}

// -----------------------------------------------------------------------
// Code pane: ONE outer scrollbar covers both axes. Line numbers + gutter
// markers are sticky-positioned on the left edge so they stay visible
// during horizontal scroll. No per-line scrollbars (the old version's
// `overflow-x-auto` on every line was the issue).

function CodePane({
  bytes,
  filename,
  jumpToLine,
  highlights,
}: {
  bytes: Uint8Array | undefined
  filename: string
  jumpToLine: number | null
  highlights: Map<number, ScriptFinding[]>
}) {
  const [html, setHtml] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const text = useMemo(() => bytes ? new TextDecoder('utf-8').decode(bytes) : '', [bytes])
  const tooBigForShiki = text.length > 256 * 1024

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      const out = tooBigForShiki ? escapeHtml(text) : await highlightScript(text, filename)
      if (!cancelled) {
        setHtml(out)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [text, filename, tooBigForShiki])

  useEffect(() => {
    if (!jumpToLine || loading) return
    requestAnimationFrame(() => {
      const el = containerRef.current?.querySelector(`[data-line="${jumpToLine}"]`)
      if (el && 'scrollIntoView' in el) {
        (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    })
  }, [jumpToLine, html, loading])

  const lines = useMemo(() => splitShikiLines(html, text), [html, text])

  if (!bytes) return <p className="p-4 text-sm text-zinc-500">File not in bundle.</p>

  return (
    <div ref={containerRef} className="relative h-full overflow-auto">
      {tooBigForShiki && (
        <div className="sticky top-0 z-20 border-b border-amber-800/60 bg-amber-950/80 px-3 py-1.5 text-[11px] text-amber-200">
          File is {(text.length / 1024 / 1024).toFixed(1)} MB — rendered as plain text (Shiki disabled past 256 KB).
        </div>
      )}
      {loading && <p className="p-4 text-sm text-zinc-500">Highlighting…</p>}
      {!loading && (
        // min-w-max grows the inner block to the widest line so the SINGLE
        // outer scrollbar (above) handles horizontal scroll. Sticky line
        // numbers stay pinned on the left as the content scrolls past.
        <div className="min-w-max font-mono text-[12.5px] leading-[1.6]">
          {lines.map((line, i) => {
            const lineNo = i + 1
            const hits = highlights.get(lineNo)
            const sev = hits ? topSeverity(hits) : null
            return (
              <div
                key={lineNo}
                data-line={lineNo}
                className={`flex ${sev ? severityBg(sev) : ''}`}
              >
                <span className="sticky left-0 z-10 inline-block w-12 shrink-0 select-none bg-zinc-900/95 pr-2 text-right text-[11px] text-zinc-500">
                  {lineNo}
                </span>
                <span
                  className={`sticky left-12 z-10 inline-block w-1.5 shrink-0 ${sev ? severityDot(sev) : 'bg-transparent'}`}
                  title={hits ? hits.map((h) => `${h.rule}: ${h.message}`).join('\n') : undefined}
                />
                <span
                  className="whitespace-pre px-3"
                  dangerouslySetInnerHTML={{ __html: line }}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function topSeverity(hits: ScriptFinding[]): Severity {
  for (const s of SEVERITY_ORDER) {
    if (hits.some((h) => h.severity === s)) return s
  }
  return 'INFO'
}

function severityBg(s: Severity): string {
  return {
    CRITICAL: 'bg-red-950/30',
    HIGH: 'bg-amber-950/25',
    MEDIUM: 'bg-yellow-950/20',
    INFO: 'bg-zinc-800/20',
  }[s]
}

function severityDot(s: Severity): string {
  return {
    CRITICAL: 'bg-red-500',
    HIGH: 'bg-amber-500',
    MEDIUM: 'bg-yellow-500',
    INFO: 'bg-zinc-500',
  }[s]
}

function splitShikiLines(shikiHtml: string, plain: string): string[] {
  if (!shikiHtml.includes('class="line"')) {
    return escapeHtml(plain).split('\n').map((l) => l || '&nbsp;')
  }
  // Shiki's <span class="line"> contains nested syntax-color <span>s, so a
  // naïve non-greedy regex stops at the first inner </span> and yields just
  // the first token of each line. Use the browser's HTML parser instead —
  // it tracks nested tags correctly without us writing a scanner.
  const wrapper = document.createElement('div')
  wrapper.innerHTML = shikiHtml
  const lineEls = wrapper.querySelectorAll('.line')
  if (lineEls.length === 0) return [escapeHtml(plain)]
  return Array.from(lineEls).map((el) => el.innerHTML || '&nbsp;')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
