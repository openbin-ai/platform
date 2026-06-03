import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../api/client'

export type SymbolKind = 'CLASS' | 'INTERFACE' | 'ENUM' | 'METHOD' | 'FIELD'

export type SymbolDecl = {
  kind: SymbolKind
  name: string
  className: string
  file: string
  line: number
  signature: string
  modifiers: string
}

export type SymbolUsage = { file: string; line: number; snippet: string }

export type SymbolQuery = {
  name: string
  qualifyingClass?: string
  // When the click site IS the declaration row, suppress it from usages.
  excludeFile?: string
  excludeLine?: number
}

/**
 * Sidebar panel that resolves a symbol query into (a) candidate declarations
 * and (b) live-grepped usages. Both sections jump the code viewer on click.
 * The Rebuild button forces a re-scan of the symbol index — useful after a
 * rename pass changes file content.
 */
export function Symbols({
  projectId,
  query,
  onOpen,
  onClose,
  onStartChain,
}: {
  projectId: string
  query: SymbolQuery | null
  onOpen: (file: string, line: number) => void
  onClose: () => void
  /** Optional. When provided, METHOD definitions get a ▶ button that starts a call chain. */
  onStartChain?: (file: string, line: number) => void
}) {
  const api = useApi()
  const [definitions, setDefinitions] = useState<SymbolDecl[] | null>(null)
  const [usages, setUsages] = useState<SymbolUsage[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [includeSdks, setIncludeSdks] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyRebuild, setBusyRebuild] = useState(false)

  const load = useCallback(async () => {
    if (!query) return
    setLoading(true)
    setError(null)
    try {
      const defParams = new URLSearchParams({ name: query.name, includeSdks: String(includeSdks) })
      const usgParams = new URLSearchParams({ name: query.name, includeSdks: String(includeSdks) })
      if (query.qualifyingClass) usgParams.set('class', query.qualifyingClass)
      if (query.excludeFile) usgParams.set('excludeFile', query.excludeFile)
      if (query.excludeLine) usgParams.set('excludeLine', String(query.excludeLine))
      const [defs, uses] = await Promise.all([
        api<SymbolDecl[]>(`/api/projects/${projectId}/symbols/definition?${defParams.toString()}`),
        api<SymbolUsage[]>(`/api/projects/${projectId}/symbols/usages?${usgParams.toString()}`),
      ])
      setDefinitions(defs)
      setUsages(uses)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [api, projectId, query, includeSdks])

  useEffect(() => { void load() }, [load])

  async function rebuild() {
    setBusyRebuild(true)
    setError(null)
    try {
      await api(`/api/projects/${projectId}/symbols/rebuild`, { method: 'POST' })
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyRebuild(false)
    }
  }

  if (!query) return null

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Symbol</p>
          <p className="truncate font-mono text-xs" title={query.qualifyingClass ? `${query.qualifyingClass}.${query.name}` : query.name}>
            {query.qualifyingClass && <span className="text-zinc-500">{query.qualifyingClass}.</span>}
            <span className="text-purple-300">{query.name}</span>
          </p>
        </div>
        <button
          onClick={() => void rebuild()}
          disabled={busyRebuild}
          title="Rebuild the symbol index (re-scan project source)"
          className="text-[11px] text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
        >
          {busyRebuild ? '…' : '↻'}
        </button>
        <button onClick={onClose} title="Close" className="text-[11px] text-zinc-400 hover:text-zinc-200">
          ×
        </button>
      </div>

      <label className="flex items-center gap-1 px-0.5 text-[10px] text-zinc-400" title="Include matches from androidx, kotlin, com.google.* etc.">
        <input type="checkbox" className="h-3 w-3" checked={includeSdks} onChange={e => setIncludeSdks(e.target.checked)} />
        include SDKs
      </label>

      {loading && <p className="px-1 text-[10px] text-zinc-500">Loading…</p>}
      {error && (
        <div className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[10px] text-red-300">{error}</div>
      )}

      {definitions !== null && (
        <div className="space-y-0.5">
          <p className="px-1 text-[10px] uppercase tracking-wide text-zinc-500">
            Definitions ({definitions.length})
          </p>
          {definitions.length === 0 ? (
            <p className="px-1 text-[10px] text-zinc-500">No declaration in the index.</p>
          ) : (
            <ul className="space-y-0.5">
              {definitions.map(d => (
                <li key={`${d.file}:${d.line}:${d.kind}`} className="flex items-stretch gap-1">
                  <button
                    onClick={() => onOpen(d.file, d.line)}
                    className="block min-w-0 flex-1 rounded px-2 py-0.5 text-left hover:bg-zinc-800"
                    title={`${d.file}:${d.line}`}
                  >
                    <div className="flex items-baseline gap-1 truncate text-[11px]">
                      <span className="font-mono text-[9px] uppercase text-zinc-500">{d.kind}</span>
                      <span className="truncate font-mono text-zinc-300">
                        {d.className && d.className !== d.name && (
                          <span className="text-zinc-500">{d.className}.</span>
                        )}
                        {d.name}
                        {d.signature && <span className="text-zinc-500">{d.signature}</span>}
                      </span>
                    </div>
                    <div className="truncate font-mono text-[10px] text-zinc-500">{d.file}:{d.line}</div>
                  </button>
                  {onStartChain && d.kind === 'METHOD' && (
                    <button
                      onClick={() => onStartChain(d.file, d.line)}
                      title="Build a call chain rooted at this method"
                      className="shrink-0 rounded border border-zinc-800 px-1.5 text-[11px] text-purple-300 hover:bg-zinc-800"
                    >
                      ▶
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {usages !== null && (
        <div className="space-y-0.5">
          <p className="px-1 text-[10px] uppercase tracking-wide text-zinc-500">
            Usages ({usages.length})
          </p>
          {usages.length === 0 ? (
            <p className="px-1 text-[10px] text-zinc-500">No usages.</p>
          ) : (
            <ul className="space-y-0.5">
              {usages.map(u => (
                <li key={`${u.file}:${u.line}`}>
                  <button
                    onClick={() => onOpen(u.file, u.line)}
                    className="block w-full rounded px-2 py-0.5 text-left hover:bg-zinc-800"
                    title={`${u.file}:${u.line}`}
                  >
                    <div className="truncate font-mono text-[10px] text-zinc-500">{u.file}:{u.line}</div>
                    <div className="truncate font-mono text-[11px] text-zinc-300">{u.snippet}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
