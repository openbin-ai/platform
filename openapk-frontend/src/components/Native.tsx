import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { API_BASE, useApi } from '../api/client'
import { useCanEdit } from '@shared/components/ProjectRoleContext'
import { highlight } from '../syntax/highlight'

// =========================================================================
// Types — must mirror NativeLibraryView + extract.py's JSON shape
// =========================================================================

type NativeStatus = 'PENDING' | 'RUNNING' | 'INGEST_PENDING' | 'READY' | 'FAILED'

type NativeLibrary = {
  libPath: string
  arch: string
  sizeBytes: number
  status: NativeStatus | null
  errorMessage: string | null
  analyzedAt: string | null
}

type DisasmLine = { addr: string; text: string }
// Cross-highlight maps from extract.py (decompiled functions only). line_map:
// [lineNo (1-based), [instruction addrs]]; vars: variable name -> referencing
// instruction addrs. Optional/nullable — absent on pre-feature analyses, in
// which case the disassembly pane still renders but cross-highlight is inert.
type LineMap = [number, string[]][]
type VarRef = { name: string; addrs: string[] }
type NativeFunction = {
  name: string
  address: string
  size: number
  signature: string
  decompiled: string | null
  disassembly?: DisasmLine[] | null
  line_map?: LineMap | null
  vars?: VarRef[] | null
  external: boolean
  thunk: boolean
}

// Active cross-highlight selection shared by the pseudocode + disassembly
// panes (Ghidra-style follow-along). vars: variable names to glow in both
// panes; lines: 1-based decompiled lines to glow; addrs: instruction
// addresses to glow in the disassembly.
type Cross = { vars: string[]; lines: number[]; addrs: Set<string> }

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

// Persisted side-by-side preference for the native code view.
const NATIVE_SPLIT_KEY = 'openapk.nativeCodeSplitView'

