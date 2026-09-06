import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApi } from '../api/client'
import { canEdit, isOwner, type ProjectRole } from '@shared/api/collaborators'
import { ShareProjectModal } from '@shared/components/ShareProjectModal'
import { MembersBar } from '@shared/components/MembersBar'
import { ProjectVisibilityToggle } from '@shared/components/ProjectVisibilityToggle'
import { ProjectRoleProvider, useCanEdit } from '@shared/components/ProjectRoleContext'
import { HighlightsPanel } from '@shared/components/HighlightsPanel'
import { AddHighlightModal } from '@shared/components/AddHighlightModal'
import { mediaKeyFromUrl } from '@shared/api/highlights'
import { useCredentialModels } from '@shared/components/ModelSelect'
import { AuthenticatedImg } from '../components/AuthenticatedImg'
import { AskPanel } from '../components/AskPanel'
import { estimateCost } from '../lib/llmCost'
import { detectLang, highlight } from '../syntax/highlight'
import { ReportEditor } from './Report'
import { Crypto } from '../components/Crypto'
import { Gallery } from '../components/Gallery'
import { Renames } from '../components/Renames'
import { ScreenshotModal } from '../components/ScreenshotModal'
import { captureScreen } from '../components/captureScreen'
import { Search } from '../components/Search'
import { Symbols, type SymbolDecl, type SymbolQuery } from '../components/Symbols'
import { extractClickedSymbol } from '../components/clickWord'
import { CallChain, type CallChainStart } from '../components/CallChain'
import { Network } from '../components/Network'
import { DbSchemas } from '../components/DbSchemas'
import { EntryPoints } from '../components/EntryPoints'
import { NativeViewer } from '../components/Native'
import { NativeBridge } from '../components/NativeBridge'
import { StringTools } from '@shared/components/StringTools'
import {
  applyRenames,
  gzipUncompressedSize,
  loadLocalTree,
  searchLocalTree,
  LOCAL_TREE_MAX_BYTES,
  type LocalTree,
  type RenameEntry,
  type SourceBundle,
} from '../lib/localTree'

// =========================================================================
// Types
// =========================================================================

type FileNode = {
  name: string
  path: string
  type: 'dir' | 'file'
  size: number | null
  children: FileNode[] | null
}

type FileContent = {
  path: string
  size: number
  truncated: boolean
  encoding: 'utf-8' | 'binary'
  content: string
}

type WorkflowStatus = 'NEW' | 'TRIAGING' | 'ANALYZING' | 'DRAFTING_REPORT' | 'PUBLISHED'

type Project = {
  id: string
  name: string
  originalFilename: string
  status: 'UPLOADED' | 'DECOMPILING' | 'READY' | 'FAILED'
  workflowStatus: WorkflowStatus
  analysisMode: Mode
  packageName: string | null
  errorMessage: string | null
  // Caller's effective access tier on this project. Null on pre-collab
  // backends or anonymous callers — treat null as OWNER for back-compat.
  role: ProjectRole | null
  // Non-null = project is publicly readable (owner toggle).
  publicReadAt?: string | null
  // Set when this project is a fork; drives "forked from" attribution.
  forkedFromId?: string | null
  forkCount?: number
}

type Provider =
  | 'ANTHROPIC' | 'OPENAI' | 'GEMINI' | 'DEEPSEEK'
  | 'QWEN' | 'KIMI' | 'OPENAI_COMPAT' | 'BEDROCK'

type Credential = { id: string; provider: Provider; label: string }

type Mode = 'MALWARE' | 'VULN_RESEARCH'

type Hotspot = { path: string; severity: string; reason: string }
type Ioc = { type: string; value: string; occurrences: number }
type AnalysisResponse = {
  mode: Mode
  summary: string
  hotspots: Hotspot[]
  iocs: Ioc[]
  nextSteps: string[]
  rawModelOutput: string
  model: string
  inputTokens: number
  outputTokens: number
}

type RightTab = 'analysis' | 'ask' | 'report' | 'gallery' | 'highlights' | 'renames' | 'crypto' | 'callchain' | 'network' | 'dbs' | 'entrypoints' | 'native' | 'tools'

type ShotState = null | { mode: 'pick' } | { mode: 'capture'; blob: Blob }

const PANEL_WIDTH_KEY = 'openapk.panelWidth'
const PANEL_WIDTH_DEFAULT = 460
const PANEL_WIDTH_MIN = 320
const PANEL_WIDTH_MAX = 900

/**
 * True when the selected file is a native library JADX dumped under
 * resources/lib/<abi>/. Centralized so the file viewer and any future
 * native-aware UI agree on the same detection.
 */
function isNativeLib(path: string): boolean {
  return path.endsWith('.so') && path.startsWith('resources/lib/')
}

// =========================================================================
// Top-level page
// =========================================================================

