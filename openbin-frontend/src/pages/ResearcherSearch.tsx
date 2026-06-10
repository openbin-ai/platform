import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { useApi } from '@shared/api/client'
import { UserListRow } from '@shared/components/UserListRow'
import { useMe } from '@shared/api/me'
import { userSearchPath, type SocialUserSummary } from '@shared/api/social'

const ACCENT = 'border-amber-600 bg-amber-950/40 text-amber-200 hover:bg-amber-900/50'
const PAGE_SIZE = 20

/**
 * Researcher search page on openbin-frontend. Anonymous-readable — the
 * backend endpoint behind {@link userSearchPath} doesn't require auth,
 * which mirrors the rest of the community surface. Filters out the
 * viewer's own row on the client so the result list doesn't include
 * a "follow yourself" affordance.
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

  // Debounce the input → URL writes by 300ms so each keystroke doesn't
  // mint a history entry. Driving the fetch off the URL keeps share-by-
  // link working: `/community/researchers?q=husam` is a valid bookmark.
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

  // Drop the viewer's own row — backend allows it (a self-row lets you
  // navigate to your own profile from search) but the UI shows the
  // Follow button per row and you can't follow yourself, so the row
  // would render with a dead button. Hiding it is cleaner.
  const filtered = rows?.filter((r) => !me || r.userId !== me.userId) ?? null

  return (
    <Chrome>
      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-100">Researchers</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Find people by name. Only researchers who have published at least one
            community report are searchable.
          </p>
        </header>

        <div className="mb-5">
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search by name…"
            autoFocus
            className="w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
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
                <UserListRow row={r} viewerUserId={me?.userId} accentClass={ACCENT} />
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
    </Chrome>
  )
}

function Chrome({ children }: { children: React.ReactNode }) {
  const auth = useAuth()
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-200">
      <header className="border-b border-zinc-800 bg-zinc-950">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link to="/" className="text-sm font-semibold tracking-wide text-zinc-100 hover:opacity-80">
            OPENBIN<span className="text-amber-400">.AI</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/community" className="text-amber-300">Community</Link>
            {auth.isAuthenticated ? (
              <Link to="/" className="text-zinc-300 hover:text-zinc-100">My projects →</Link>
            ) : (
              <button
                onClick={() => void auth.signinRedirect()}
                className="rounded border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-zinc-800"
              >
                Sign in
              </button>
            )}
          </nav>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-zinc-900 px-6 py-4 text-center text-[11px] text-zinc-600">
        <Link to="/terms" className="hover:underline">Terms</Link>
      </footer>
    </div>
  )
}
