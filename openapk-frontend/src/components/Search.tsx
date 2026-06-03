import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi } from '../api/client'

type SearchHit = { file: string; line: number; snippet: string }

/**
 * Project-wide grep in the left sidebar. Debounces typing, hits
 * /api/projects/{id}/search, renders hits grouped by file. Clicking a hit
 * calls onOpen(file, line) so the parent jumps the code viewer and scrolls.
 *
 * The component is render-controlled by the parent — when the user clears the
 * input, the parent decides to show the file tree again (via `active` derived
 * from the query). This component is "active" when query.trim() is non-empty.
 */
export function Search({
  projectId,
  onOpen,
  onActiveChange,
}: {
  projectId: string
  onOpen: (file: string, line: number) => void
  onActiveChange: (active: boolean) => void
}) {
  const api = useApi()
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [includeSdks, setIncludeSdks] = useState(false)
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reqIdRef = useRef(0)
  const active = query.trim() !== ''

  useEffect(() => { onActiveChange(active) }, [active, onActiveChange])

  const run = useCallback(async (q: string) => {
    const myId = ++reqIdRef.current
    if (!q.trim()) {
      setHits(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        q,
        caseSensitive: String(caseSensitive),
        regex: String(regex),
        includeSdks: String(includeSdks),
      })
      const r = await api<SearchHit[]>(`/api/projects/${projectId}/search?${params.toString()}`)
      if (myId === reqIdRef.current) setHits(r)
    } catch (e) {
      if (myId === reqIdRef.current) {
        setError((e as Error).message)
        setHits(null)
      }
    } finally {
      if (myId === reqIdRef.current) setLoading(false)
    }
  }, [api, projectId, caseSensitive, regex, includeSdks])

  useEffect(() => {
    const t = setTimeout(() => void run(query), 250)
    return () => clearTimeout(t)
  }, [query, run])

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search files…"
          className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 pr-6 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-purple-500/60 focus:outline-none"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            title="Clear"
            className="absolute right-1 top-1/2 -translate-y-1/2 px-1 text-[11px] text-zinc-500 hover:text-zinc-200"
          >
            ×
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5 text-[10px] text-zinc-400">
        <label className="flex items-center gap-1" title="Case sensitive match">
          <input type="checkbox" className="h-3 w-3" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} />
          Aa
        </label>
        <label className="flex items-center gap-1" title="Interpret query as a Java regex">
          <input type="checkbox" className="h-3 w-3" checked={regex} onChange={e => setRegex(e.target.checked)} />
          .*
        </label>
        <label className="flex items-center gap-1" title="Include matches from androidx, kotlin, com.google.* etc.">
          <input type="checkbox" className="h-3 w-3" checked={includeSdks} onChange={e => setIncludeSdks(e.target.checked)} />
          SDKs
        </label>
      </div>

      {active && (
        <div className="space-y-1">
          {loading && <p className="px-1 text-[10px] text-zinc-500">Searching…</p>}
          {error && (
            <div className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[10px] text-red-300">{error}</div>
          )}
          {hits && hits.length === 0 && !loading && (
            <p className="px-1 text-[10px] text-zinc-500">No results.</p>
          )}
          {hits && hits.length > 0 && (
            <>
              <p className="px-1 text-[10px] text-zinc-500">
                {hits.length} hit{hits.length === 1 ? '' : 's'}
              </p>
              <ul className="space-y-0.5">
                {groupByFile(hits).map(group => (
                  <li key={group.file}>
                    <div className="truncate px-1 py-0.5 font-mono text-[10px] text-zinc-500" title={group.file}>
                      {group.file}
                    </div>
                    <ul>
                      {group.hits.map(h => (
                        <li key={`${h.file}:${h.line}`}>
                          <button
                            onClick={() => onOpen(h.file, h.line)}
                            className="block w-full rounded px-2 py-0.5 text-left text-[11px] hover:bg-zinc-800"
                            title={`${h.file}:${h.line}`}
                          >
                            <span className="mr-2 inline-block w-8 shrink-0 text-right font-mono text-[10px] text-zinc-500">{h.line}</span>
                            <span className="font-mono text-zinc-300">{h.snippet}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function groupByFile(hits: SearchHit[]): { file: string; hits: SearchHit[] }[] {
  const map = new Map<string, SearchHit[]>()
  for (const h of hits) {
    const arr = map.get(h.file) ?? []
    arr.push(h)
    map.set(h.file, arr)
  }
  return Array.from(map.entries()).map(([file, hs]) => ({ file, hits: hs }))
}
