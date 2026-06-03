import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '../api/client'
import { highlight } from '../syntax/highlight'

// =========================================================================
// Types — must mirror NativeLibraryView + extract.py's JSON shape
// =========================================================================

type NativeStatus = 'PENDING' | 'RUNNING' | 'READY' | 'FAILED'

type NativeLibrary = {
  libPath: string
  arch: string
  sizeBytes: number
  status: NativeStatus | null
  errorMessage: string | null
  analyzedAt: string | null
}

type NativeFunction = {
  name: string
  address: string
  size: number
  signature: string
  decompiled: string | null
  external: boolean
  thunk: boolean
}

type NativeAnalysisResult = {
  functions: NativeFunction[]
  strings: string[]
  imports: string[]
  metadata: {
    compiler?: string
    language?: string
    executable_format?: string
    image_base?: string
    function_count?: number
    string_count?: number
    import_count?: number
    arch?: string
    bytes?: number
    filename?: string
  }
}

type InnerTab = 'functions' | 'strings' | 'imports' | 'metadata'

/**
 * Browser-style navigation stack across in-binary function jumps. All
 * entries are function addresses, never names — see {@link NativeViewer}.
 */
type NavHistory = {
  back: string[]
  current: string | null
  forward: string[]
}

/**
 * C keywords / common types we never want to decorate as clickable, even if
 * a user pathologically renames a function to one of these later. Short list,
 * not exhaustive — covers what Ghidra's pseudo-C actually emits.
 */
const C_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'return', 'break', 'continue',
  'switch', 'case', 'default', 'goto', 'sizeof', 'typedef', 'struct',
  'union', 'enum', 'static', 'const', 'extern', 'volatile', 'register',
  'inline', 'restrict', 'auto', 'void', 'char', 'short', 'int', 'long',
  'float', 'double', 'signed', 'unsigned', '_Bool', 'true', 'false',
  'NULL', 'null',
])

/**
 * Post-process shiki HTML to wrap in-binary function-name tokens in
 * clickable spans. Internal names get {@code data-fn-addr=<address>} (the
 * IMMUTABLE identity — when rename ships, the display text gets overlaid
 * but this code path stays the same). External imports get a dimmed style
 * with no nav.
 *
 * <p>We match only flat leaf {@code <span>} tokens which is the shape shiki
 * produces — one identifier per span. False positives (a function name
 * appearing inside a string literal) are decorated but won't navigate
 * anywhere harmful.
 */
function decorateCalls(
  html: string,
  nameToAddr: Map<string, string>,
  externalNames: Set<string>,
): string {
  if (nameToAddr.size === 0 && externalNames.size === 0) return html
  return html.replace(/<span([^>]*?)>([^<]+)<\/span>/g, (full, _attrs, text: string) => {
    const decoded = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
    // Shiki bundles leading indentation whitespace into the same span as the
    // identifier (e.g. "  FUN_0002f840"), so trim before lookup. Only accept
    // when the trimmed content is exactly one C identifier — anything else
    // (multiple tokens, punctuation, etc.) is not a navigable symbol.
    const stripped = decoded.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(stripped)) return full
    const addr = nameToAddr.get(stripped)
    if (addr) {
      return `<span class="fn-link" data-fn-addr="${addr}" role="link" tabindex="0">${full}</span>`
    }
    if (externalNames.has(stripped)) {
      return `<span class="fn-extern" title="External — resolved at runtime">${full}</span>`
    }
    return full
  })
}

/**
 * Single-library native analysis viewer. Rendered IN PLACE of the
 * binary-file message in the center file viewer when the user clicks a
 * .so under {@code resources/lib/<abi>/}.
 *
 * Per-lib lifecycle:
 *  - Loads the library status from /native/libraries on mount / libPath change
 *  - Polls every 5s while status is PENDING / RUNNING
 *  - Fetches /native/result once READY
 *
 * Layout: header (arch chip + filename + status + Analyze button) on top,
 * Functions / Strings / Imports / Metadata tabs below. Functions is split-
 * pane (list on the left ~1/3, decompiled C on the right ~2/3) because we
 * have the whole center pane to play with now.
 */