export function ProjectView() {
  const { id } = useParams<{ id: string }>()
  const api = useApi()

  const [project, setProject] = useState<Project | null>(null)
  const [tree, setTree] = useState<FileNode | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  // Open tab paths in display order. The leftmost is the oldest; clicking a
  // file in the tree appends to the right. selected is always either null
  // (nothing open) or a member of openTabs.
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [content, setContent] = useState<FileContent | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Set by callers that know which line they want to jump to (search results,
  // hotspots, crypto hits). HighlightedCode reads + scrolls after render, and
  // it auto-clears so a re-render doesn't re-scroll.
  const [pendingLine, setPendingLine] = useState<number | null>(null)
  // True while Search has a non-empty query — we hide the file tree to give
  // the sidebar real estate to the results panel.
  const [searchActive, setSearchActive] = useState(false)
  // Set by Cmd/Ctrl-click or right-click on an identifier in the code viewer.
  // While non-null, the sidebar shows the Symbols panel (defs + usages) and
  // the file tree is hidden.
  const [symbolQuery, setSymbolQuery] = useState<SymbolQuery | null>(null)
  // Bumped each time the user requests a new call chain so the CallChain
  // component re-fires the build effect even for the same file:line.
  const [chainStart, setChainStart] = useState<CallChainStart | null>(null)

  // AI settings shared across analysis + ask
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [mode, setMode] = useState<Mode>('MALWARE')
  const [credentialId, setCredentialId] = useState<string | null>(null)
  const [model, setModel] = useState<string>('')
  // Live model list for the selected credential — replaces the old hardcoded
  // MODELS_BY_PROVIDER map; drives the model picker in RightPanel.
  const { models: dynamicModels } = useCredentialModels(credentialId)

  // Analysis
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeElapsed, setAnalyzeElapsed] = useState(0)
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null)

  // Right panel
  const [rightOpen, setRightOpen] = useState(true)
  const [activeTab, setActiveTab] = useState<RightTab>('analysis')

  // Screenshot capture / gallery
  const [shot, setShot] = useState<ShotState>(null)
  const [galleryKey, setGalleryKey] = useState(0)
  const [captureErr, setCaptureErr] = useState<string | null>(null)
  // After a screenshot saves, offer to pin it to the Highlights board.
  const [highlightPrompt, setHighlightPrompt] = useState<string | null>(null)
  const [highlightsKey, setHighlightsKey] = useState(0)

  // AI rename suggestions
  const [renamesKey, setRenamesKey] = useState(0)
  const [suggesting, setSuggesting] = useState(false)
  const [renameMsg, setRenameMsg] = useState<string | null>(null)

  // In-memory cache of previously-viewed file contents so re-clicking a file
  // you've already opened is instant (no network round-trip). useRef so the
  // map survives re-renders without triggering them. Cleared on rename
  // mutations (file content is rewritten on-read with current renames) and
  // when the project id changes.
  const fileCache = useRef<Map<string, FileContent>>(new Map())
  useEffect(() => {
    fileCache.current.clear()
  }, [id])

  // Client-side source tree: the whole decompiled tree downloaded once from
  // S3 (via /source-bundle) and held in memory, so file opens and search
  // never hit the backend. 'off' = server-side fallback (endpoint 404'd,
  // tree too big, or download failed). Renames are applied at read time from
  // appliedRenames, refreshed whenever a rename mutation clears the cache.
  const localTree = useRef<LocalTree | null>(null)
  const appliedRenames = useRef<RenameEntry[]>([])
  const [localStatus, setLocalStatus] = useState<'off' | 'loading' | 'ready'>('off')
  const [localProgress, setLocalProgress] = useState(0)

  const refreshAppliedRenames = useCallback(async () => {
    if (!id || !localTree.current) return
    try {
      const all = await api<RenameEntry[]>(`/api/projects/${id}/renames`)
      appliedRenames.current = all.filter(r => r.status === 'APPLIED')
    } catch { /* keep the previous map — next mutation retries */ }
  }, [api, id])

  const clearFileCache = useCallback(() => {
    fileCache.current.clear()
    // Local mode derives content from raw source + rename map, so the map
    // must track the mutation that just invalidated the cache.
    void refreshAppliedRenames()
  }, [refreshAppliedRenames])

  useEffect(() => {
    if (!id || !project || project.status !== 'READY') return
    let cancelled = false
    void (async () => {
      try {
        const bundle = await api<SourceBundle>(`/api/projects/${id}/source-bundle`)
        // Exact uncompressed size from the gzip trailer (4-byte ranged GET);
        // fall back to a conservative ratio estimate if Range is unsupported.
        const uncompressed = (await gzipUncompressedSize(bundle.url)) ?? bundle.compressedBytes * 5
        if (cancelled || uncompressed > LOCAL_TREE_MAX_BYTES) return
        setLocalStatus('loading')
        const [treeData, renames] = await Promise.all([
          loadLocalTree(bundle, frac => { if (!cancelled) setLocalProgress(frac) }),
          api<RenameEntry[]>(`/api/projects/${id}/renames`).catch(() => [] as RenameEntry[]),
        ])
        if (cancelled) return
        localTree.current = treeData
        appliedRenames.current = renames.filter(r => r.status === 'APPLIED')
        setLocalStatus('ready')
      } catch {
        // 404 (fs backend / no tarball) or download failure — server-side
        // endpoints keep working exactly as before.
        if (!cancelled) setLocalStatus('off')
      }
    })()
    return () => {
      cancelled = true
      localTree.current = null
      setLocalStatus('off')
      setLocalProgress(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, id, project?.status])

  /**
   * Persist mode to the project + flip local state in lockstep so the next
   * /analyze call uses the new mode AND the Report tab picks up the matching
   * section template the next time it's opened. Optimistic — local state
   * flips before the PATCH lands.
   */
  const changeAnalysisMode = useCallback(async (next: Mode) => {
    if (!id) return
    setMode(next)
    setProject(p => (p ? { ...p, analysisMode: next } : p))
    try {
      await api(`/api/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ analysisMode: next }),
      })
    } catch (e) {
      // Roll back if persist fails — keep UI honest about server state.
      setError((e as Error).message)
    }
  }, [api, id])

  /** Derive a FileContent from the in-browser tree, or null if not local. */
  const readLocal = useCallback((path: string): FileContent | null => {
    const lt = localTree.current
    if (!lt) return null
    const raw = lt.text.get(path)
    if (raw !== undefined) {
      return {
        path,
        size: raw.length,
        truncated: false,
        encoding: 'utf-8',
        content: applyRenames(raw, appliedRenames.current),
      }
    }
    const binSize = lt.binary.get(path)
    if (binSize !== undefined) {
      return { path, size: binSize, truncated: false, encoding: 'binary', content: '' }
    }
    return null // not in the tarball snapshot — fall back to the server
  }, [])

  const refetchOpenFile = useCallback(async () => {
    if (!id || !selected) return
    try {
      // Bypass + bust the cache entry so a fresh read picks up rename
      // changes (server rewrites content on-read; local mode re-applies the
      // just-refreshed rename map over the raw source).
      fileCache.current.delete(selected)
      if (localTree.current) await refreshAppliedRenames()
      const local = readLocal(selected)
      const data = local ?? await api<FileContent>(
        `/api/projects/${id}/file?path=${encodeURIComponent(selected)}`,
      )
      fileCache.current.set(selected, data)
      setContent(data)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [api, id, selected, readLocal, refreshAppliedRenames])

  async function suggestRenames() {
    if (!id || !selected || !credentialId || !content) return
    const lineCount = content.content.split('\n').length
    if (lineCount > 1500) {
      const chunks = Math.ceil((lineCount - 100) / 1100)
      if (!confirm(
        `This file is ${lineCount} lines — the backend will split it into ~${chunks} chunks (one AI call each). Continue?`,
      )) return
    }
    setSuggesting(true)
    setRenameMsg(null)
    setError(null)
    try {
      const r = await api<{ suggestions: unknown[]; chunks: number; inputTokens: number; outputTokens: number; model: string }>(
        `/api/projects/${id}/renames/suggest`,
        {
          method: 'POST',
          body: JSON.stringify({ filePath: selected, credentialId, model: model || undefined }),
        },
      )
      setRenameMsg(`${r.suggestions.length} suggestion${r.suggestions.length === 1 ? '' : 's'} from ${r.chunks} chunk${r.chunks === 1 ? '' : 's'} (in ${r.inputTokens.toLocaleString()} · out ${r.outputTokens.toLocaleString()}).`)
      setRenamesKey(k => k + 1)
      setActiveTab('renames')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSuggesting(false)
    }
  }

  async function startCapture() {
    setCaptureErr(null)
    try {
      const blob = await captureScreen()
      if (blob) setShot({ mode: 'capture', blob })
    } catch (e) {
      setCaptureErr((e as Error).message)
    }
  }

  function onScreenshotSaved(url: string) {
    setShot(null)
    setGalleryKey(k => k + 1)
    setActiveTab('gallery')
    const key = mediaKeyFromUrl(url)
    if (key) setHighlightPrompt(key)
  }
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(PANEL_WIDTH_KEY) : null
    const n = stored ? parseInt(stored, 10) : NaN
    return Number.isFinite(n) ? Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, n)) : PANEL_WIDTH_DEFAULT
  })

  useEffect(() => {
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth))
  }, [panelWidth])

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = panelWidth
    const onMove = (ev: MouseEvent) => {
      const dx = startX - ev.clientX // dragging left widens the right panel
      const next = Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, startW + dx))
      setPanelWidth(next)
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
  }, [panelWidth])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    Promise.all([
      api<Project>(`/api/projects/${id}`),
      api<FileNode>(`/api/projects/${id}/files`).catch(() => null),
      api<Credential[]>('/api/credentials').catch(() => [] as Credential[]),
      // Rehydrate the last /analyze result so the Analysis tab survives a
      // refresh. Returns null when nothing's cached yet — leaves the tab
      // in its empty "Run analysis" state.
      api<AnalysisResponse | null>(`/api/projects/${id}/analysis`).catch(() => null),
    ])
      .then(([p, t, creds, cachedAnalysis]) => {
        if (cancelled) return
        setProject(p)
        // Seed the AnalysisTab mode dropdown from the project's persisted
        // mode so a refresh doesn't snap it back to MALWARE.
        if (p?.analysisMode) setMode(p.analysisMode)
        if (t) setTree(t)
        if (cachedAnalysis) setAnalysis(cachedAnalysis)
        const usable = creds ?? []
        setCredentials(usable)
        if (usable.length > 0 && !credentialId) {
          setCredentialId(usable[0].id)
          setModel('') // backend default; the dynamic list drives the picker
        }
      })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, id])

  const openFile = useCallback(async (path: string, line?: number) => {
    if (!id) return
    setSelected(path)
    setOpenTabs(prev => (prev.includes(path) ? prev : [...prev, path]))
    setPendingLine(line ?? null)
    const cached = fileCache.current.get(path)
    if (cached) {
      // Cache hit — render immediately, no flicker through the loading state.
      setContent(cached)
      setLoadingContent(false)
      return
    }
    // Local fast path — content is derived in-browser, no network at all.
    const local = readLocal(path)
    if (local) {
      fileCache.current.set(path, local)
      setContent(local)
      setLoadingContent(false)
      return
    }
    setLoadingContent(true)
    setContent(null)
    try {
      const data = await api<FileContent>(
        `/api/projects/${id}/file?path=${encodeURIComponent(path)}`,
      )
      fileCache.current.set(path, data)
      setContent(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingContent(false)
    }
  }, [api, id, readLocal])

  // Close a tab and pick a sensible neighbor to activate. Prefers the tab to
  // the right (matches VS Code); falls back to the left, then null if it was
  // the last open tab.
  const closeTab = useCallback((path: string) => {
    setOpenTabs(prev => {
      const idx = prev.indexOf(path)
      if (idx === -1) return prev
      const next = [...prev.slice(0, idx), ...prev.slice(idx + 1)]
      if (selected === path) {
        const neighbor = next[idx] ?? next[idx - 1] ?? null
        if (neighbor) {
          // Activate neighbor through openFile so content + cache sync up.
          void openFile(neighbor)
        } else {
          setSelected(null)
          setContent(null)
        }
      }
      return next
    })
  }, [openFile, selected])

  // Persist openTabs + selected per-project so a refresh keeps the user's
  // workspace. Keyed by projectId; one entry per project.
  const tabsStorageKey = id ? `openapk.tabs.${id}` : null
  // Restore on mount once we know the project id.
  useEffect(() => {
    if (!tabsStorageKey) return
    try {
      const raw = window.localStorage.getItem(tabsStorageKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as { tabs?: string[]; active?: string | null }
      const tabs = Array.isArray(parsed.tabs) ? parsed.tabs.filter(t => typeof t === 'string') : []
      setOpenTabs(tabs)
      if (parsed.active && tabs.includes(parsed.active)) {
        void openFile(parsed.active)
      }
    } catch {
      // ignore corrupted slot — start fresh
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabsStorageKey])
  // Save whenever the workspace changes.
  useEffect(() => {
    if (!tabsStorageKey) return
    try {
      if (openTabs.length === 0) {
        window.localStorage.removeItem(tabsStorageKey)
      } else {
        window.localStorage.setItem(tabsStorageKey, JSON.stringify({ tabs: openTabs, active: selected }))
      }
    } catch {
      // quota / sandbox — silently drop
    }
  }, [tabsStorageKey, openTabs, selected])

  /**
   * Fired by Cmd/Ctrl-click on an identifier in the code viewer. Sets the
   * sidebar symbol query (so defs + usages render) and — when exactly one
   * declaration matches — auto-jumps the viewer to it. Multiple matches
   * are left to the user to pick from the sidebar list.
   */
  const goToDefinition = useCallback(async (q: SymbolQuery) => {
    if (!id) return
    setSymbolQuery(q)
    try {
      // Default to user-code only — mirrors the Symbols panel's default. The
      // Symbols panel re-issues this fetch with the user's includeSdks toggle.
      const params = new URLSearchParams({ name: q.name, includeSdks: 'false' })
      const defs = await api<SymbolDecl[]>(
        `/api/projects/${id}/symbols/definition?${params.toString()}`,
      )
      if (defs.length === 1) {
        const d = defs[0]
        void openFile(d.file, d.line)
      }
    } catch {
      // The Symbols panel issues the same fetch and will surface the error.
    }
  }, [api, id, openFile])

  const handleViewerClick = useCallback((e: React.MouseEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return
    const sym = extractClickedSymbol(e.nativeEvent)
    if (!sym) return
    e.preventDefault()
    void goToDefinition({ name: sym.word, qualifyingClass: sym.qualifyingClass })
  }, [goToDefinition])

  const handleViewerContextMenu = useCallback((e: React.MouseEvent) => {
    const sym = extractClickedSymbol(e.nativeEvent)
    if (!sym) return
    e.preventDefault()
    setSymbolQuery({ name: sym.word, qualifyingClass: sym.qualifyingClass })
  }, [])

  const startCallChain = useCallback((file: string, line: number) => {
    setChainStart({ file, line, nonce: Date.now() })
    setActiveTab('callchain')
  }, [])

  function onCredentialChange(newCredId: string) {
    setCredentialId(newCredId)
    // Reset to backend default; the picker re-fetches the new credential's models.
    setModel('')
  }

  async function runAnalysis() {
    if (!id || !credentialId) return
    setAnalyzing(true)
    setAnalyzeElapsed(0)
    setError(null)
    const started = Date.now()
    const tick = setInterval(() => setAnalyzeElapsed(Math.round((Date.now() - started) / 1000)), 1000)
    try {
      const result = await api<AnalysisResponse>(`/api/projects/${id}/analyze`, {
        method: 'POST',
        body: JSON.stringify({ mode, credentialId, model: model || undefined }),
      })
      setAnalysis(result)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      clearInterval(tick)
      setAnalyzing(false)
    }
  }

  function jumpToFileFromHotspot(path: string) {
    void openFile(path)
    // make sure they can see the code (panel stays open; tab can stay on analysis)
  }

  if (!id) return <p className="p-8">Missing project id.</p>

  const modelOptions = dynamicModels.map(m => ({ id: m, label: m }))

  return (
    <ProjectRoleProvider role={project?.role ?? null}>
    <div className="flex h-full flex-col px-4 py-3">
      <PageHeader
        project={project}
        error={error}
        projectId={id}
        onPatch={async body => {
          const updated = await api<Project>(`/api/projects/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          })
          setProject(updated)
        }}
        onModeChange={changeAnalysisMode}
      />

      <div
        className="mt-3 grid flex-1 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40"
        style={{
          gridTemplateColumns: rightOpen ? `280px 1fr ${panelWidth}px` : '280px 1fr 36px',
        }}
      >
        {/* Left: search + (symbols | tree). Priority: search > symbols > tree. */}
        <aside className="flex flex-col overflow-hidden border-r border-zinc-800">
          {/* When search is active its results fill the sidebar and scroll
              (flex-1 + min-h-0); when idle it's just the pinned input row. */}
          <div className={`border-b border-zinc-800 p-2 ${searchActive ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'shrink-0'}`}>
            {id && (
              <Search
                projectId={id}
                onOpen={(file, line) => void openFile(file, line)}
                onActiveChange={setSearchActive}
                localSearch={
                  localStatus === 'ready'
                    ? (q, opts) => searchLocalTree(localTree.current!, q, opts)
                    : undefined
                }
              />
            )}
          </div>
          {!searchActive && symbolQuery && id && (
            <div className="flex-1 overflow-auto p-2">
              <Symbols
                projectId={id}
                query={symbolQuery}
                onOpen={(file, line) => void openFile(file, line)}
                onClose={() => setSymbolQuery(null)}
                onStartChain={startCallChain}
              />
            </div>
          )}
          {!searchActive && !symbolQuery && (
            <div className="flex-1 overflow-auto p-2">
              {localStatus === 'loading' && (
                <p className="px-2 pb-1 text-[10px] text-amber-400/80" title="Downloading the decompiled tree so file opens and search run instantly in your browser">
                  ⚡ loading sources locally… {Math.round(localProgress * 100)}%
                </p>
              )}
              {localStatus === 'ready' && (
                <p className="px-2 pb-1 text-[10px] text-emerald-500/70" title="Sources are held in browser memory — file opens and search don't touch the server">
                  ⚡ local mode
                </p>
              )}
              {tree ? (
                <FileTreeNode node={tree} depth={0} selected={selected} onOpen={(p) => void openFile(p)} />
              ) : (
                <p className="p-2 text-sm text-zinc-500">No file tree yet.</p>
              )}
            </div>
          )}
          <p className="border-t border-zinc-900 px-2 py-1 text-[10px] text-zinc-600" title="Hold Cmd or Ctrl and click an identifier in the code to jump to its definition. Right-click an identifier to see its usages.">
            Cmd/Ctrl-click: go to def · Right-click: usages
          </p>
        </aside>

        {/* Center: code viewer */}
        <section className="flex min-w-0 flex-col overflow-hidden">
          {/* Tab strip: one tab per open file, leftmost = oldest opened.
              Click a tab to activate; click × to close.
              Tabs accumulate as you open files; persisted per-project. */}
          <div className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-950/50 px-2 pt-1 text-xs">
            <div className="flex min-w-0 flex-1 overflow-x-auto">
              {openTabs.length === 0 ? (
                <span className="px-2 py-2 text-zinc-500">Select a file from the tree</span>
              ) : (
                openTabs.map(tabPath => {
                  const basename = tabPath.split('/').pop() || tabPath
                  const isActive = tabPath === selected
                  return (
                    <div
                      key={tabPath}
                      onClick={() => void openFile(tabPath)}
                      onAuxClick={e => { if (e.button === 1) { e.preventDefault(); closeTab(tabPath) } }}
                      title={tabPath}
                      className={`group relative flex shrink-0 cursor-pointer items-center gap-2 border-t-2 px-3 py-1.5 font-mono ${
                        isActive
                          ? 'border-purple-500 bg-zinc-900 text-zinc-100'
                          : 'border-transparent text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200'
                      }`}
                    >
                      <span className="max-w-[180px] truncate">{basename}</span>
                      <button
                        onClick={e => { e.stopPropagation(); closeTab(tabPath) }}
                        title="Close tab"
                        className={`shrink-0 rounded px-1 leading-none hover:bg-zinc-700 ${
                          isActive ? 'opacity-80 hover:opacity-100' : 'opacity-0 group-hover:opacity-60'
                        }`}
                      >
                        ×
                      </button>
                    </div>
                  )
                })
              )}
            </div>
            {content && (
              <span className="shrink-0 px-2 text-zinc-600">
                {content.size.toLocaleString()} bytes
                {content.truncated && <> · <span className="text-amber-400">truncated</span></>}
              </span>
            )}
            <div className="flex shrink-0 items-center gap-1 border-l border-zinc-800 pl-2 pr-1">
              <button
                onClick={suggestRenames}
                disabled={!canEdit(project?.role) || suggesting || !selected || !credentialId || !content || content.encoding === 'binary'}
                title={
                  !canEdit(project?.role) ? 'Viewer access — rename suggestions are owner/editor-only.' :
                  !selected ? 'Open a file first' :
                  !credentialId ? 'Pick a credential in the AI panel' :
                  content?.encoding === 'binary' ? 'Binary files can\'t be analyzed' :
                  'Ask AI to suggest readable names for obfuscated identifiers in this file'
                }
                className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
              >
                {suggesting ? 'Analyzing…' : '✨ Suggest renames'}
              </button>
              <button
                onClick={() => setShot({ mode: 'pick' })}
                title="Paste / drop / browse an image — saves to Gallery"
                className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-zinc-800"
              >
                📷
              </button>
              <button
                onClick={startCapture}
                title="Capture a region of the screen — saves to Gallery"
                className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-zinc-800"
              >
                📸
              </button>
            </div>
          </div>
          {captureErr && (
            <div className="border-b border-red-900/60 bg-red-950/40 px-4 py-1 text-[11px] text-red-300">
              Capture failed: {captureErr}
            </div>
          )}
          {renameMsg && (
            <div className="border-b border-zinc-800 bg-zinc-950/30 px-4 py-1 text-[11px] text-zinc-400">
              {renameMsg}
            </div>
          )}
          <div
            className="min-h-0 flex-1 overflow-auto"
            onClick={handleViewerClick}
            onContextMenu={handleViewerContextMenu}
          >
            {/* Native .so files get the full-pane Ghidra analysis viewer
                instead of the "binary not supported" fallback. Checked on
                `selected` (not `content`) so the UI flips the instant the
                user clicks the file — no waiting for the round-trip that
                tells us "binary, no content". */}
            {selected && isNativeLib(selected) && id ? (
              <NativeViewer projectId={id} libPath={selected} />
            ) : loadingContent ? (
              <p className="p-4 text-sm text-zinc-500">Loading…</p>
            ) : content ? (
              content.encoding === 'binary' ? (
                <p className="p-4 text-sm text-zinc-500">
                  Binary file ({content.size.toLocaleString()} bytes) — preview not supported.
                </p>
              ) : (
                <HighlightedCode code={content.content} path={content.path} scrollToLine={pendingLine} />
              )
            ) : (
              <p className="p-4 text-sm text-zinc-500">No file selected.</p>
            )}
          </div>
        </section>

        {/* Right: collapsible AI panel */}
        <RightPanel
          open={rightOpen}
          onToggle={() => setRightOpen(o => !o)}
          onStartResize={startResize}
          projectId={id}
          activeTab={activeTab}
          onTab={setActiveTab}
          galleryKey={galleryKey}
          highlightsKey={highlightsKey}
          selectedFilePath={selected}
          renamesKey={renamesKey}
          onRenameMutation={() => {
            // Renames are applied at read time on the server, so every cached
            // file may now be stale. Drop the whole cache and force a fresh
            // read of the currently-open file.
            clearFileCache()
            setRenamesKey(k => k + 1)
            void refetchOpenFile()
          }}
          onOpenFile={openFile}
          credentials={credentials}
          credentialId={credentialId}
          onCredentialChange={onCredentialChange}
          model={model}
          onModelChange={setModel}
          modelOptions={modelOptions}
          analysisProps={{
            mode, onMode: changeAnalysisMode,
            analyzing, analyzeElapsed, onRun: runAnalysis,
            analysis,
            onHotspotOpen: jumpToFileFromHotspot,
          }}
          askProps={{
            projectId: id,
            filePath: selected,
            credentialId,
            model,
          }}
          chainStart={chainStart}
        />
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
      {highlightPrompt && (
        <AddHighlightModal
          projectId={id}
          mediaKey={highlightPrompt}
          defaultTarget={selected ? { type: 'FILE', ref: selected } : null}
          Img={AuthenticatedImg}
          onClose={() => setHighlightPrompt(null)}
          onCreated={() => {
            setHighlightPrompt(null)
            setHighlightsKey(k => k + 1)
            setActiveTab('highlights')
          }}
        />
      )}
    </div>
    </ProjectRoleProvider>
  )
}

