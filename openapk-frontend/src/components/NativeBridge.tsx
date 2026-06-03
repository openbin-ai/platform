import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../api/client'

// =========================================================================
// Types — must mirror JniBridgeView + its nested records on the backend.
// =========================================================================

type LoaderCall = {
  file: string
  line: number
  method: 'loadLibrary' | 'load'
  target: string
  snippet: string
}

type NativeMethodDecl = {
  file: string
  line: number
  className: string
  packageName: string
  methodName: string
  signature: string
  expectedJniName: string
  matchedLibPath: string | null
  matchedAddress: string | null
}

type LibraryRef = {
  shortName: string
  libPaths: string[]
  archs: string[]
  loaders: number[]   // indices into the top-level loaders[] array
}

type JniBridgeView = {
  libraries: LibraryRef[]
  loaders: LoaderCall[]
  nativeMethods: NativeMethodDecl[]
  scannedAt: string
}

type Section = 'libraries' | 'natives' | 'loaders'

/**
 * Right-pane "Native" tab — project-wide view of the Java ↔ native bridge.
 * Three collapsible sections:
 *   <ol>
 *     <li>Libraries (.so files under resources/lib/) with their loader call sites</li>
 *     <li>Java {@code native} method declarations + matched JNI functions</li>
 *     <li>Raw loader call sites</li>
 *   </ol>
 *
 * <p>Built lazily — first open hits {@code GET /jni-bridge} which scans + caches
 * server-side. Rescan button reruns the scan (e.g. after analyzing a new .so).
 */