export function NativeViewer({ projectId, libPath }: { projectId: string; libPath: string }) {
  const api = useApi()
  const [lib, setLib] = useState<NativeLibrary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<NativeAnalysisResult | null>(null)
  const [resultLoading, setResultLoading] = useState(false)
  const [innerTab, setInnerTab] = useState<InnerTab>('functions')
  // Navigation history — keyed by function address (the IMMUTABLE identity).
  // Names can change (Ghidra default → user rename), addresses cannot, so
  // when rename ships later the navigation code stays untouched.
  const [history, setHistory] = useState<NavHistory>({ back: [], current: null, forward: [] })
  const [functionFilter, setFunctionFilter] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const navigate = useCallback((addr: string | null) => {
    setHistory(h => {
      if (addr === h.current) return h
      if (addr === null) return { ...h, current: null }
      return {
        back: h.current ? [...h.back, h.current] : h.back,
        current: addr,
        forward: [],
      }
    })
  }, [])

  const goBack = useCallback(() => {
    setHistory(h => {
      if (h.back.length === 0) return h
      const prev = h.back[h.back.length - 1]
      return {
        back: h.back.slice(0, -1),
        current: prev,
        forward: h.current ? [h.current, ...h.forward] : h.forward,
      }
    })
  }, [])

  const goForward = useCallback(() => {
    setHistory(h => {
      if (h.forward.length === 0) return h
      const next = h.forward[0]
      return {
        back: h.current ? [...h.back, h.current] : h.back,
        current: next,
        forward: h.forward.slice(1),
      }
    })
  }, [])

  const loadLib = useCallback(async () => {
    setError(null)
    try {
      const all = await api<NativeLibrary[]>(`/api/projects/${projectId}/native/libraries`)
      const found = all.find(l => l.libPath === libPath) ?? null
      setLib(found)
      return found
    } catch (e) {
      setError((e as Error).message)
      return null
    }
  }, [api, projectId, libPath])

  // Re-fetch whenever the user opens a different .so. Clear stale result so
  // we don't briefly show the previous lib's functions under the new header.
  useEffect(() => {
    setResult(null)
    setHistory({ back: [], current: null, forward: [] })
    setFunctionFilter('')
    setLoading(true)
    void loadLib().finally(() => setLoading(false))
  }, [loadLib])

  // Poll while in-flight, stop the moment we settle.
  useEffect(() => {
    const inFlight = lib?.status === 'PENDING' || lib?.status === 'RUNNING'
    if (!inFlight) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }
    if (pollRef.current) return
    pollRef.current = setInterval(() => {
      void loadLib()
    }, 5000)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [lib?.status, loadLib])

  // Fetch the result the moment status flips to READY (or analyzedAt advances
  // after a re-analyze). The library list above doesn't carry the JSON.
  useEffect(() => {
    if (lib?.status !== 'READY') return
    setResultLoading(true)
    api<NativeAnalysisResult>(
      `/api/projects/${projectId}/native/result?libPath=${encodeURIComponent(libPath)}`,
    )
      .then(r => setResult(r))
      .catch(e => setError((e as Error).message))
      .finally(() => setResultLoading(false))
  }, [lib?.status, lib?.analyzedAt, api, projectId, libPath])

  const kickoff = useCallback(async () => {
    if (!lib) return
    const before = lib
    setLib({ ...lib, status: 'PENDING', errorMessage: null })
    try {
      const updated = await api<NativeLibrary>(
        `/api/projects/${projectId}/native/analyze`,
        {
          method: 'POST',
          body: JSON.stringify({ libPath }),
        },
      )
      setLib(updated)
    } catch (e) {
      setLib(before)
      setError((e as Error).message)
    }
  }, [api, lib, projectId, libPath])

  if (loading && !lib) {
    return <p className="p-4 text-sm text-zinc-500">Loading native library…</p>
  }
  if (!lib) {
    return (
      <div className="p-4">
        <p className="text-sm text-zinc-400">
          Native library record not available. Try refreshing the page.
        </p>
        {error && (
          <pre className="mt-2 overflow-auto rounded border border-red-900/60 bg-red-950/40 p-2 text-[11px] text-red-300/90">
            {error}
          </pre>
        )}
      </div>
    )
  }

  const filename = libPath.substring(libPath.lastIndexOf('/') + 1)
  const inFlight = lib.status === 'PENDING' || lib.status === 'RUNNING'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-zinc-800 bg-zinc-950/50 px-4 py-3">
        <div className="flex items-baseline gap-3">
          <span className="shrink-0 rounded border border-amber-700/60 bg-amber-900/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-amber-300">
            {lib.arch}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-sm text-zinc-100" title={libPath}>
            {filename}
          </span>
          <StatusBadge status={lib.status} />
          <span className="shrink-0 font-mono text-[11px] text-zinc-500">
            {fmtBytes(lib.sizeBytes)}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] text-zinc-500">
            {libPath}
            {lib.analyzedAt && (
              <>
                {' '}<span className="text-zinc-600">·</span>{' '}
                analyzed {relTime(lib.analyzedAt)}
              </>
            )}
          </p>
          <button
            onClick={() => void kickoff()}
            disabled={inFlight}
            className="shrink-0 rounded border border-amber-700/60 bg-amber-900/20 px-3 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-800/30 disabled:opacity-40"
          >
            {inFlight
              ? lib.status === 'PENDING' ? 'Queued…' : 'Analyzing…'
              : lib.status === 'READY' ? 'Re-analyze' : 'Analyze'}
          </button>
        </div>
        {error && (
          <pre className="mt-2 max-h-32 overflow-auto rounded border border-red-900/60 bg-red-950/40 p-2 text-[11px] text-red-300/90">
            {error}
          </pre>
        )}
        {lib.errorMessage && (
          <pre className="mt-2 max-h-40 overflow-auto rounded border border-red-900/60 bg-red-950/40 p-2 font-mono text-[11px] text-red-300/90">
            {lib.errorMessage}
          </pre>
        )}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {lib.status === null ? (
          <PromptPanel
            title="Not analyzed yet"
            body='Click "Analyze" above to dispatch this binary to Ghidra. Expect 30 seconds to several minutes depending on size.'
          />
        ) : lib.status === 'PENDING' ? (
          <PromptPanel
            title="Queued"
            body="Waiting for a worker slot. Status refreshes every 5 seconds."
          />
        ) : lib.status === 'RUNNING' ? (
          <PromptPanel
            title="Ghidra is analyzing"
            body="This takes 30 seconds to several minutes per binary. Page updates automatically when finished."
          />
        ) : lib.status === 'FAILED' ? (
          <PromptPanel
            title="Analysis failed"
            body="See the error message above for details. Click Re-analyze to try again."
          />
        ) : !result ? (
          <PromptPanel
            title={resultLoading ? 'Loading result…' : 'Awaiting result'}
            body=""
          />
        ) : (
          <ResultPanel
            result={result}
            innerTab={innerTab}
            onInnerTab={setInnerTab}
            openFunctionAddr={history.current}
            onNavigate={navigate}
            onBack={goBack}
            onForward={goForward}
            canBack={history.back.length > 0}
            canForward={history.forward.length > 0}
            functionFilter={functionFilter}
            onFunctionFilter={setFunctionFilter}
          />
        )}
      </div>
    </div>
  )
}

