import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApi } from '@shared/api/client'
import { SCRIPT_PATHS, type ScriptFinding, type ScriptFindingsResponse, type Severity } from '@shared/api/scripts'
import { SEVERITY_ORDER } from '@shared/api/scripts'
import { extractTarGz, buildTree, type FileNode, type TarEntry } from '../syntax/untar'
import { highlightScript } from '../syntax/highlight'
import { ScriptFindings } from '../components/ScriptFindings'
import { ReportEditor } from './Report'

const ORIGINAL_PREFIX = 'original/'
const DEOBF_PREFIX = 'deobfuscated/'

type BundleState = {
  tree: FileNode
  // Path → bytes for files under original/. Keyed by the post-prefix path.
  files: Map<string, Uint8Array>
  // Subset of paths that also have a deobfuscated/ counterpart.
  deobfPaths: Set<string>
  // Path → bytes for files under deobfuscated/.
  deobfFiles: Map<string, Uint8Array>
}

/**
 * SCRIPT-kind ProjectView. Three columns:
 *   1. File tree from the deobfuscated bundle (original/ side).
 *   2. Code viewer with line numbers + jump-to-line when navigated from
 *      a finding. Toggles between original and deobfuscated when a deobf
 *      counterpart exists.
 *   3. Findings (collapsible by severity) + Report editor.
 *
 * The bundle download happens once on mount via a short-TTL CloudFront
 * signed URL; everything else is in-memory.
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

  // Findings + bundle in parallel.
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

  // Default-select something useful once both loads finish.
  useEffect(() => {
    if (selectedPath || !bundle) return
    const firstFinding = findings?.findings.find((f) => f.file && f.file !== 'package.json')
    if (firstFinding && bundle.files.has(firstFinding.file)) {
      setSelectedPath(firstFinding.file)
      setPendingLine(firstFinding.line || null)
      return
    }
    // Otherwise jump to package.json if it's in the bundle, else first file.
    if (bundle.files.has('package.json')) {
      setSelectedPath('package.json')
      return
    }
    const first = findFirstFile(bundle.tree)
    if (first) setSelectedPath(first)
  }, [bundle, findings, selectedPath])

  // Reset source-mode toggle when switching files.
  useEffect(() => {
    setSourceMode('original')
  }, [selectedPath])

  const onJump = (f: ScriptFinding) => {
    if (!f.file || !bundle?.files.has(f.file)) return
    setSelectedPath(f.file)
    setPendingLine(f.line || null)
  }

  const hasDeobf = selectedPath ? bundle?.deobfPaths.has(selectedPath) ?? false : false

  return (
    <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-3 px-4 py-4">
      <header className="flex items-center justify-between border-b border-zinc-800 pb-2">
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
        </div>
      </header>

      {error && (
        <div className="rounded border border-red-900/60 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[260px_1fr_400px]">
        {/* Tree */}
        <div className="min-h-0 overflow-auto rounded-lg border border-zinc-800 bg-zinc-900/40">
          <div className="border-b border-zinc-800 px-3 py-2 text-xs uppercase tracking-wide text-zinc-400">
            Files {bundle && `· ${countFiles(bundle.tree)}`}
          </div>
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
            <p className="px-3 py-2 text-sm text-zinc-500">No bundle available.</p>
          )}
        </div>

        {/* Code viewer */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
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
          <div className="min-h-0 flex-1 overflow-auto">
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

        {/* Findings + Report */}
        <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
            <div className="border-b border-zinc-800 px-3 py-2 text-xs uppercase tracking-wide text-zinc-400">
              Findings
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {loadingFindings && <p className="text-sm text-zinc-500">Loading findings…</p>}
              {findings && <ScriptFindings data={findings} onJump={onJump} />}
            </div>
          </div>
          <div className="flex min-h-0 max-h-[40vh] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
            <div className="border-b border-zinc-800 px-3 py-2 text-xs uppercase tracking-wide text-zinc-400">
              Report
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              <ReportEditor projectId={id} compact />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------

function buildBundle(entries: TarEntry[]): BundleState {
  const originals = entries.filter((e) => e.type === 'file' && e.name.startsWith(ORIGINAL_PREFIX))
  const deobfs = entries.filter((e) => e.type === 'file' && e.name.startsWith(DEOBF_PREFIX))
  const files = new Map<string, Uint8Array>()
  for (const e of originals) {
    const p = e.name.slice(ORIGINAL_PREFIX.length)
    files.set(p, e.bytes)
  }
  const deobfFiles = new Map<string, Uint8Array>()
  for (const e of deobfs) {
    const p = e.name.slice(DEOBF_PREFIX.length)
    deobfFiles.set(p, e.bytes)
  }
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
  // Root acts as a transparent wrapper.
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

  const text = useMemo(() => {
    if (!bytes) return ''
    return new TextDecoder('utf-8').decode(bytes)
  }, [bytes])

  // 4 MB single-line droppers will tank Shiki — render plain text past a
  // size threshold and add a banner explaining why.
  const tooBigForShiki = text.length > 256 * 1024

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      const out = tooBigForShiki
        ? escapeHtml(text)
        : await highlightScript(text, filename)
      if (!cancelled) {
        setHtml(out)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [text, filename, tooBigForShiki])

  // After render, jump to the requested line. requestAnimationFrame so
  // we wait for the DOM to commit the new HTML.
  useEffect(() => {
    if (!jumpToLine || loading) return
    requestAnimationFrame(() => {
      const el = containerRef.current?.querySelector(`[data-line="${jumpToLine}"]`)
      if (el && 'scrollIntoView' in el) {
        (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    })
  }, [jumpToLine, html, loading])

  if (!bytes) return <p className="p-4 text-sm text-zinc-500">File not in bundle.</p>

  // Manual line-numbering + finding markers. We render the highlighted
  // HTML as one block per line so we can pin a marker in the gutter.
  const lines = useMemo(() => splitShikiLines(html, text), [html, text])

  return (
    <div ref={containerRef} className="relative font-mono text-[12.5px] leading-[1.6]">
      {tooBigForShiki && (
        <div className="sticky top-0 z-10 border-b border-amber-800/60 bg-amber-950/80 px-3 py-1.5 text-[11px] text-amber-200">
          File is {(text.length / 1024 / 1024).toFixed(1)} MB — rendered as plain text (Shiki disabled past 256 KB).
        </div>
      )}
      {loading && <p className="p-4 text-sm text-zinc-500">Highlighting…</p>}
      {!loading && lines.map((line, i) => {
        const lineNo = i + 1
        const hits = highlights.get(lineNo)
        const sev = hits ? topSeverity(hits) : null
        return (
          <div
            key={lineNo}
            data-line={lineNo}
            className={`flex items-start ${sev ? severityBg(sev) : ''}`}
          >
            <span className="sticky left-0 inline-block w-12 shrink-0 select-none bg-zinc-900/60 pr-2 text-right text-[11px] text-zinc-500">
              {lineNo}
            </span>
            {sev && (
              <span
                className={`inline-block w-2 shrink-0 ${severityDot(sev)}`}
                title={hits!.map((h) => `${h.rule}: ${h.message}`).join('\n')}
              />
            )}
            <span
              className="flex-1 whitespace-pre overflow-x-auto pr-3"
              dangerouslySetInnerHTML={{ __html: line }}
            />
          </div>
        )
      })}
    </div>
  )
}

function topSeverity(hits: ScriptFinding[]): Severity {
  // SEVERITY_ORDER is CRITICAL → HIGH → MEDIUM → INFO; pick the most severe.
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

// Shiki returns <pre><code><span class="line">...</span><span class="line">...</span></code></pre>.
// To pin per-line gutter markers we need an array of innerHTMLs for each
// line. Falls back to splitting the raw text when Shiki was skipped.
function splitShikiLines(shikiHtml: string, plain: string): string[] {
  // Detect Shiki output by the wrapping <pre> + <span class="line">.
  if (!shikiHtml.includes('class="line"')) {
    return escapeHtml(plain).split('\n').map((l) => l || '&nbsp;')
  }
  const lines: string[] = []
  const re = /<span class="line">([\s\S]*?)<\/span>(?:\n)?/g
  let m
  while ((m = re.exec(shikiHtml))) {
    lines.push(m[1] || '&nbsp;')
  }
  return lines.length > 0 ? lines : [escapeHtml(plain)]
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
