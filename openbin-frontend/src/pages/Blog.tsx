import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { useApi } from '@shared/api/client'
import { Gravatar } from '@shared/components/Gravatar'
import { blogFeedPath, myPostsPath, type BlogPostSummary } from '@shared/api/blog'

/**
 * The blog feed.
 *
 * This exists because people were publishing write-ups by uploading them as
 * SCRIPT projects — burning a worker run to get an essay onto the site, then
 * having it show up in the community feed as a malware analysis. Posts are
 * their own thing now.
 */
export function Blog() {
  const api = useApi()
  const auth = useAuth()
  const [posts, setPosts] = useState<BlogPostSummary[] | null>(null)
  const [drafts, setDrafts] = useState<BlogPostSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setPosts(await api<BlogPostSummary[]>(blogFeedPath()))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load posts')
      }
    })()
  }, [api])

  useEffect(() => {
    if (!auth.isAuthenticated) { setDrafts([]); return }
    void (async () => {
      try {
        const mine = await api<BlogPostSummary[]>(myPostsPath())
        setDrafts(mine.filter((p) => p.draft))
      } catch {
        // A failure here shouldn't take down the public feed.
      }
    })()
  }, [api, auth.isAuthenticated])

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Blog</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Write-ups, notes and teardowns from the community — no project required.
          </p>
        </div>
        <Link
          to="/blog/new"
          className="shrink-0 rounded bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-500"
        >
          Write a post
        </Link>
      </header>

      {drafts.length > 0 && (
        <section className="mb-6 rounded border border-amber-900/50 bg-amber-950/20 p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-300">
            Your drafts
          </h2>
          <ul className="mt-2 space-y-1">
            {drafts.map((d) => (
              <li key={d.id} className="text-sm">
                <Link to={`/blog/${d.id}/edit`} className="text-amber-200 hover:underline">
                  {d.title}
                </Link>
                <span className="ml-2 text-xs text-zinc-500">
                  edited {new Date(d.updatedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && <p className="rounded border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</p>}
      {!posts && !error && <p className="text-sm text-zinc-500">Loading…</p>}
      {posts?.length === 0 && (
        <p className="rounded border border-zinc-800 bg-zinc-900/40 px-4 py-8 text-center text-sm text-zinc-500">
          No posts yet. Be the first.
        </p>
      )}

      <ul className="space-y-4">
        {posts?.map((p) => (
          <li key={p.id} className="rounded border border-zinc-800 bg-zinc-900/40 p-4 hover:border-zinc-700">
            <Link to={`/blog/${p.slug}`} className="block">
              <h2 className="text-base font-medium text-zinc-100">{p.title}</h2>
              {p.summary && <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{p.summary}</p>}
            </Link>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
              <Link to={`/u/${p.authorId}`} className="flex items-center gap-1.5 hover:text-zinc-300">
                <Gravatar emailMd5={p.authorEmailMd5} size={18} />
                {p.authorDisplayName}
              </Link>
              {p.publishedAt && <span>{new Date(p.publishedAt).toLocaleDateString()}</span>}
              <span>{p.readingMinutes} min read</span>
              <span>▲ {p.upvotes}</span>
              <span>💬 {p.commentCount}</span>
              {p.mine && (
                <Link to={`/blog/${p.id}/edit`} className="text-purple-400 hover:underline">
                  edit
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
