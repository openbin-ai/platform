import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApi } from '../api/client'
import { UserListRow } from '@shared/components/UserListRow'
import { useMe } from '@shared/api/me'
import { userSearchPath, type SocialUserSummary } from '@shared/api/social'

const ACCENT = 'border-purple-600 bg-purple-950/40 text-purple-200 hover:bg-purple-900/50'
const PAGE_SIZE = 20

/**
 * Researcher search — openapk variant. Same logic as the openbin version
 * (anonymous-readable, debounced URL-driven query, viewer's own row
 * filtered out), purple accent instead of amber.
 */
export function ResearcherSearch() {
  const api = useApi()
  const me = useMe()
  const [search, setSearch] = useSearchParams()
  const initialQ = search.get('q') ?? ''
  const page = Number(search.get('page') ?? '0') || 0

  const [draft, setDraft] = useState(initialQ)
  const [rows, setRows] = useState<SocialUserSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const trimmed = draft.trim()
    const current = search.get('q') ?? ''
    if (trimmed === current) return
    const t = setTimeout(() => {
      const usp = new URLSearchParams(search)
      if (trimmed) usp.set('q', trimmed)
      else usp.delete('q')
      usp.set('page', '0')
      setSearch(usp, { replace: true })
    }, 300)
    return () => clearTimeout(t)
  }, [draft, search, setSearch])

  const q = search.get('q') ?? ''

  useEffect(() => {
    const trimmed = q.trim()
    if (trimmed.length < 2) {
      setRows([])
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api<SocialUserSummary[]>(userSearchPath(trimmed, page, PAGE_SIZE))
      .then((r) => { if (!cancelled) setRows(r) })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Search failed')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [api, q, page])

  const filtered = rows?.filter((r) => !me || r.userId !== me.userId) ?? null

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-200">
      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-100">Researchers</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Find researchers by name and follow them to build your feed.
          </p>
        </header>

        <div className="mb-5">
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search by name…"
            autoFocus
            className="w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-purple-500 focus:outline-none"
          />
          {q.trim().length > 0 && q.trim().length < 2 && (
            <p className="mt-1 text-[11px] text-zinc-500">Type at least 2 characters…</p>
          )}
        </div>

        {error && (
          <p className="rounded border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {loading && <p className="text-sm text-zinc-500">Searching…</p>}

        {!loading && filtered && filtered.length === 0 && q.trim().length >= 2 && (
          <p className="rounded border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-sm text-zinc-500">
            No researchers match <span className="font-mono text-zinc-300">{q.trim()}</span>.
          </p>
        )}

        {filtered && filtered.length > 0 && (
          <ul className="space-y-2">
            {filtered.map((r) => (
              <li key={r.userId}>
                <UserListRow row={r} viewerUserId={me?.userId} accentClass={ACCENT} dateLabel="Joined" />
              </li>
            ))}
          </ul>
        )}

        {(page > 0 || (rows && rows.length >= PAGE_SIZE)) && (
          <div className="mt-6 flex items-center justify-between border-t border-zinc-800 pt-4 text-xs">
            <button
              onClick={() => {
                const usp = new URLSearchParams(search)
                usp.set('page', String(Math.max(0, page - 1)))
                setSearch(usp, { replace: false })
              }}
              disabled={page === 0}
              className="rounded border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            >
              ← Newer
            </button>
            <span className="text-zinc-500">Page {page + 1}</span>
            <button
              onClick={() => {
                const usp = new URLSearchParams(search)
                usp.set('page', String(page + 1))
                setSearch(usp, { replace: false })
              }}
              disabled={!rows || rows.length < PAGE_SIZE}
              className="rounded border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            >
              Older →
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
