import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../api/client'

type TableColumn = { name: string; type: string; constraints: string }
type TableSchema = { name: string; columns: TableColumn[] }
type DbSchema = {
  kind: 'sqlite' | 'room' | string
  className: string
  file: string
  line: number
  tables: TableSchema[]
}

/**
 * Right-panel tab showing detected local-storage schemas. SQLite helpers
 * surface their CREATE TABLE-derived columns; Room @Entity classes surface
 * field-derived columns. Click a schema's header to jump to its declaration.
 */
export function DbSchemas({
  projectId,
  onOpenFile,
}: {
  projectId: string
  onOpenFile: (file: string, line: number) => void
}) {
  const api = useApi()
  const [schemas, setSchemas] = useState<DbSchema[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [includeSdks, setIncludeSdks] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = includeSdks ? '?includeSdks=true' : ''
      setSchemas(await api<DbSchema[]>(`/api/projects/${projectId}/dbschemas${q}`))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [api, projectId, includeSdks])

  useEffect(() => { void load() }, [load])

  if (loading && schemas === null) {
    return <p className="p-3 text-xs text-zinc-500">Scanning…</p>
  }

  const all = schemas ?? []

  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          Local DBs ({all.length})
        </h3>
        <div className="flex items-center gap-3 text-[10px] text-zinc-400">
          <label className="flex items-center gap-1" title="Include schemas declared inside bundled libraries">
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
        <p className="pt-2 text-xs text-zinc-500">
          No SQLite helpers or Room entities found. If the app stores data via a less-common library, the scanner may have missed it.
        </p>
      )}

      <ul className="space-y-3">
        {all.map(s => (
          <li key={`${s.kind}:${s.file}:${s.line}`} className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
            <div className="flex items-baseline justify-between gap-2">
              <button
                onClick={() => onOpenFile(s.file, s.line)}
                className="min-w-0 flex-1 truncate text-left font-mono text-[12px] text-purple-300 hover:underline"
                title={`${s.file}:${s.line}`}
              >
                <KindChip kind={s.kind} />
                <span className="ml-2">{s.className}</span>
              </button>
              <span className="shrink-0 text-[10px] text-zinc-500">{s.file}:{s.line}</span>
            </div>
            <div className="mt-2 space-y-2">
              {s.tables.map(t => (
                <details key={t.name} open className="rounded border border-zinc-800/80 bg-black/30">
                  <summary className="cursor-pointer px-2 py-1 text-[11px] font-medium text-zinc-200">
                    <span className="text-emerald-300">{t.name}</span>
                    <span className="ml-2 text-[10px] text-zinc-500">{t.columns.length} column{t.columns.length === 1 ? '' : 's'}</span>
                  </summary>
                  <table className="w-full text-[10px] font-mono">
                    <thead className="text-zinc-500">
                      <tr>
                        <th className="px-2 py-0.5 text-left font-normal">column</th>
                        <th className="px-2 py-0.5 text-left font-normal">type</th>
                        <th className="px-2 py-0.5 text-left font-normal">constraints</th>
                      </tr>
                    </thead>
                    <tbody className="text-zinc-300">
                      {t.columns.map(c => (
                        <tr key={c.name} className="border-t border-zinc-900">
                          <td className="px-2 py-0.5 text-zinc-100">{c.name}</td>
                          <td className="px-2 py-0.5 text-zinc-400">{c.type || '—'}</td>
                          <td className="px-2 py-0.5 text-zinc-500">{c.constraints || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function KindChip({ kind }: { kind: string }) {
  const colors: Record<string, string> = {
    sqlite: 'bg-blue-900/40 text-blue-300 border-blue-800',
    room: 'bg-purple-900/40 text-purple-300 border-purple-800',
  }
  const cls = colors[kind] ?? 'bg-zinc-800 text-zinc-300 border-zinc-700'
  return <span className={`rounded border px-1 text-[9px] uppercase tracking-wide ${cls}`}>{kind}</span>
}