// =========================================================================
// Helpers
// =========================================================================

function StatusBadge({ status }: { status: NativeStatus | null }) {
  if (status === null) {
    return (
      <span className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-400">
        none
      </span>
    )
  }
  const style: Record<NativeStatus, string> = {
    PENDING: 'border-zinc-600 bg-zinc-800 text-zinc-300',
    RUNNING: 'border-amber-700 bg-amber-900/40 text-amber-300',
    READY: 'border-emerald-700 bg-emerald-900/40 text-emerald-300',
    FAILED: 'border-red-800 bg-red-950/50 text-red-300',
  }
  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${style[status]}`}>
      {status.toLowerCase()}
    </span>
  )
}

function PromptPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium text-zinc-200">{title}</p>
        {body && <p className="mt-2 text-xs leading-relaxed text-zinc-500">{body}</p>}
      </div>
    </div>
  )
}

function ResultPanel({
  result,
  innerTab,
  onInnerTab,
  openFunctionAddr,
  onNavigate,
  onBack,
  onForward,
  canBack,
  canForward,
  functionFilter,
  onFunctionFilter,
}: {
  result: NativeAnalysisResult
  innerTab: InnerTab
  onInnerTab: (t: InnerTab) => void
  openFunctionAddr: string | null
  onNavigate: (addr: string | null) => void
  onBack: () => void
  onForward: () => void
  canBack: boolean
  canForward: boolean
  functionFilter: string
  onFunctionFilter: (s: string) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-zinc-800 bg-zinc-950/30 px-2">
        <InnerTabButton active={innerTab === 'functions'} onClick={() => onInnerTab('functions')}>
          Functions <span className="font-mono text-[9px] text-zinc-500">({result.functions.length})</span>
        </InnerTabButton>
        <InnerTabButton active={innerTab === 'strings'} onClick={() => onInnerTab('strings')}>
          Strings <span className="font-mono text-[9px] text-zinc-500">({result.strings.length})</span>
        </InnerTabButton>
        <InnerTabButton active={innerTab === 'imports'} onClick={() => onInnerTab('imports')}>
          Imports <span className="font-mono text-[9px] text-zinc-500">({result.imports.length})</span>
        </InnerTabButton>
        <InnerTabButton active={innerTab === 'metadata'} onClick={() => onInnerTab('metadata')}>
          Metadata
        </InnerTabButton>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {innerTab === 'functions' && (
          <FunctionsPanel
            functions={result.functions}
            imports={result.imports}
            openAddr={openFunctionAddr}
            onNavigate={onNavigate}
            onBack={onBack}
            onForward={onForward}
            canBack={canBack}
            canForward={canForward}
            filter={functionFilter}
            onFilter={onFunctionFilter}
          />
        )}
        {innerTab === 'strings' && <StringsPanel strings={result.strings} />}
        {innerTab === 'imports' && <ImportsPanel imports={result.imports} />}
        {innerTab === 'metadata' && <MetadataPanel metadata={result.metadata} />}
      </div>
    </div>
  )
}

function InnerTabButton({
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
      className={`px-3 py-2 text-xs font-medium ${
        active
          ? 'border-b-2 border-amber-500 text-amber-200'
          : 'border-b-2 border-transparent text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  )
}

function FunctionsPanel({
  functions,
  imports,
  openAddr,
  onNavigate,
  onBack,
  onForward,
  canBack,
  canForward,
  filter,
  onFilter,
}: {
  functions: NativeFunction[]
  imports: string[]
  openAddr: string | null
  onNavigate: (addr: string | null) => void
  onBack: () => void
  onForward: () => void
  canBack: boolean
  canForward: boolean
  filter: string
  onFilter: (s: string) => void
}) {
  // Build the click-to-jump lookup once per result. Address is the key
  // because names are mutable (rename ships later); skip C keywords so a
  // user can't pathologically rename a function to `if` and break the body.
  const { nameToAddr, externalNames } = useMemo(() => {
    const nameToAddr = new Map<string, string>()
    const externalNames = new Set<string>()
    for (const fn of functions) {
      if (!fn.name || C_KEYWORDS.has(fn.name)) continue
      if (fn.external) {
        externalNames.add(fn.name)
      } else if (!nameToAddr.has(fn.name)) {
        nameToAddr.set(fn.name, fn.address)
      }
    }
    for (const imp of imports) {
      // imports are typically bare names like "strncmp" — strip libc decoration
      // ("strncmp@@GLIBC_2.17") so the decompiled body's plain "strncmp" matches.
      const bare = imp.split('@')[0].trim()
      if (bare && !C_KEYWORDS.has(bare) && !nameToAddr.has(bare)) externalNames.add(bare)
    }
    return { nameToAddr, externalNames }
  }, [functions, imports])

  const f = filter.trim().toLowerCase()
  const filtered = f
    ? functions.filter(fn => fn.name.toLowerCase().includes(f) || fn.address.toLowerCase().includes(f))
    : functions
  const openFn = openAddr ? functions.find(fn => fn.address === openAddr) ?? null : null
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-zinc-800/80 bg-black/20 p-2">
        <input
          value={filter}
          onChange={e => onFilter(e.target.value)}
          placeholder="filter by name or address…"
          className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-100 placeholder:text-zinc-600"
        />
        <p className="mt-1 font-mono text-[10px] text-zinc-500">
          {filtered.length} / {functions.length}
          {functions.length === 5000 && <span className="ml-2 text-amber-400">· capped at 5000</span>}
        </p>
      </div>
      <div className="flex min-h-0 flex-1">
        <ul className="w-80 shrink-0 overflow-auto border-r border-zinc-800/80">
          {filtered.slice(0, 1500).map(fn => {
            const isJni = fn.name.startsWith('Java_')
            return (
              <li key={fn.address}>
                <button
                  onClick={() => onNavigate(fn.address === openAddr ? null : fn.address)}
                  className={`flex w-full items-baseline gap-2 px-2 py-1 text-left text-xs hover:bg-zinc-900/60 ${
                    fn.address === openAddr ? 'bg-amber-950/30' : ''
                  }`}
                  title={fn.signature || fn.name}
                >
                  {isJni && (
                    <span className="shrink-0 rounded border border-purple-700 bg-purple-950/40 px-1 font-mono text-[9px] uppercase text-purple-300">
                      JNI
                    </span>
                  )}
                  {fn.external && (
                    <span className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-1 font-mono text-[9px] uppercase text-zinc-400">
                      ext
                    </span>
                  )}
                  {fn.thunk && (
                    <span className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-1 font-mono text-[9px] uppercase text-zinc-400">
                      thunk
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-zinc-200">{fn.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-500">{fn.address}</span>
                </button>
              </li>
            )
          })}
          {filtered.length > 1500 && (
            <li className="px-2 py-2 text-center text-[10px] text-zinc-500">
              … {filtered.length - 1500} more — narrow the filter
            </li>
          )}
          {filtered.length === 0 && (
            <li className="px-2 py-2 text-center text-[10px] text-zinc-500">no functions match</li>
          )}
        </ul>
        <div className="min-w-0 flex-1 overflow-auto bg-black/30">
          {!openFn ? (
            <p className="p-4 text-xs text-zinc-500">
              Select a function on the left to view its decompiled pseudo-C.
              Function names inside the body are clickable — single-click jumps
              to definition.
            </p>
          ) : (
            <div className="p-3">
              <div className="mb-3 flex items-start gap-2">
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={onBack}
                    disabled={!canBack}
                    className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
                    title="Back"
                    aria-label="Back"
                  >
                    ←
                  </button>
                  <button
                    onClick={onForward}
                    disabled={!canForward}
                    className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
                    title="Forward"
                    aria-label="Forward"
                  >
                    →
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="wrap-break-word font-mono text-sm text-zinc-100">{openFn.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                    {openFn.address} · {openFn.size} bytes
                  </p>
                  {openFn.signature && (
                    <p className="mt-1 wrap-break-word font-mono text-[11px] text-zinc-400">
                      {openFn.signature}
                    </p>
                  )}
                </div>
              </div>
              {openFn.decompiled ? (
                <DecompiledCode
                  code={openFn.decompiled}
                  nameToAddr={nameToAddr}
                  externalNames={externalNames}
                  onNavigate={onNavigate}
                />
              ) : (
                <p className="text-xs text-zinc-500">
                  {openFn.external
                    ? 'External — defined in another binary.'
                    : openFn.thunk
                      ? 'Thunk — wrapper for another function.'
                      : 'No decompilation available.'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Renders Ghidra's pseudo-C output with shiki C highlighting and decorates
 * in-binary function-name tokens as clickable jumps-to-definition. Plain
 * pre while shiki's WASM engine spins up on first use, swap to decorated
 * HTML once ready. Cleanup flag avoids setting state on a stale function
 * when the user navigates mid-highlight.
 *
 * <p>Decoration is keyed by {@code data-fn-addr} — the address is the
 * immutable identity, so future rename rewrites display text only and this
 * component doesn't need to change.
 */
function DecompiledCode({
  code,
  nameToAddr,
  externalNames,
  onNavigate,
}: {
  code: string
  nameToAddr: Map<string, string>
  externalNames: Set<string>
  onNavigate: (addr: string) => void
}) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setHtml(null)
    void highlight(code, 'c').then(h => {
      if (!cancelled) setHtml(decorateCalls(h, nameToAddr, externalNames))
    })
    return () => { cancelled = true }
  }, [code, nameToAddr, externalNames])

  const onClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement | null
    const link = target?.closest('[data-fn-addr]') as HTMLElement | null
    if (link?.dataset.fnAddr) {
      e.preventDefault()
      onNavigate(link.dataset.fnAddr)
    }
  }, [onNavigate])

  if (html === null) {
    return (
      <pre className="overflow-x-auto whitespace-pre rounded border border-zinc-800 bg-black/60 p-3 font-mono text-xs leading-relaxed text-zinc-200">
        {code}
      </pre>
    )
  }
  return (
    <div
      className="shiki-host overflow-x-auto rounded border border-zinc-800 bg-black/60 p-3 font-mono text-xs leading-relaxed [&_.fn-link]:cursor-pointer [&_.fn-link]:rounded-sm [&_.fn-link]:border-b [&_.fn-link]:border-dotted [&_.fn-link]:border-zinc-600 hover:[&_.fn-link]:border-amber-400 hover:[&_.fn-link]:bg-amber-950/30 [&_.fn-extern]:opacity-60"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function StringsPanel({ strings }: { strings: string[] }) {
  const [filter, setFilter] = useState('')
  const f = filter.trim().toLowerCase()
  const filtered = f ? strings.filter(s => s.toLowerCase().includes(f)) : strings
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-zinc-800/80 bg-black/20 p-2">
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="filter strings…"
          className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-100 placeholder:text-zinc-600"
        />
        <p className="mt-1 font-mono text-[10px] text-zinc-500">
          {filtered.length} / {strings.length}
          {strings.length === 5000 && <span className="ml-2 text-amber-400">· capped at 5000</span>}
        </p>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto">
        {filtered.slice(0, 2000).map((s, i) => (
          <li
            key={`${i}-${s}`}
            className="border-b border-zinc-900/60 px-2 py-1 font-mono text-xs text-zinc-200"
          >
            {s}
          </li>
        ))}
        {filtered.length > 2000 && (
          <li className="px-2 py-2 text-center text-[10px] text-zinc-500">
            … {filtered.length - 2000} more — narrow the filter
          </li>
        )}
        {filtered.length === 0 && (
          <li className="px-2 py-2 text-center text-[10px] text-zinc-500">no strings match</li>
        )}
      </ul>
    </div>
  )
}

function ImportsPanel({ imports }: { imports: string[] }) {
  return (
    <ul className="h-full overflow-auto divide-y divide-zinc-900/60">
      {imports.map((s, i) => (
        <li key={`${i}-${s}`} className="px-2 py-1 font-mono text-xs text-zinc-200">
          {s}
        </li>
      ))}
      {imports.length === 0 && (
        <li className="px-2 py-2 text-xs text-zinc-500">No external imports detected.</li>
      )}
    </ul>
  )
}

function MetadataPanel({ metadata }: { metadata: NativeAnalysisResult['metadata'] }) {
  const rows: Array<[string, string | number | undefined]> = [
    ['Compiler', metadata.compiler],
    ['Language', metadata.language],
    ['Format', metadata.executable_format],
    ['Image base', metadata.image_base],
    ['Arch', metadata.arch],
    ['Filename', metadata.filename],
    ['Size (bytes)', metadata.bytes],
    ['Functions', metadata.function_count],
    ['Strings', metadata.string_count],
    ['Imports', metadata.import_count],
  ]
  return (
    <dl className="h-full overflow-auto divide-y divide-zinc-900/60">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[140px_1fr] gap-3 px-3 py-2">
          <dt className="text-xs text-zinc-400">{k}</dt>
          <dd className="wrap-break-word font-mono text-xs text-zinc-200">
            {v === undefined || v === '' ? <span className="text-zinc-600">—</span> : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

// =========================================================================
// Formatting
// =========================================================================

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function relTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const diffSec = Math.floor((Date.now() - then) / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}