export function NativeBridge({
  projectId,
  onOpenFile,
}: {
  projectId: string
  onOpenFile: (path: string, line?: number) => void
}) {
  const api = useApi()
  const [view, setView] = useState<JniBridgeView | null>(null)
  const [loading, setLoading] = useState(false)
  const [rescanning, setRescanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<Section, boolean>>({
    libraries: true,
    natives: true,
    loaders: false,
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api<JniBridgeView>(`/api/projects/${projectId}/jni-bridge`)
      setView(r)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [api, projectId])

  const rescan = useCallback(async () => {
    setRescanning(true)
    setError(null)
    try {
      const r = await api<JniBridgeView>(`/api/projects/${projectId}/jni-bridge/rescan`, {
        method: 'POST',
      })
      setView(r)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRescanning(false)
    }
  }, [api, projectId])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = (s: Section) => setOpen(o => ({ ...o, [s]: !o[s] }))

  if (loading && !view) {
    return <p className="p-3 text-xs text-zinc-500">Scanning Java ↔ native bridge…</p>
  }
  if (!view) {
    return (
      <div className="p-3">
        {error && (
          <pre className="overflow-auto rounded border border-red-900/60 bg-red-950/40 p-2 text-[11px] text-red-300/90">
            {error}
          </pre>
        )}
        <button
          onClick={() => void load()}
          className="mt-2 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
        >
          Retry
        </button>
      </div>
    )
  }

  const matched = view.nativeMethods.filter(m => m.matchedLibPath !== null).length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-zinc-800 bg-zinc-950/40 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-zinc-300">
            <span className="font-mono text-amber-300">{view.libraries.length}</span> libs ·{' '}
            <span className="font-mono text-amber-300">{view.nativeMethods.length}</span> native methods
            {view.nativeMethods.length > 0 && (
              <> (<span className="font-mono text-emerald-400">{matched}</span> matched)</>
            )}{' '}
            · <span className="font-mono text-amber-300">{view.loaders.length}</span> loaders
          </p>
          <button
            onClick={() => void rescan()}
            disabled={rescanning}
            className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
          >
            {rescanning ? 'Rescanning…' : 'Rescan'}
          </button>
        </div>
        <p className="mt-1 font-mono text-[10px] text-zinc-500">
          Scanned {relTime(view.scannedAt)} · match unanalyzed libs by clicking them in the file tree
        </p>
        {error && (
          <pre className="mt-2 overflow-auto rounded border border-red-900/60 bg-red-950/40 p-2 text-[11px] text-red-300/90">
            {error}
          </pre>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {/* Libraries */}
        <SectionHeader label="Libraries" count={view.libraries.length} open={open.libraries} onClick={() => toggle('libraries')} />
        {open.libraries && (
          <ul className="divide-y divide-zinc-900/60">
            {view.libraries.length === 0 && (
              <li className="px-3 py-2 text-xs text-zinc-500">No native libraries under resources/lib/.</li>
            )}
            {view.libraries.map(lib => (
              <li key={lib.shortName} className="px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <button
                    onClick={() => onOpenFile(lib.libPaths[0])}
                    className="min-w-0 truncate font-mono text-xs text-amber-200 hover:underline"
                    title={lib.libPaths.join('\n')}
                  >
                    lib{lib.shortName}.so
                  </button>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-500">{lib.archs.join(', ')}</span>
                </div>
                {lib.loaders.length === 0 ? (
                  <p className="mt-1 ml-3 text-[11px] text-zinc-600 italic">no loader call sites found</p>
                ) : (
                  <ul className="mt-1 ml-3 space-y-0.5">
                    {lib.loaders.map(idx => {
                      const lc = view.loaders[idx]
                      if (!lc) return null
                      return (
                        <li key={`${lib.shortName}-${idx}`} className="text-[11px]">
                          <button
                            onClick={() => onOpenFile(lc.file, lc.line)}
                            className="font-mono text-zinc-300 hover:text-amber-200 hover:underline"
                          >
                            {basename(lc.file)}:{lc.line}
                          </button>
                          <span className="ml-2 font-mono text-zinc-500">{lc.method}(…)</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Native method declarations */}
        <SectionHeader label="Native methods" count={view.nativeMethods.length} open={open.natives} onClick={() => toggle('natives')} />
        {open.natives && (
          <ul className="divide-y divide-zinc-900/60">
            {view.nativeMethods.length === 0 && (
              <li className="px-3 py-2 text-xs text-zinc-500">No <code>native</code> method declarations found.</li>
            )}
            {view.nativeMethods.map((m, i) => (
              <li key={`${m.file}-${m.line}-${i}`} className="px-3 py-2">
                <p className="font-mono text-[10px] text-zinc-500">
                  {m.packageName ? `${m.packageName}.` : ''}<span className="text-zinc-300">{m.className}</span>
                </p>
                <p className="mt-0.5 wrap-break-word font-mono text-xs text-zinc-200">{m.signature}</p>
                <div className="mt-1 flex items-center gap-2">
                  <button
                    onClick={() => onOpenFile(m.file, m.line)}
                    className="font-mono text-[11px] text-zinc-400 hover:text-amber-200 hover:underline"
                  >
                    {basename(m.file)}:{m.line}
                  </button>
                  <span className="text-zinc-700">·</span>
                  {m.matchedLibPath ? (
                    <button
                      onClick={() => onOpenFile(m.matchedLibPath!)}
                      className="font-mono text-[11px] text-emerald-400 hover:underline"
                      title={`Found in ${m.matchedLibPath}`}
                    >
                      → {m.expectedJniName} <span className="text-zinc-500">({basename(m.matchedLibPath)})</span>
                    </button>
                  ) : (
                    <span
                      className="font-mono text-[11px] text-zinc-600 italic"
                      title={`Expected JNI symbol: ${m.expectedJniName}`}
                    >
                      no JNI match
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Raw loader call sites */}
        <SectionHeader label="Loader call sites" count={view.loaders.length} open={open.loaders} onClick={() => toggle('loaders')} />
        {open.loaders && (
          <ul className="divide-y divide-zinc-900/60">
            {view.loaders.length === 0 && (
              <li className="px-3 py-2 text-xs text-zinc-500">No <code>System.load</code> calls found.</li>
            )}
            {view.loaders.map((lc, i) => (
              <li key={`${lc.file}-${lc.line}-${i}`} className="px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <button
                    onClick={() => onOpenFile(lc.file, lc.line)}
                    className="font-mono text-xs text-zinc-300 hover:text-amber-200 hover:underline"
                  >
                    {basename(lc.file)}:{lc.line}
                  </button>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-500">{lc.method}</span>
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-zinc-400">
                  → <span className="text-amber-200">{lc.target}</span>
                </p>
                {lc.snippet && (
                  <pre className="mt-1 overflow-x-auto rounded border border-zinc-900 bg-black/40 px-2 py-1 font-mono text-[10px] text-zinc-400">
                    {lc.snippet}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function SectionHeader({
  label,
  count,
  open,
  onClick,
}: {
  label: string
  count: number
  open: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="sticky top-0 z-10 flex w-full items-center gap-2 border-b border-zinc-800 bg-zinc-950/90 px-3 py-1.5 text-left text-[11px] font-medium text-zinc-300 backdrop-blur hover:bg-zinc-900"
    >
      <span className="font-mono text-zinc-500">{open ? '▾' : '▸'}</span>
      <span>{label}</span>
      <span className="font-mono text-[10px] text-zinc-500">({count})</span>
    </button>
  )
}

function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.substring(i + 1) : p
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
