import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { useApi } from '@shared/api/client'
import {
  buildFeedQuery,
  SHA256_RE,
  STIX_MALWARE_TYPES,
  type CommunityFeedParams,
  type CommunityReportSummary,
} from '@shared/api/community'
import { Gravatar } from '@shared/components/Gravatar'
import { UpvoteButton } from '@shared/components/UpvoteButton'

// Anonymous /community feed for openbin-frontend — BIN reports only.
// Mirror of openapk-frontend's Community page; the only behavioral
// differences are the backend endpoint (.../bin/reports) and the
// OPENBIN amber-accent branding.
export function Community() {
  const navigate = useNavigate()
  const auth = useAuth()
  const api = useApi()
  const [search, setSearch] = useSearchParams()

  const q = search.get('q') ?? ''
  const malwareType = search.get('malware_type') ?? ''
  const sha256 = search.get('sha256') ?? ''
  const tags = useMemo(() => search.getAll('tag'), [search])
  const sort = (search.get('sort') === 'trending' ? 'trending' : 'new') as 'new' | 'trending'
  const page = Number(search.get('page') ?? '0') || 0

  const [items, setItems] = useState<CommunityReportSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params: CommunityFeedParams = {
      q: q || undefined,
      malwareType: malwareType || undefined,
      sha256: sha256 || undefined,
      tags: tags.length > 0 ? tags : undefined,
      sort,
      page,
      size: 20,
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api<CommunityReportSummary[]>(`/api/community/bin/reports${buildFeedQuery(params)}`)
      .then((rows) => { if (!cancelled) setItems(rows) })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to load community feed')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [api, q, malwareType, sha256, sort, page, tags])

  const [queryDraft, setQueryDraft] = useState(q || sha256)
  useEffect(() => { setQueryDraft(q || sha256) }, [q, sha256])

  const setFilter = useCallback((next: Partial<Record<string, string | string[] | null>>) => {
    const usp = new URLSearchParams(search)
    for (const [k, v] of Object.entries(next)) {
      if (v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0)) {
        usp.delete(k)
      } else if (Array.isArray(v)) {
        usp.delete(k)
        for (const item of v) usp.append(k, item)
      } else {
        usp.set(k, v)
      }
    }
    usp.set('page', '0')
    setSearch(usp, { replace: false })
  }, [search, setSearch])

  function submitSearch(e?: React.FormEvent) {
    e?.preventDefault()
    const trimmed = queryDraft.trim()
    if (SHA256_RE.test(trimmed)) {
      setFilter({ q: null, sha256: trimmed.toLowerCase() })
    } else {
      setFilter({ q: trimmed || null, sha256: null })
    }
  }

  function toggleTag(t: string) {
    setFilter({ tag: tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t] })
  }

  function clearAll() {
    setSearch(new URLSearchParams(), { replace: false })
  }

  const hasFilters = !!(q || malwareType || sha256 || tags.length)

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      <PublicHeader auth={auth} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-100">Community research</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Public binary analyses contributed by the community. Browse, search by hash or
              keyword, and filter by malware type. <Link to="/terms" className="text-amber-400 hover:underline">Terms</Link>.
            </p>
          </div>
          <Link
            to="/community/researchers"
            className="shrink-0 rounded border border-amber-700/60 bg-amber-950/30 px-3 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-900/40"
          >
            Find researchers →
          </Link>
        </div>

        <form onSubmit={submitSearch} className="mb-4 flex items-center gap-2">
          <input
            type="text"
            value={queryDraft}
            onChange={(e) => setQueryDraft(e.target.value)}
            placeholder="Search by keyword or paste a SHA-256…"
            className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded border border-amber-600 bg-amber-950/40 px-4 py-2 text-sm text-amber-200 hover:bg-amber-900/40"
          >
            Search
          </button>
        </form>

        <div className="mb-6 flex flex-wrap items-center gap-2">
          <select
            value={sort}
            onChange={(e) => setFilter({ sort: e.target.value === 'trending' ? 'trending' : null })}
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
          >
            <option value="new">Newest</option>
            <option value="trending">Trending (most upvoted)</option>
          </select>
          <select
            value={malwareType}
            onChange={(e) => setFilter({ malware_type: e.target.value || null })}
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
          >
            <option value="">All malware types</option>
            {STIX_MALWARE_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {tags.map((t) => (
            <button
              key={t}
              onClick={() => toggleTag(t)}
              className="inline-flex items-center gap-1 rounded-full border border-amber-600 bg-amber-950/30 px-2.5 py-0.5 text-[11px] text-amber-200 hover:bg-amber-900/30"
              title="Click to remove"
            >
              #{t}
              <span className="text-amber-400">×</span>
            </button>
          ))}
          {hasFilters && (
            <button
              onClick={clearAll}
              className="ml-2 text-xs text-zinc-500 hover:text-zinc-300"
            >
              Clear all
            </button>
          )}
        </div>

        {loading && <div className="py-12 text-center text-sm text-zinc-500">Loading…</div>}
        {error && (
          <div className="rounded border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="rounded border border-zinc-800 bg-zinc-900/40 px-6 py-12 text-center">
            <p className="text-sm text-zinc-400">No published reports match these filters.</p>
            {hasFilters && (
              <button onClick={clearAll} className="mt-3 text-xs text-amber-400 hover:underline">
                Clear filters
              </button>
            )}
          </div>
        )}
        {!loading && items.length > 0 && (
          <ul className="space-y-3">
            {items.map((r) => (
              <li key={r.reportId}>
                <FeedCard report={r} onTagClick={toggleTag} />
              </li>
            ))}
          </ul>
        )}

        {items.length >= 20 && (
          <div className="mt-6 flex items-center justify-between border-t border-zinc-800 pt-4">
            <button
              onClick={() => setFilter({ page: String(Math.max(0, page - 1)) })}
              disabled={page === 0}
              className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            >
              ← Newer
            </button>
            <span className="text-xs text-zinc-500">Page {page + 1}</span>
            <button
              onClick={() => setFilter({ page: String(page + 1) })}
              className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Older →
            </button>
          </div>
        )}
      </main>
      <PublicFooter />
    </div>
  )

  function FeedCard({
    report,
    onTagClick,
  }: {
    report: CommunityReportSummary
    onTagClick: (t: string) => void
  }) {
    return (
      <article
        className="cursor-pointer rounded border border-zinc-800 bg-zinc-900/40 p-4 transition hover:border-amber-700 hover:bg-zinc-900/60"
        onClick={() => navigate(`/community/reports/${report.reportId}`)}
      >
        <div className="flex items-start gap-3">
          <Link
            to={`/u/${report.authorId}`}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0"
          >
            <Gravatar emailMd5={report.authorEmailMd5} size={36} />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="truncate text-base font-medium text-zinc-100">{report.title}</h2>
              <div className="flex shrink-0 items-center gap-2">
                <UpvoteButton
                  reportId={report.reportId}
                  initialCount={report.voteCount}
                  initialVoted={report.votedByMe}
                  accentClass="border-amber-600 bg-amber-950/40 text-amber-200 hover:bg-amber-900/50"
                />
                <time
                  className="text-[11px] text-zinc-500"
                  title={new Date(report.communityPublishedAt).toLocaleString()}
                >
                  {formatRelative(report.communityPublishedAt)}
                </time>
              </div>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
              <Link
                to={`/u/${report.authorId}`}
                onClick={(e) => e.stopPropagation()}
                className="hover:text-zinc-200 hover:underline"
              >
                {report.authorDisplayName}
              </Link>
              <span>·</span>
              <span className="truncate font-mono">{report.projectName}</span>
            </div>
            {report.preview && (
              <p className="mt-2 line-clamp-2 text-sm text-zinc-400">{report.preview}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {report.malwareType && (
                <span className="rounded-full border border-red-700 bg-red-950/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-red-300">
                  {report.malwareType}
                </span>
              )}
              {report.tags.map((t) => (
                <button
                  key={t}
                  onClick={(e) => { e.stopPropagation(); onTagClick(t) }}
                  className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[10px] text-zinc-300 hover:border-amber-600 hover:text-amber-200"
                >
                  #{t}
                </button>
              ))}
              <span className="ml-auto truncate font-mono text-[10px] text-zinc-600" title={report.sha256}>
                {report.sha256.slice(0, 12)}…
              </span>
            </div>
          </div>
        </div>
      </article>
    )
  }
}

function PublicHeader({ auth }: { auth: ReturnType<typeof useAuth> }) {
  return (
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
  )
}

function PublicFooter() {
  return (
    <footer className="border-t border-zinc-900 px-6 py-4 text-center text-[11px] text-zinc-600">
      Community submissions reflect the views of their authors only. <Link to="/terms" className="hover:underline">Terms</Link>.
    </footer>
  )
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}
