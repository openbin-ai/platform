import { useCallback, useEffect, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { useApi } from '@shared/api/client'
import { Gravatar } from '@shared/components/Gravatar'
import {
  commentsPath,
  deleteCommentPath,
  postCommentPath,
  type CommentResponse,
  type CommentSort,
} from '@shared/api/comments'

/**
 * Threaded discussion under a community report (GitHub × Reddit). Threads
 * nest to arbitrary depth; the visual indent is capped and deeper replies
 * shift to a "continue thread" style flat indent so the column stays readable.
 * Root comments are sorted hot / new / top (server-side); replies within a
 * thread stay chronological.
 *
 * Anonymous viewers can read but the composer redirects them through Keycloak.
 */
type Props = {
  reportId: string
  accent?: 'purple' | 'amber'
}

// Left-indent stops growing past this depth; further nesting renders at the
// cap so a deep chain doesn't march off the right edge.
const MAX_INDENT = 6

// Shared handlers/state passed down the recursive tree (defined once so the
// reply textarea doesn't remount — and lose focus — on each keystroke).
type ThreadCtx = {
  isAuth: boolean
  posting: boolean
  replyParent: string | null
  replyDraft: string
  setReplyParent: (id: string | null) => void
  setReplyDraft: (v: string) => void
  submitReply: (parentId: string) => void
  remove: (id: string) => void
  accentLink: string
  accentBtn: string
  accentFocus: string
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
  const [sort, setSort] = useState<CommentSort>('hot')

  const reload = useCallback(async () => {
    try {
      const rows = await api<CommentResponse[]>(commentsPath(reportId, sort))
      setComments(rows)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load comments')
    }
  }, [api, reportId, sort])

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
  const accentFocus = accent === 'amber' ? 'focus:border-amber-500' : 'focus:border-purple-600'

  const total = comments ? countAll(comments) : 0

  const ctx: ThreadCtx = {
    isAuth: auth.isAuthenticated,
    posting,
    replyParent,
    replyDraft,
    setReplyParent,
    setReplyDraft,
    submitReply,
    remove,
    accentLink,
    accentBtn,
    accentFocus,
  }

  return (
    <section className="mt-8 border-t border-zinc-800 pt-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-medium text-zinc-100">
          Discussion {comments && <span className="text-zinc-500">({total})</span>}
        </h2>
        {comments && comments.length > 0 && (
          <div className="flex items-center gap-1 text-xs">
            {(['hot', 'new', 'top'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSort(s)}
                className={`rounded px-2 py-0.5 capitalize ${
                  sort === s ? `${accentLink} font-semibold` : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </header>

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
              <CommentNode c={c} depth={0} ctx={ctx} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// Recursive thread node: the comment, an optional reply composer, and its
// children (each a CommentNode at depth+1). Indent is capped at MAX_INDENT.
function CommentNode({ c, depth, ctx }: { c: CommentResponse; depth: number; ctx: ThreadCtx }) {
  const indented = depth > 0
  return (
    <div className={indented ? 'mt-3 border-l border-zinc-800 pl-4' : ''}>
      <CommentRow
        c={c}
        accentLink={ctx.accentLink}
        onReply={c.deleted ? null : () => { ctx.setReplyParent(c.id); ctx.setReplyDraft('') }}
        onDelete={() => ctx.remove(c.id)}
      />

      {ctx.replyParent === c.id && ctx.isAuth && (
        <div className="mt-3 rounded border border-zinc-800 bg-zinc-950/60 p-3">
          <textarea
            value={ctx.replyDraft}
            onChange={(e) => ctx.setReplyDraft(e.target.value)}
            placeholder={`Reply to ${c.authorDisplayName}…`}
            rows={2}
            maxLength={4000}
            autoFocus
            className={`w-full resize-y rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none ${ctx.accentFocus}`}
          />
          <div className="mt-2 flex items-center justify-end gap-2 text-xs">
            <button
              type="button"
              onClick={() => { ctx.setReplyParent(null); ctx.setReplyDraft('') }}
              className="rounded border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => ctx.submitReply(c.id)}
              disabled={ctx.posting || !ctx.replyDraft.trim()}
              className={`rounded px-3 py-1 font-semibold ${ctx.accentBtn} disabled:opacity-50`}
            >
              {ctx.posting ? 'Posting…' : 'Reply'}
            </button>
          </div>
        </div>
      )}

      {c.replies.length > 0 && (
        <div className={depth < MAX_INDENT ? 'ml-8' : 'ml-0'}>
          {c.replies.map((r) => (
            <CommentNode key={r.id} c={r} depth={Math.min(depth + 1, MAX_INDENT)} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
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
          // Plain <a> instead of router Link — this component lives in shared/
          // and can't depend on react-router-dom.
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
          <time className="text-zinc-500" title={new Date(c.createdAt).toLocaleString()}>
            {formatRelative(c.createdAt)}
          </time>
        </div>
        <p className={`mt-1 whitespace-pre-wrap text-sm ${c.deleted ? 'italic text-zinc-600' : 'text-zinc-200'}`}>
          {c.body}
        </p>
        {!c.deleted && (
          <div className="mt-2 flex gap-3 text-xs text-zinc-500">
            {onReply && (
              <button type="button" onClick={onReply} className={`hover:underline ${accentLink}`}>
                Reply
              </button>
            )}
            {c.mine && (
              <button type="button" onClick={onDelete} className="hover:text-red-400">
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

function countAll(list: CommentResponse[]): number {
  return list.reduce((n, c) => n + 1 + countAll(c.replies), 0)
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