function tabCls(active: boolean): string {
  return `rounded px-2 py-1 text-[11px] ${
    active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800'
  } disabled:opacity-30`
}

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
  varNames: ReadonlySet<string>,
): string {
  if (nameToAddr.size === 0 && externalNames.size === 0 && varNames.size === 0) return html
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
    // Decompiled variable — clickable for cross-highlight (data-var). Wrapped
    // last so navigable symbols always win.
    if (varNames.has(stripped)) {
      return `<span class="var-token" data-var="${stripped}">${full}</span>`
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
  const callerCanEdit = useCanEdit()
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
  const [cliModalOpen, setCliModalOpen] = useState(false)
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

  // Poll while in-flight, stop the moment we settle. INGEST_PENDING is
  // included because the CLI flow leaves the row in that state until
  // /finalize lands — the OpenAPK UI needs to notice the flip to READY
  // even though the user (not the backend) is the one driving the work.
  useEffect(() => {
    const inFlight =
      lib?.status === 'PENDING' ||
      lib?.status === 'RUNNING' ||
      lib?.status === 'INGEST_PENDING'
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
          {/* Cloud Ghidra worker is scaled to 0. The "Decompile via CLI"
              button opens a modal that walks the user through downloading
              the .so + pasting the openbin attach-native command. Re-shown
              even after READY so the user can re-run on a fresh Ghidra
              version (initiate resets the row). */}
          <button
            type="button"
            onClick={() => setCliModalOpen(true)}
            disabled={!callerCanEdit}
            className="shrink-0 rounded bg-amber-400 px-3 py-1 text-[11px] font-semibold text-black shadow-[0_2px_12px_rgba(251,191,36,0.3)] hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            title={
              !callerCanEdit
                ? 'Viewer access — decompilation is owner/editor-only.'
                : 'Run Ghidra locally via the openbin CLI and upload the result here'
            }
          >
            {lib.status === 'READY' ? 'Re-decompile via CLI' : 'Decompile via CLI'}
          </button>
        </div>
        <GhidraSunsetBanner />
        {/* `kickoff` retained for the future when cloud Ghidra comes back —
            wiring stays intact behind the disabled button so re-enabling
            is one prop flip. Reference it as a no-op so TS doesn't complain. */}
        <span className="hidden" data-kickoff-ref={typeof kickoff} data-in-flight={inFlight} />
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
        ) : lib.status === 'INGEST_PENDING' ? (
          <PromptPanel
            title="Waiting for your CLI run"
            body='Decompile this lib locally with `openbin attach-native` and the result will appear here automatically. Reopen "Decompile via CLI" above for the exact command.'
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
      {cliModalOpen && (
        <CliDecompileModal
          projectId={projectId}
          libPath={libPath}
          filename={filename}
          status={lib.status}
          onClose={() => setCliModalOpen(false)}
        />
      )}
    </div>
  )
}

// =========================================================================
// CLI decompile modal
// =========================================================================

/**
 * Walks the user through the local-Ghidra flow:
 *   1. Download the .so from the project workspace
 *   2. Run {@code openbin attach-native} with the pre-filled command
 *   3. Wait for the row to flip to READY (parent polls /libraries)
 *
 * Self-closes when {@code status} flips to READY — the parent's polling
 * useEffect drives the prop change, this just listens for it.
 */
function CliDecompileModal({
  projectId,
  libPath,
  filename,
  status,
  onClose,
}: {
  projectId: string
  libPath: string
  filename: string
  status: NativeStatus | null
  onClose: () => void
}) {
  const auth = useAuth()
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Auto-close on READY. Done via effect rather than wrapping setLib so
  // a manual close still works and a re-decompile (which puts the row
  // back into INGEST_PENDING) keeps the modal open.
  useEffect(() => {
    if (status === 'READY') {
      const t = setTimeout(() => onClose(), 600) // brief "done" flash
      return () => clearTimeout(t)
    }
  }, [status, onClose])

  // The CLI command. project= UUID + lib-path stay verbatim so a paste-in
  // shell exec lands on the right project/lib without further editing.
  const command =
    `openbin attach-native \\\n` +
    `  --project=${projectId} \\\n` +
    `  --lib-path=${libPath} \\\n` +
    `  ./${filename}`

  const onCopy = useCallback(() => {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }, [command])

  // Fetch the raw .so with a Bearer token. useApi() JSON-parses responses
  // by content-type and would mangle the binary, so we go around it with
  // a plain fetch — mirrors the pattern called out in shared/api/client.ts
  // for "report download / print views" that need raw responses.
  const onDownload = useCallback(async () => {
    const token = auth.user?.access_token
    if (!token) {
      setDownloadError('Not signed in — refresh the page and try again.')
      return
    }
    setDownloading(true)
    setDownloadError(null)
    try {
      const resp = await fetch(
        `${API_BASE}/api/projects/${projectId}/file/raw?path=${encodeURIComponent(libPath)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!resp.ok) throw new Error(`status=${resp.status}`)
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // Free the blob URL on the next tick — too-eager revoke can cancel
      // the in-progress download in some browsers.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      setDownloadError((e as Error).message)
    } finally {
      setDownloading(false)
    }
  }, [auth, projectId, libPath, filename])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-xl rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="font-mono text-sm text-zinc-100">Decompile via CLI</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-4 text-[13px] text-zinc-300">
          <p className="text-xs text-zinc-500">
            Cloud Ghidra is disabled. Run it locally with the openbin CLI —
            decompile finishes on your machine, the JSON gets streamed
            straight to S3, this view updates automatically.
          </p>

          {/* Step 1: download */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">1</span>
              <span className="text-zinc-300">Download the .so to your machine</span>
            </div>
            <button
              type="button"
              onClick={() => void onDownload()}
              disabled={downloading}
              className="w-full rounded bg-zinc-800 px-3 py-2 text-left font-mono text-[12px] text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
            >
              {downloading ? 'Downloading…' : `↓ ${filename}`}
            </button>
            {downloadError && (
              <p className="mt-1 font-mono text-[11px] text-red-400">{downloadError}</p>
            )}
          </div>

          {/* Step 2: command */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">2</span>
                <span className="text-zinc-300">
                  Run from the directory you saved <code className="text-amber-300">{filename}</code> in
                </span>
              </div>
              <button
                type="button"
                onClick={onCopy}
                className="rounded bg-amber-400 px-2 py-0.5 font-mono text-[11px] font-semibold text-black hover:bg-amber-300"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="overflow-x-auto rounded border border-zinc-800 bg-black/60 p-3 font-mono text-[12px] leading-relaxed text-zinc-200">
{command}
            </pre>
            <p className="mt-1 text-[11px] text-zinc-500">
              Don&apos;t have the CLI yet?{' '}
              <a
                href="https://github.com/openbin-ai/platform/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-300 underline-offset-4 hover:underline"
              >
                Download here
              </a>
              .
            </p>
          </div>

          {/* Step 3: status */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">3</span>
              <span className="text-zinc-300">Wait for the result</span>
            </div>
            <CliStatusLine status={status} />
          </div>
        </div>
      </div>
    </div>
  )
}

function CliStatusLine({ status }: { status: NativeStatus | null }) {
  const label =
    status === 'READY' ? 'Done — closing this window'
    : status === 'INGEST_PENDING' ? 'Waiting for your CLI run to finish (polling every 5s)…'
    : status === 'FAILED' ? 'The last run failed — re-run the command to retry'
    : 'Run the command above; this view updates automatically.'
  const tone =
    status === 'READY' ? 'text-emerald-300'
    : status === 'FAILED' ? 'text-red-300'
    : 'text-zinc-400'
  return (
    <p className={`font-mono text-[12px] ${tone}`}>{label}</p>
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
    INGEST_PENDING: 'border-amber-700 bg-amber-900/40 text-amber-300',
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

  // Pseudocode/disassembly tab, side-by-side split (persisted), and the
  // cross-highlight follow-along selection (reset whenever the open function
  // changes; Escape clears it).
  const [codeTab, setCodeTab] = useState<'pseudo' | 'disasm'>('pseudo')
  const [split, setSplit] = useState<boolean>(() => {
    try { return localStorage.getItem(NATIVE_SPLIT_KEY) === '1' } catch { return false }
  })
  const toggleSplit = useCallback(() => {
    setSplit(s => {
      const next = !s
      try { localStorage.setItem(NATIVE_SPLIT_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])
  const [cross, setCross] = useState<Cross | null>(null)
  useEffect(() => { setCross(null) }, [openAddr])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setCross(null) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // Cross-highlight lookup maps derived from the open function's worker maps.
  const varNames = useMemo(() => new Set((openFn?.vars ?? []).map(v => v.name)), [openFn])
  const lineToAddrs = useMemo(() => {
    const m = new Map<number, string[]>()
    for (const [ln, addrs] of openFn?.line_map ?? []) m.set(ln, addrs)
    return m
  }, [openFn])
  const addrToLine = useMemo(() => {
    const m = new Map<string, number>()
    for (const [ln, addrs] of openFn?.line_map ?? []) for (const a of addrs) if (!m.has(a)) m.set(a, ln)
    return m
  }, [openFn])
  const varToAddrs = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const v of openFn?.vars ?? []) m.set(v.name, v.addrs)
    return m
  }, [openFn])
  const disasmAvailable = !!(openFn && openFn.disassembly && openFn.disassembly.length > 0)

  // Single delegated click handler for the code region: function-name jumps
  // (data-fn-addr) win, then variable / instruction / line cross-highlight.
  const handleCenterClick = useCallback((e: React.MouseEvent) => {
    const el = e.target as HTMLElement
    const fnEl = el.closest('[data-fn-addr]') as HTMLElement | null
    if (fnEl?.dataset.fnAddr) { e.preventDefault(); onNavigate(fnEl.dataset.fnAddr); return }
    const varEl = el.closest('[data-var]') as HTMLElement | null
    if (varEl?.dataset.var) {
      const name = varEl.dataset.var
      setCross({ vars: [name], lines: [], addrs: new Set(varToAddrs.get(name) ?? []) })
      return
    }
    const addrEl = el.closest('[data-addr]') as HTMLElement | null
    if (addrEl?.dataset.addr) {
      const addr = addrEl.dataset.addr
      const ln = addrToLine.get(addr)
      setCross({ vars: [], lines: ln != null ? [ln] : [], addrs: new Set([addr]) })
      return
    }
    const lineEl = el.closest('[data-ln]') as HTMLElement | null
    if (lineEl?.dataset.ln) {
      const ln = Number(lineEl.dataset.ln)
      setCross({ vars: [], lines: [ln], addrs: new Set(lineToAddrs.get(ln) ?? []) })
      return
    }
  }, [onNavigate, varToAddrs, addrToLine, lineToAddrs])

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
              {(openFn.decompiled || disasmAvailable) ? (
                <>
                  <div className="mb-2 flex items-center gap-1 border-b border-zinc-800/60 pb-1">
                    <button
                      onClick={() => setCodeTab('pseudo')}
                      disabled={!openFn.decompiled}
                      className={tabCls(codeTab === 'pseudo' && !split)}
                    >
                      Pseudocode
                    </button>
                    <button
                      onClick={() => setCodeTab('disasm')}
                      disabled={!disasmAvailable}
                      className={tabCls(codeTab === 'disasm' && !split)}
                    >
                      Disassembly
                    </button>
                    <button
                      onClick={toggleSplit}
                      disabled={!disasmAvailable || !openFn.decompiled}
                      title={split
                        ? 'Switch to single pane'
                        : 'Side-by-side: pseudocode + disassembly. Click a line, variable, or instruction to follow along across both.'}
                      className={`ml-auto rounded px-2 py-1 text-[11px] ${
                        split ? 'bg-amber-700/40 text-amber-100' : 'text-zinc-400 hover:bg-zinc-800'
                      } disabled:opacity-30`}
                    >
                      ⇆ Split
                    </button>
                  </div>
                  <div onClick={handleCenterClick}>
                    {split && disasmAvailable && openFn.decompiled ? (
                      <div className="flex min-w-0 gap-2">
                        <div className="min-w-0 flex-1">
                          <DecompiledCode
                            code={openFn.decompiled}
                            nameToAddr={nameToAddr}
                            externalNames={externalNames}
                            varNames={varNames}
                            cross={cross}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <NativeDisassembly fn={openFn} nameToAddr={nameToAddr} cross={cross} />
                        </div>
                      </div>
                    ) : codeTab === 'disasm' && disasmAvailable ? (
                      <NativeDisassembly fn={openFn} nameToAddr={nameToAddr} cross={cross} />
                    ) : openFn.decompiled ? (
                      <DecompiledCode
                        code={openFn.decompiled}
                        nameToAddr={nameToAddr}
                        externalNames={externalNames}
                        varNames={varNames}
                        cross={cross}
                      />
                    ) : (
                      <NativeDisassembly fn={openFn} nameToAddr={nameToAddr} cross={cross} />
                    )}
                  </div>
                </>
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
  varNames,
  cross,
}: {
  code: string
  nameToAddr: Map<string, string>
  externalNames: Set<string>
  varNames: ReadonlySet<string>
  cross: Cross | null
}) {
  const [html, setHtml] = useState<string | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setHtml(null)
    void highlight(code, 'c').then(h => {
      if (!cancelled) setHtml(decorateCalls(h, nameToAddr, externalNames, varNames))
    })
    return () => { cancelled = true }
  }, [code, nameToAddr, externalNames, varNames])

  // Stamp each Shiki `.line` with its 1-based source line so a click resolves
  // to a line number and the cross-highlight effect can target lines.
  useEffect(() => {
    const host = hostRef.current
    if (!host || html === null) return
    host.querySelectorAll('.line').forEach((el, i) => el.setAttribute('data-ln', String(i + 1)))
  }, [html])

  // Paint the active cross-highlight (line + variable) over the rendered HTML
  // without re-running Shiki — just toggle classes.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.querySelectorAll('.xhi-line, .xhi-var').forEach(el => el.classList.remove('xhi-line', 'xhi-var'))
    if (!cross) return
    for (const ln of cross.lines) {
      const el = host.querySelector(`[data-ln="${ln}"]`)
      if (el) el.classList.add('xhi-line')
    }
    for (const name of cross.vars) {
      host.querySelectorAll(`[data-var="${CSS.escape(name)}"]`).forEach(el => el.classList.add('xhi-var'))
    }
  }, [html, cross])

  if (html === null) {
    return (
      <pre className="overflow-x-auto whitespace-pre rounded border border-zinc-800 bg-black/60 p-3 font-mono text-xs leading-relaxed text-zinc-200">
        {code}
      </pre>
    )
  }
  return (
    <div
      ref={hostRef}
      className="shiki-host overflow-x-auto rounded border border-zinc-800 bg-black/60 p-3 font-mono text-xs leading-relaxed [&_.fn-link]:cursor-pointer [&_.fn-link]:rounded-sm [&_.fn-link]:border-b [&_.fn-link]:border-dotted [&_.fn-link]:border-zinc-600 hover:[&_.fn-link]:border-amber-400 hover:[&_.fn-link]:bg-amber-950/30 [&_.fn-extern]:opacity-60"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

// =========================================================================
// Disassembly view + asm tokenizer (ported from openbin-frontend's
// ProjectView so the APK native pane reaches Ghidra-style parity).
// =========================================================================

const ASM_REGISTERS: ReadonlySet<string> = new Set([
  'rax', 'rbx', 'rcx', 'rdx', 'rsi', 'rdi', 'rbp', 'rsp', 'rip',
  'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15',
  'eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'ebp', 'esp', 'eip',
  'r8d', 'r9d', 'r10d', 'r11d', 'r12d', 'r13d', 'r14d', 'r15d',
  'ax', 'bx', 'cx', 'dx', 'si', 'di', 'bp', 'sp',
  'ah', 'al', 'bh', 'bl', 'ch', 'cl', 'dh', 'dl',
  'cs', 'ds', 'es', 'fs', 'gs', 'ss',
  ...Array.from({ length: 32 }, (_, i) => `xmm${i}`),
  ...Array.from({ length: 32 }, (_, i) => `ymm${i}`),
  // AArch64 (most common for Android .so): x0-x30, w0-w30, SIMD banks.
  ...Array.from({ length: 31 }, (_, i) => `x${i}`),
  ...Array.from({ length: 31 }, (_, i) => `w${i}`),
  ...Array.from({ length: 32 }, (_, i) => `s${i}`),
  ...Array.from({ length: 32 }, (_, i) => `d${i}`),
  ...Array.from({ length: 32 }, (_, i) => `q${i}`),
  ...Array.from({ length: 32 }, (_, i) => `v${i}`),
  'sp', 'lr', 'pc', 'fp', 'ip', 'xzr', 'wzr', 'wsp', 'cpsr',
  // ARM/Thumb 32-bit (r0-r15).
  ...Array.from({ length: 16 }, (_, i) => `r${i}`),
])

const ASM_SIZE_KEYWORDS: ReadonlySet<string> = new Set([
  'byte', 'word', 'dword', 'qword', 'tword', 'oword', 'xword', 'yword', 'zword',
  'ptr', 'short', 'near', 'far',
])

type AsmToken =
  | { kind: 'comment'; text: string }
  | { kind: 'number'; text: string }
  | { kind: 'ident'; text: string }
  | { kind: 'punct'; text: string }
  | { kind: 'ws'; text: string }

function tokenizeAsmLine(line: string): AsmToken[] {
  const out: AsmToken[] = []
  const semi = line.indexOf(';')
  const body = semi >= 0 ? line.slice(0, semi) : line
  const comment = semi >= 0 ? line.slice(semi) : ''
  const re =
    /(\s+)|(#?-?0x[0-9a-fA-F]+|#-?\d+|-?\b\d+\b)|([A-Za-z_$@?][A-Za-z0-9_$@.?]*)|([,+\-*:!=<>(){}\[\]])/g
  let m: RegExpExecArray | null
  let lastIndex = 0
  while ((m = re.exec(body)) !== null) {
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

function DisasmTokens({
  text,
  nameToAddr,
  activeVars,
}: {
  text: string
  nameToAddr: Map<string, string>
  activeVars?: ReadonlySet<string>
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
        parts.push(<span key={key} className="italic text-zinc-500">{t.text}</span>)
        break
      case 'number':
        parts.push(<span key={key} className="text-orange-300">{t.text}</span>)
        break
      case 'punct':
        parts.push(<span key={key} className="text-zinc-500">{t.text}</span>)
        break
      case 'ident': {
        const lc = t.text.toLowerCase()
        const varHi = activeVars?.has(t.text) ? ' xhi-var' : ''
        const addr = nameToAddr.get(t.text)
        if (addr) {
          parts.push(
            <span key={key} className={'fn-link' + varHi} data-fn-addr={addr} role="link" tabIndex={0}>
              {t.text}
            </span>,
          )
        } else if (!mnemonicSeen) {
          parts.push(<span key={key} className={'font-semibold text-sky-300' + varHi}>{t.text}</span>)
          mnemonicSeen = true
        } else if (ASM_REGISTERS.has(lc)) {
          parts.push(<span key={key} className={'text-amber-300' + varHi}>{t.text}</span>)
        } else if (ASM_SIZE_KEYWORDS.has(lc)) {
          parts.push(<span key={key} className={'text-violet-300' + varHi}>{t.text}</span>)
        } else {
          parts.push(<span key={key} className={'text-zinc-200' + varHi}>{t.text}</span>)
        }
        break
      }
    }
  }
  return <>{parts}</>
}

function NativeDisassembly({
  fn,
  nameToAddr,
  cross,
}: {
  fn: NativeFunction
  nameToAddr: Map<string, string>
  cross: Cross | null
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const activeVars = useMemo(() => (cross ? new Set(cross.vars) : undefined), [cross])

  useEffect(() => {
    if (!cross || cross.addrs.size === 0) return
    const host = hostRef.current
    if (!host) return
    const first = cross.addrs.values().next().value
    if (!first) return
    const el = host.querySelector<HTMLElement>(`[data-addr="${CSS.escape(first)}"]`)
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [cross])

  if (!fn.disassembly || fn.disassembly.length === 0) {
    return (
      <p className="p-3 text-xs text-zinc-500">
        {fn.external || fn.thunk
          ? 'No disassembly — external/thunk function.'
          : 'No disassembly available. Re-run analysis with an updated worker to populate it.'}
      </p>
    )
  }
  return (
    <div
      ref={hostRef}
      className="overflow-x-auto rounded border border-zinc-800 bg-black/60 font-mono text-[12px] leading-relaxed [&_.fn-link]:cursor-pointer [&_.fn-link]:rounded-sm hover:[&_.fn-link]:bg-amber-950/30"
    >
      {fn.disassembly.map((line, i) => {
        const hot = cross?.addrs.has(line.addr) ?? false
        return (
          <div
            key={i}
            data-addr={line.addr}
            className={`flex gap-4 px-3 py-0.5 ${hot ? 'xhi-asm-row' : 'hover:bg-zinc-900/40'}`}
          >
            <span className="w-24 shrink-0 text-zinc-600">{line.addr}</span>
            <span className="text-zinc-200">
              <DisasmTokens text={line.text} nameToAddr={nameToAddr} activeVars={activeVars} />
            </span>
          </div>
        )
      })}
    </div>
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

/**
 * Sunset banner shown inside the native-lib panel while the cloud Ghidra
 * worker is disabled (see GhidraSunsetMessage.java on the backend). Compact
 * variant — the Native panel already has its own header + result body, so
 * this just inserts a one-liner explanation under the title row plus the
 * sponsorship-mailto. The "Download CLI" CTA itself lives next to where
 * the Analyze button used to be (small button, easier to spot in context).
 */
function GhidraSunsetBanner() {
  return (
    <div className="mt-3 rounded border border-amber-700/50 bg-amber-950/30 p-3 text-[12px] leading-relaxed text-amber-100">
      <p>
        <span className="font-semibold text-amber-200">
          Cloud Ghidra is temporarily disabled.
        </span>{' '}
        AWS compute outpaced what this OSS project can self-fund. Use the
        free desktop CLI to decompile this <code className="rounded bg-black/40 px-1 font-mono text-[11px]">.so</code>{' '}
        locally; it&apos;ll upload the result and show up here as a regular analyzed library.
      </p>
      <p className="mt-1.5 text-[11px] text-zinc-400">
        Want to sponsor cloud Ghidra for the community?{' '}
        <a
          href="mailto:husam@openbin.ai"
          className="font-medium text-amber-300 underline-offset-4 hover:underline"
        >
          husam@openbin.ai
        </a>
      </p>
    </div>
  )
}