// =========================================================================
// Header
// =========================================================================

const WORKFLOW_LABEL: Record<WorkflowStatus, string> = {
  NEW: 'New',
  TRIAGING: 'Triaging',
  ANALYZING: 'Analyzing',
  DRAFTING_REPORT: 'Drafting report',
  PUBLISHED: 'Published',
}

const SETTABLE_WORKFLOWS: WorkflowStatus[] = ['NEW', 'TRIAGING', 'ANALYZING', 'DRAFTING_REPORT']

function PageHeader({
  project, error, projectId, onPatch, onModeChange,
}: {
  project: Project | null
  error: string | null
  projectId: string
  onPatch: (body: Partial<{ name: string; workflowStatus: WorkflowStatus }>) => Promise<void>
  onModeChange: (mode: Mode) => void | Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [shareOpen, setShareOpen] = useState(false)

  function startEdit() {
    if (!project) return
    setDraftName(project.name)
    setEditing(true)
  }
  async function commitEdit() {
    if (!project) { setEditing(false); return }
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== project.name) {
      await onPatch({ name: trimmed })
    }
    setEditing(false)
  }

  const locked = project?.workflowStatus === 'PUBLISHED'
  // Role gating: collab-naive backends + the caller-is-owner case both
  // surface role=null, which canEdit/isOwner treat as full access.
  // Genuine VIEWERs see read-only UI (mode/workflow disabled, no rename,
  // no Share button).
  const callerCanEdit = canEdit(project?.role)
  const callerIsOwner = isOwner(project?.role)

  return (
    <div>
      <Link to="/projects" className="text-sm text-zinc-400 hover:text-zinc-200">
        ← back to projects
      </Link>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {editing ? (
            <input
              autoFocus
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              onBlur={() => void commitEdit()}
              onKeyDown={e => {
                if (e.key === 'Enter') void commitEdit()
                else if (e.key === 'Escape') setEditing(false)
              }}
              className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xl font-semibold text-zinc-100"
            />
          ) : (
            <h1 className="truncate text-xl font-semibold text-zinc-100">
              {project?.name ?? 'Loading…'}
            </h1>
          )}
          {project && !editing && callerCanEdit && (
            <button
              onClick={startEdit}
              title="Rename project"
              className="text-sm text-zinc-500 hover:text-zinc-200"
            >
              ✎
            </button>
          )}
          {project?.role === 'VIEWER' && (
            <span
              className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-400"
              title="You have view-only access on this project"
            >
              viewer
            </span>
          )}
          {project?.role === 'EDITOR' && (
            <span
              className="shrink-0 rounded border border-emerald-700/60 bg-emerald-900/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-emerald-300"
              title="Shared with you — editor access"
            >
              editor
            </span>
          )}
          {project?.forkedFromId && (
            <Link
              to={`/projects/${project.forkedFromId}`}
              className="shrink-0 rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-purple-300"
              title="View the project this was forked from"
            >
              🍴 forked
            </Link>
          )}
        </div>
        <div className="flex items-center gap-3">
          {project && (
            <select
              value={project.analysisMode}
              onChange={e => void onModeChange(e.target.value as Mode)}
              disabled={!callerCanEdit}
              title={callerCanEdit
                ? "Primary analysis mode. Drives the default Report section template and the Analysis tab's mode dropdown."
                : 'Viewer access — analysis mode is read-only.'}
              className={`rounded border px-2 py-1 text-xs disabled:opacity-50 ${
                project.analysisMode === 'VULN_RESEARCH'
                  ? 'border-rose-700/60 bg-rose-950/30 text-rose-200'
                  : 'border-amber-700/60 bg-amber-950/30 text-amber-200'
              }`}
            >
              <option value="MALWARE">MAR · Malware</option>
              <option value="VULN_RESEARCH">VRR · Vuln Research</option>
            </select>
          )}
          {project && (
            <select
              value={project.workflowStatus}
              onChange={e => void onPatch({ workflowStatus: e.target.value as WorkflowStatus })}
              disabled={locked || !callerCanEdit}
              title={locked
                ? 'Unpublish the report to change status'
                : !callerCanEdit ? 'Viewer access — workflow is read-only.' : 'Workflow status'}
              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 disabled:opacity-50"
            >
              {locked && <option value="PUBLISHED">Published (locked)</option>}
              {!locked && SETTABLE_WORKFLOWS.map(s => (
                <option key={s} value={s}>{WORKFLOW_LABEL[s]}</option>
              ))}
            </select>
          )}
          {projectId && <MembersBar projectId={projectId} />}
          {project && callerIsOwner && (
            <ProjectVisibilityToggle
              projectId={project.id}
              initialPublicReadAt={project.publicReadAt ?? null}
              accent="amber"
            />
          )}
          {project && callerIsOwner && (
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="rounded border border-amber-700/60 bg-amber-950/30 px-3 py-1 text-xs font-medium text-amber-200 hover:bg-amber-900/40"
              title="Invite collaborators to this project"
            >
              Share
            </button>
          )}
          <Link
            to={`/projects/${projectId}/report`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
            title="Open report in a new tab"
          >
            Report ↗
          </Link>
        </div>
      </div>
      {shareOpen && projectId && (
        <ShareProjectModal
          projectId={projectId}
          accent="amber"
          onClose={() => setShareOpen(false)}
        />
      )}
      {project && (project.name !== project.originalFilename || project.packageName) && (
        <div className="mt-1 text-xs text-zinc-500">
          {project.name !== project.originalFilename && (
            <span className="font-mono">{project.originalFilename}</span>
          )}
          {project.name !== project.originalFilename && project.packageName && <> · </>}
          {project.packageName && (
            <span className="font-mono">{project.packageName}</span>
          )}
        </div>
      )}
      {error && (
        <div className="mt-2 rounded border border-red-900/60 bg-red-950/40 px-3 py-1.5 text-sm text-red-300">
          {error.includes('Settings → Usage') ? (
            <>
              {error.split('Settings → Usage')[0]}
              <Link to="/settings/usage" className="underline hover:text-red-200">Settings → Usage</Link>
              {error.split('Settings → Usage')[1]}
            </>
          ) : error}
        </div>
      )}
    </div>
  )
}

// =========================================================================
// Right panel
// =========================================================================

type AnalysisTabProps = {
  mode: Mode
  onMode: (m: Mode) => void
  analyzing: boolean
  analyzeElapsed: number
  onRun: () => void
  analysis: AnalysisResponse | null
  onHotspotOpen: (path: string) => void
}

type AskTabProps = {
  projectId: string
  filePath: string | null
  credentialId: string | null
  model: string
}

function RightPanel({
  open, onToggle, onStartResize, projectId, activeTab, onTab, galleryKey, highlightsKey, selectedFilePath, renamesKey, onRenameMutation, onOpenFile,
  credentials, credentialId, onCredentialChange,
  model, onModelChange, modelOptions,
  analysisProps, askProps, chainStart,
}: {
  open: boolean
  onToggle: () => void
  onStartResize: (e: React.MouseEvent) => void
  projectId: string
  activeTab: RightTab
  onTab: (t: RightTab) => void
  galleryKey: number
  // Bumped when the screenshot flow pins a new highlight so a mounted board refetches.
  highlightsKey: number
  // Currently-open file — offered as the default FILE anchor when adding a highlight.
  selectedFilePath: string | null
  renamesKey: number
  onRenameMutation: () => void
  onOpenFile: (path: string, line?: number) => void
  credentials: Credential[]
  credentialId: string | null
  onCredentialChange: (id: string) => void
  model: string
  onModelChange: (m: string) => void
  modelOptions: { id: string; label: string }[]
  analysisProps: AnalysisTabProps
  askProps: AskTabProps
  chainStart: CallChainStart | null
}) {
  const callerCanEdit = useCanEdit()
  if (!open) {
    return (
      <aside className="flex flex-col items-center border-l border-zinc-800 py-3">
        <button
          onClick={onToggle}
          title="Expand AI panel"
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <span aria-hidden>‹</span>
        </button>
        <div
          className="mt-3 select-none text-[10px] uppercase tracking-widest text-zinc-600"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          AI Panel
        </div>
      </aside>
    )
  }

  const noCreds = credentials.length === 0

  return (
    <aside
      data-capture-hide
      className="relative flex flex-col overflow-hidden border-l border-zinc-800"
    >
      {/* Drag handle */}
      <div
        onMouseDown={onStartResize}
        title="Drag to resize"
        className="group absolute left-0 top-0 z-20 h-full w-1.5 -translate-x-1/2 cursor-col-resize"
      >
        <div className="h-full w-px bg-transparent group-hover:bg-purple-500/60" />
      </div>

      {/* Shared cred / model row */}
      <div className="grid grid-cols-2 gap-2 border-b border-zinc-800 bg-zinc-950/40 p-3">
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wide text-zinc-500">Credential</span>
          <select
            value={credentialId ?? ''}
            onChange={e => onCredentialChange(e.target.value)}
            disabled={noCreds}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 disabled:opacity-50"
          >
            {noCreds ? (
              <option>No keys saved</option>
            ) : (
              credentials.map(c => (
                <option key={c.id} value={c.id}>{c.label} ({c.provider})</option>
              ))
            )}
          </select>
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wide text-zinc-500">Model</span>
          <select
            value={model}
            onChange={e => onModelChange(e.target.value)}
            disabled={noCreds}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 disabled:opacity-50"
          >
            <option value="">Default</option>
            {modelOptions.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Tab strip — inner div scrolls horizontally when the right panel is
          narrower than the tab row, so newer tabs (Network, DBs, Entry points)
          can't get clipped off the right edge anymore. Collapse button stays
          pinned. */}
      <div className="flex items-center border-b border-zinc-800 bg-zinc-950/20">
        <div className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap">
          <TabButton active={activeTab === 'analysis'} onClick={() => onTab('analysis')}>
            Analysis
          </TabButton>
          <TabButton active={activeTab === 'ask'} onClick={() => onTab('ask')}>
            Ask AI
          </TabButton>
          <TabButton active={activeTab === 'report'} onClick={() => onTab('report')}>
            Report
          </TabButton>
          <TabButton active={activeTab === 'gallery'} onClick={() => onTab('gallery')}>
            Gallery
          </TabButton>
          <TabButton active={activeTab === 'highlights'} onClick={() => onTab('highlights')}>
            Highlights
          </TabButton>
          <TabButton active={activeTab === 'renames'} onClick={() => onTab('renames')}>
            Renames
          </TabButton>
          <TabButton active={activeTab === 'crypto'} onClick={() => onTab('crypto')}>
            Crypto
          </TabButton>
          <TabButton active={activeTab === 'callchain'} onClick={() => onTab('callchain')}>
            Call chain
          </TabButton>
          <TabButton active={activeTab === 'network'} onClick={() => onTab('network')}>
            Network
          </TabButton>
          <TabButton active={activeTab === 'dbs'} onClick={() => onTab('dbs')}>
            DBs
          </TabButton>
          <TabButton active={activeTab === 'entrypoints'} onClick={() => onTab('entrypoints')}>
            Entry points
          </TabButton>
          <TabButton active={activeTab === 'native'} onClick={() => onTab('native')}>
            Native
          </TabButton>
          <TabButton active={activeTab === 'tools'} onClick={() => onTab('tools')}>
            Tools
          </TabButton>
        </div>
        <button
          onClick={onToggle}
          title="Collapse panel"
          className="shrink-0 px-3 text-zinc-500 hover:text-zinc-200"
        >
          <span aria-hidden>›</span>
        </button>
      </div>

      {/* Tab content — all mounted, inactive ones hidden to preserve state */}
      <div className="flex-1 overflow-auto">
        <div className={activeTab === 'analysis' ? '' : 'hidden'}>
          <AnalysisTab {...analysisProps} />
        </div>
        <div className={`h-full ${activeTab === 'ask' ? '' : 'hidden'}`}>
          <AskPanel {...askProps} />
        </div>
        <div className={`p-3 ${activeTab === 'report' ? '' : 'hidden'}`}>
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
        <div className={activeTab === 'gallery' ? '' : 'hidden'}>
          <Gallery projectId={projectId} refreshKey={galleryKey} />
        </div>
        <div className={`h-full ${activeTab === 'highlights' ? '' : 'hidden'}`}>
          <HighlightsPanel
            projectId={projectId}
            canEdit={callerCanEdit}
            Img={AuthenticatedImg}
            ScreenshotPicker={ScreenshotModal}
            refreshKey={highlightsKey}
            defaultTarget={selectedFilePath ? { type: 'FILE', ref: selectedFilePath } : null}
            onNavigate={(h) => { if (h.type === 'FILE' && h.targetRef) onOpenFile(h.targetRef) }}
          />
        </div>
        <div className={activeTab === 'renames' ? '' : 'hidden'}>
          <Renames projectId={projectId} refreshKey={renamesKey} onMutation={onRenameMutation} />
        </div>
        <div className={activeTab === 'crypto' ? '' : 'hidden'}>
          <Crypto
            projectId={projectId}
            credentialId={credentialId}
            model={model}
            onOpenFile={onOpenFile}
          />
        </div>
        <div className={activeTab === 'callchain' ? '' : 'hidden'}>
          <CallChain
            projectId={projectId}
            start={chainStart}
            credentialId={credentialId}
            model={model}
            onOpenFile={(f, l) => onOpenFile(f, l)}
          />
        </div>
        <div className={activeTab === 'network' ? '' : 'hidden'}>
          <Network projectId={projectId} onOpenFile={(f, l) => onOpenFile(f, l)} />
        </div>
        <div className={activeTab === 'dbs' ? '' : 'hidden'}>
          <DbSchemas projectId={projectId} onOpenFile={(f, l) => onOpenFile(f, l)} />
        </div>
        <div className={activeTab === 'entrypoints' ? '' : 'hidden'}>
          <EntryPoints projectId={projectId} onOpenFile={(f, l) => onOpenFile(f, l)} />
        </div>
        <div className={`h-full ${activeTab === 'native' ? '' : 'hidden'}`}>
          <NativeBridge projectId={projectId} onOpenFile={(f, l) => onOpenFile(f, l)} />
        </div>
        <div className={`flex h-full flex-col ${activeTab === 'tools' ? '' : 'hidden'}`}>
          <StringTools />
        </div>
      </div>
    </aside>
  )
}

function TabButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`border-b-2 px-4 py-2 text-sm transition-colors ${
        active
          ? 'border-purple-400 text-zinc-100'
          : 'border-transparent text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  )
}

// =========================================================================
// Analysis tab
// =========================================================================

function AnalysisTab({
  mode, onMode, analyzing, analyzeElapsed, onRun, analysis, onHotspotOpen,
}: AnalysisTabProps) {
  const callerCanEdit = useCanEdit()
  return (
    <div className="space-y-4 p-3">
      <div className="space-y-2 rounded border border-zinc-800 bg-zinc-950/40 p-3">
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wide text-zinc-500">Mode</span>
          <select
            value={mode}
            onChange={e => onMode(e.target.value as Mode)}
            disabled={!callerCanEdit}
            title={!callerCanEdit ? 'Viewer access — analysis mode is owner/editor-only.' : undefined}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 disabled:opacity-50"
          >
            <option value="MALWARE">Malware Analysis</option>
            <option value="VULN_RESEARCH">Vulnerability Research</option>
          </select>
        </label>
        <button
          onClick={onRun}
          disabled={!callerCanEdit || analyzing}
          title={!callerCanEdit ? 'Viewer access — running analysis is owner/editor-only.' : undefined}
          className="w-full rounded bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
        >
          {analyzing ? `Analyzing… ${analyzeElapsed}s` : 'Run Analysis'}
        </button>
      </div>

      {analysis && (
        <>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Summary</h3>
              <span className="text-[10px] text-zinc-500">
                in {analysis.inputTokens.toLocaleString()} · out {analysis.outputTokens.toLocaleString()}
                {' '}{estimateCost(analysis.model, analysis.inputTokens, analysis.outputTokens)}
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-200">{analysis.summary}</p>
          </div>

          {analysis.hotspots.length > 0 && (
            <div>
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Hotspots</h3>
              <ul className="mt-2 space-y-2">
                {analysis.hotspots.map((h, i) => (
                  <li key={i} className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
                    <div className="flex items-center gap-2">
                      <SeverityPill severity={h.severity} />
                      <button
                        onClick={() => onHotspotOpen(h.path)}
                        className="truncate text-left font-mono text-[11px] text-purple-300 hover:underline"
                        title={h.path}
                      >
                        {h.path}
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-zinc-300">{h.reason}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.nextSteps.length > 0 && (
            <div>
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Next steps</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-zinc-300">
                {analysis.nextSteps.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          {analysis.iocs.length > 0 && (
            <div>
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                IoCs ({analysis.iocs.length})
              </h3>
              <ul className="mt-2 max-h-64 overflow-auto rounded border border-zinc-800 bg-zinc-950/40">
                {analysis.iocs.map((ioc, i) => (
                  <li
                    key={i}
                    className="flex items-baseline gap-2 border-b border-zinc-900 px-2 py-1 font-mono text-[11px] last:border-b-0"
                  >
                    <span className="w-10 shrink-0 text-zinc-500">{ioc.type}</span>
                    <span className="flex-1 truncate text-zinc-200" title={ioc.value}>{ioc.value}</span>
                    <span className="text-zinc-600">×{ioc.occurrences}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SeverityPill({ severity }: { severity: string }) {
  const s = severity.toLowerCase()
  const styles = s === 'high' ? 'bg-red-950/60 text-red-300' :
                 s === 'low'  ? 'bg-zinc-800 text-zinc-300' :
                                'bg-amber-950/60 text-amber-300'
  return <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${styles}`}>{severity}</span>
}

