import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../api/client'

type NetworkHit = {
  kind: 'okhttp' | 'retrofit' | 'httpurlconnection' | 'websocket' | string
  httpMethod: string
  url: string
  file: string
  line: number
  snippet: string
}

/**
 * Right-panel tab listing detected HTTP call sites: OkHttp, Retrofit, and
 * HttpURLConnection. Grouped by file with method + URL chip per row.
 * Default filters out SDK paths (androidx, okhttp3, …); toggle to include.
 */
export function Network({
  projectId,
  onOpenFile,
}: {
  projectId: string
  onOpenFile: (file: string, line: number) => void
}) {
  const api = useApi()
  const [hits, setHits] = useState<NetworkHit[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [includeSdks, setIncludeSdks] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<string>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = includeSdks ? '?includeSdks=true' : ''
      setHits(await api<NetworkHit[]>(`/api/projects/${projectId}/network${q}`))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [api, projectId, includeSdks])

  useEffect(() => { void load() }, [load])

  if (loading && hits === null) {
    return <p className="p-3 text-xs text-zinc-500">Scanning…</p>
  }

  const all = hits ?? []
  const filtered = kindFilter === 'all' ? all : all.filter(h => h.kind === kindFilter)
  const kinds = Array.from(new Set(all.map(h => h.kind)))
  const grouped = groupByFile(filtered)

  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          Network calls ({filtered.length}{filtered.length !== all.length && ` / ${all.length}`})
        </h3>
        <div className="flex items-center gap-3 text-[10px] text-zinc-400">
          {kinds.length > 1 && (
            <select
              value={kindFilter}
              onChange={e => setKindFilter(e.target.value)}
              className="rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-[10px] text-zinc-200"
            >
              <option value="all">all kinds</option>
              {kinds.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          )}
          <label className="flex items-center gap-1" title="Include matches inside androidx, okhttp3, retrofit2, etc.">
            <input type="checkbox" className="h-3 w-3" checked={includeSdks} onChange={e => setIncludeSdks(e.target.checked)} />
            SDKs
          </label>
          <button
            onClick={() => void load()}
            disabled={loading}
            title="Re-scan the project"
            className="text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
          >
            {loading ? '…' : '↻'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">{error}</div>
      )}

      {all.length === 0 && !loading && (
        <p className="pt-2 text-xs text-zinc-500">No HTTP call sites detected. If the app uses a less-common client, the scanner may have missed it.</p>
      )}

      <ul className="space-y-2">
        {grouped.map(group => (
          <li key={group.file} className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
            <button
              onClick={() => onOpenFile(group.file, group.hits[0].line)}
              className="block w-full truncate text-left font-mono text-[11px] text-purple-300 hover:underline"
              title={group.file}
            >
              {group.file}
            </button>
            <ul className="mt-1 space-y-0.5">
              {group.hits.map(h => (
                <li key={`${h.file}:${h.line}:${h.url}`}>
                  <button
                    onClick={() => onOpenFile(h.file, h.line)}
                    className="block w-full rounded px-1 py-0.5 text-left hover:bg-zinc-800"
                    title={`${h.file}:${h.line}`}
                  >
                    <div className="flex items-baseline gap-2 truncate">
                      <KindChip kind={h.kind} />
                      {h.httpMethod && <MethodChip method={h.httpMethod} />}
                      <span className="truncate font-mono text-[11px] text-zinc-200">{h.url || <span className="text-zinc-500">(dynamic)</span>}</span>
                      <span className="shrink-0 text-[10px] text-zinc-500">:{h.line}</span>
                    </div>
                    <div className="truncate font-mono text-[10px] text-zinc-500">{h.snippet}</div>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}

function KindChip({ kind }: { kind: string }) {
  const colors: Record<string, string> = {
    retrofit: 'bg-sky-900/40 text-sky-300 border-sky-800',
    okhttp: 'bg-emerald-900/40 text-emerald-300 border-emerald-800',
    httpurlconnection: 'bg-amber-900/40 text-amber-300 border-amber-800',
  }
  const cls = colors[kind] ?? 'bg-zinc-800 text-zinc-300 border-zinc-700'
  return <span className={`shrink-0 rounded border px-1 text-[9px] uppercase tracking-wide ${cls}`}>{kind}</span>
}

function MethodChip({ method }: { method: string }) {
  return <span className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-1 font-mono text-[9px] uppercase text-zinc-300">{method}</span>
}

function groupByFile(hits: NetworkHit[]): { file: string; hits: NetworkHit[] }[] {
  const map = new Map<string, NetworkHit[]>()
  for (const h of hits) {
    const arr = map.get(h.file) ?? []
    arr.push(h)
    map.set(h.file, arr)
  }
  return Array.from(map.entries()).map(([file, hs]) => ({ file, hits: hs }))
}
