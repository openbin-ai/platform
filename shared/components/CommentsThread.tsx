import { useCallback, useEffect, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { useApi } from '@shared/api/client'
import { Gravatar } from '@shared/components/Gravatar'
import {
  commentsPath,
  deleteCommentPath,
  postCommentPath,
  type CommentResponse,
} from '@shared/api/comments'

/**
 * Threaded comments under a community report. One level of nesting only —
 * the backend silently flattens deeper replies onto the top-level parent,
 * which matches the schema's design (depth = 1).
 *
 * Anonymous viewers can read the thread but the composer redirects them
 * through Keycloak instead of silently failing. Optimistic posting feels
 * faster than waiting on the round-trip; on error we restore the draft so
 * the user doesn't lose what they typed.
 */
type Props = {
  reportId: string
  // Tailwind accents to match the host product's palette. Defaults to the
  // purple variant used on openapk-frontend; openbin passes amber.
  accent?: 'purple' | 'amber'
}

export function CommentsThread({ reportId, accent = 'purple' }: Props) {
  const auth = useAuth()
  const api = useApi()
  const [comments, setComments] = useState<CommentResponse[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [draft, setDraft] = useState('')
  const [replyParent, setReplyParent] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState('')

  const reload = useCallback(async () => {
    try {
      const rows = await api<CommentResponse[]>(commentsPath(reportId))
      setComments(rows)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load comments')
    }
  }, [api, reportId])

  useEffect(() => { void reload() }, [reload])

  const submitTopLevel = useCallback(async () => {
    if (!auth.isAuthenticated) { void auth.signinRedirect(); return }
    const body = draft.trim()
    if (!body) return
    setPosting(true)
    try {
      await api<CommentResponse>(postCommentPath(), {
        method: 'POST',
        body: JSON.stringify({ reportId, body }),
      })
      setDraft('')
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post comment')
    } finally {
      setPosting(false)
    }
  }, [api, auth, draft, reload, reportId])

  const submitReply = useCallback(async (parentCommentId: string) => {
    if (!auth.isAuthenticated) { void auth.signinRedirect(); return }
    const body = replyDraft.trim()
    if (!body) return
    setPosting(true)
    try {
      await api<CommentResponse>(postCommentPath(), {
        method: 'POST',
        body: JSON.stringify({ reportId, parentCommentId, body }),
      })
      setReplyDraft('')
      setReplyParent(null)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post reply')
    } finally {
      setPosting(false)
    }
  }, [api, auth, replyDraft, reload, reportId])

  const remove = useCallback(async (commentId: string) => {
    if (!confirm('Delete this comment? It will show as "[deleted]" but stay in the thread.')) return
    try {
      await api(deleteCommentPath(commentId), { method: 'DELETE' })
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete comment')
    }
  }, [api, reload])

  const accentBtn = accent === 'amber'
    ? 'bg-amber-500 text-black hover:bg-amber-400'
    : 'bg-purple-600 text-white hover:bg-purple-500'
  const accentLink = accent === 'amber' ? 'text-amber-400' : 'text-purple-400'
  const accentFocus = accent === 'amber'
    ? 'focus:border-amber-500'
    : 'focus:border-purple-600'

  const total = comments?.reduce((n, c) => n + 1 + c.replies.length, 0) ?? 0

  return (
    <section className="mt-8 border-t border-zinc-800 pt-6">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-medium text-zinc-100">
          Discussion {comments && <span className="text-zinc-500">({total})</span>}
        </h2>
      </header>

      {/* Top-level composer */}
      {auth.isAuthenticated ? (
        <div className="mb-6 rounded border border-zinc-800 bg-zinc-900/40 p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Share what you found, ask a question, or push back…"
            rows={3}
            maxLength={4000}
            className={`w-full resize-y rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none ${accentFocus}`}
          />
          <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
            <span>{draft.length} / 4000</span>
            <button
              type="button"
              onClick={submitTopLevel}
              disabled={posting || !draft.trim()}
              className={`rounded px-3 py-1.5 text-xs font-semibold ${accentBtn} disabled:opacity-50`}
            >
              {posting ? 'Posting…' : 'Post comment'}
            </button>
          </div>
        </div>
      ) : (
        <p className="mb-6 rounded border border-zinc-800 bg-zinc-900/40 px-3 py-3 text-sm text-zinc-400">
          <button
            type="button"
            onClick={() => void auth.signinRedirect()}
            className={`${accentLink} hover:underline`}
          >
            Sign in
          </button>{' '}
          to join the discussion.
        </p>
      )}

      {error && (
        <p className="mb-4 rounded border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {!comments && <p className="text-sm text-zinc-500">Loading discussion…</p>}
      {comments && comments.length === 0 && (
        <p className="text-sm text-zinc-500">No comments yet. Be first.</p>
      )}

      {comments && comments.length > 0 && (
        <ul className="space-y-5">
          {comments.map((c) => (
            <li key={c.id}>
              <CommentRow
                c={c}
                accentLink={accentLink}
                onReply={() => { setReplyParent(c.id); setReplyDraft('') }}
                onDelete={() => void remove(c.id)}
              />
              {/* Replies are rendered indented under the top-level comment. */}
              {c.replies.length > 0 && (
                <ul className="mt-3 ml-8 space-y-3 border-l border-zinc-800 pl-4">
                  {c.replies.map((r) => (
                    <li key={r.id}>
                      <CommentRow
                        c={r}
                        accentLink={accentLink}
                        // No reply button on replies — schema is depth-1.
                        onReply={null}
                        onDelete={() => void remove(r.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {/* Reply composer is mounted under whichever top-level comment
                  the user clicked Reply on. Only one open at a time. */}
              {replyParent === c.id && auth.isAuthenticated && (
                <div className="mt-3 ml-8 rounded border border-zinc-800 bg-zinc-950/60 p-3">
                  <textarea
                    value={replyDraft}
                    onChange={(e) => setReplyDraft(e.target.value)}
                    placeholder={`Reply to ${c.authorDisplayName}…`}
                    rows={2}
                    maxLength={4000}
                    autoFocus
                    className={`w-full resize-y rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none ${accentFocus}`}
                  />
                  <div className="mt-2 flex items-center justify-end gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => { setReplyParent(null); setReplyDraft('') }}
                      className="rounded border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitReply(c.id)}
                      disabled={posting || !replyDraft.trim()}
                      className={`rounded px-3 py-1 font-semibold ${accentBtn} disabled:opacity-50`}
                    >
                      {posting ? 'Posting…' : 'Reply'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CommentRow({
  c,
  accentLink,
  onReply,
  onDelete,
}: {
  c: CommentResponse
  accentLink: string
  onReply: (() => void) | null
  onDelete: () => void
}) {
  return (
    <article className="flex gap-3">
      <div className="shrink-0">
        {c.authorId ? (
          // Plain <a> instead of router Link because this component lives
          // in shared/ and can't depend on react-router-dom. Full page
          // reload on click is acceptable for an author-profile navigation.
          <a href={`/u/${c.authorId}`}>
            <Gravatar emailMd5={c.authorEmailMd5} size={32} />
          </a>
        ) : (
          <Gravatar emailMd5={c.authorEmailMd5} size={32} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
          {c.authorId ? (
            <a href={`/u/${c.authorId}`} className="text-sm font-medium text-zinc-200 hover:underline">
              {c.authorDisplayName}
            </a>
          ) : (
            <span className="text-sm font-medium text-zinc-500 italic">{c.authorDisplayName}</span>
          )}
          <time
            className="text-zinc-500"
            title={new Date(c.createdAt).toLocaleString()}
          >
            {formatRelative(c.createdAt)}
          </time>
        </div>
        <p className={`mt-1 whitespace-pre-wrap text-sm ${c.deleted ? 'italic text-zinc-600' : 'text-zinc-200'}`}>
          {c.body}
        </p>
        {!c.deleted && (
          <div className="mt-2 flex gap-3 text-xs text-zinc-500">
            {onReply && (
              <button
                type="button"
                onClick={onReply}
                className={`hover:underline ${accentLink}`}
              >
                Reply
              </button>
            )}
            {c.mine && (
              <button
                type="button"
                onClick={onDelete}
                className="hover:text-red-400"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Math.max(0, Date.now() - then)
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