// Ask tab implementation lives in components/AskPanel.tsx — multi-session
// chat with history sidebar, per-file / shared mode toggle, and per-message
// markdown copy.

// =========================================================================
// Code viewer + file tree
// =========================================================================

function HighlightedCode({
  code, path, scrollToLine,
}: { code: string; path: string; scrollToLine: number | null }) {
  const [html, setHtml] = useState<string | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setHtml(null)
    const lang = detectLang(path)
    void highlight(code, lang).then(h => { if (!cancelled) setHtml(h) })
    return () => { cancelled = true }
  }, [code, path])

  useEffect(() => {
    if (html === null || scrollToLine === null || scrollToLine < 1) return
    const host = hostRef.current
    if (!host) return
    const lines = host.querySelectorAll<HTMLElement>('.line')
    const el = lines[scrollToLine - 1]
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('search-flash')
    const t = setTimeout(() => el.classList.remove('search-flash'), 1600)
    return () => clearTimeout(t)
  }, [html, scrollToLine])

  if (html === null) {
    return (
      <pre className="p-4 font-mono text-[15px] leading-7 text-zinc-300 whitespace-pre">
        {code}
      </pre>
    )
  }
  return (
    <div
      ref={hostRef}
      className="shiki-host p-4 font-mono"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function FileTreeNode({
  node, depth, selected, onOpen,
}: {
  node: FileNode; depth: number; selected: string | null; onOpen: (path: string) => void
}) {
  const [open, setOpen] = useState(depth < 1)

  if (node.type === 'dir') {
    return (
      <div>
        <button
          onClick={() => setOpen(o => !o)}
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm text-zinc-300 hover:bg-zinc-800"
          style={{ paddingLeft: depth * 12 + 4 }}
        >
          <span className="w-3 text-zinc-500">{open ? '▾' : '▸'}</span>
          <span>{node.name === '/' ? '(root)' : node.name}</span>
        </button>
        {open && node.children && (
          <div>
            {node.children.map(child => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selected={selected}
                onOpen={onOpen}
              />
            ))}
          </div>
        )}
      </div>
    )
  }
  const isSel = selected === node.path
  return (
    <button
      onClick={() => onOpen(node.path)}
      className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm ${
        isSel ? 'bg-purple-900/40 text-purple-200' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
      }`}
      style={{ paddingLeft: depth * 12 + 16 }}
    >
      <span className="truncate">{node.name}</span>
    </button>
  )
}
