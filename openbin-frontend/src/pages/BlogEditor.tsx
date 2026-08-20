import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApi } from '@shared/api/client'
import { Markdown } from '../components/Markdown'
import {
  createPostPath,
  deletePostPath,
  myPostsPath,
  publishPostPath,
  updatePostPath,
  type BlogPostDetail,
  type BlogPostSummary,
} from '@shared/api/blog'

/**
 * Write or edit a post.
 *
 * Dropping a .md/.txt file fills the editor rather than publishing straight
 * through: people were already writing in their own editor and uploading the
 * file, and the last thing that workflow needs is a one-shot upload with no
 * chance to fix the title or preview the code blocks.
 */
export function BlogEditor() {
  const { id } = useParams()
  const api = useApi()
  const nav = useNavigate()

  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [body, setBody] = useState('')
  const [post, setPost] = useState<BlogPostDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [showPreview, setShowPreview] = useState(true)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Editing an existing post: the list endpoint is the only one keyed by id
  // (the public read is by slug), so resolve through it.
  useEffect(() => {
    if (!id) return
    void (async () => {
      try {
        const mine = await api<BlogPostSummary[]>(myPostsPath())
        const row = mine.find((p) => p.id === id)
        if (!row) { setError('Post not found'); return }
        const detail = await api<BlogPostDetail>(`/api/community/blog/${encodeURIComponent(row.slug)}`)
        setPost(detail)
        setTitle(detail.title)
        setSummary(detail.summary ?? '')
        setBody(detail.bodyMd)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load post')
      }
    })()
  }, [api, id])

  const ingestFile = useCallback(async (file: File) => {
    const name = file.name.toLowerCase()
    if (!/\.(md|markdown|txt|text)$/.test(name)) {
      setError('Drop a .md or .txt file — this is a writing surface, not an analysis upload.')
      return
    }
    if (file.size > 2_000_000) {
      setError('That file is over 2 MB. If it is really a post, paste the part you want to publish.')
      return
    }
    const text = await file.text()
    setBody(text)
    setError(null)
    // A leading "# Heading" is almost always the title; lift it so the author
    // doesn't retype it, and drop it from the body to avoid a double heading.
    if (!title.trim()) {
      const m = /^\s*#\s+(.+)$/m.exec(text)
      if (m) {
        setTitle(m[1].trim())
        setBody(text.replace(m[0], '').replace(/^\s*\n/, ''))
      } else {
        setTitle(file.name.replace(/\.(md|markdown|txt|text)$/i, ''))
      }
    }
  }, [title])

  const save = useCallback(async (publish?: boolean) => {
    if (!title.trim() || !body.trim()) {
      setError('A title and some body text are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const payload = JSON.stringify({ title: title.trim(), summary: summary.trim(), bodyMd: body })
      const saved = post
        ? await api<BlogPostDetail>(updatePostPath(post.id), { method: 'PUT', body: payload })
        : await api<BlogPostDetail>(createPostPath(), { method: 'POST', body: payload })
      setPost(saved)

      if (publish !== undefined) {
        const after = await api<BlogPostDetail>(publishPostPath(saved.id, publish), { method: 'POST' })
        setPost(after)
        if (publish) { nav(`/blog/${after.slug}`); return }
      }
      if (!post) nav(`/blog/${saved.id}/edit`, { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setBusy(false)
    }
  }, [api, body, nav, post, summary, title])

  const remove = useCallback(async () => {
    if (!post) return
    if (!confirm('Delete this post? This cannot be undone.')) return
    try {
      await api(deletePostPath(post.id), { method: 'DELETE' })
      nav('/blog')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    }
  }, [api, nav, post])

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-zinc-100">
          {post ? (post.draft ? 'Edit draft' : 'Edit post') : 'New post'}
        </h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
          >
            {showPreview ? 'Hide preview' : 'Show preview'}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-600 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save draft'}
          </button>
          {post && !post.draft ? (
            <button
              type="button"
              onClick={() => void save(false)}
              disabled={busy}
              className="rounded border border-amber-800 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-950/40 disabled:opacity-50"
            >
              Unpublish
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void save(true)}
              disabled={busy}
              className="rounded bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-50"
            >
              Publish
            </button>
          )}
          {post && (
            <button
              type="button"
              onClick={() => void remove()}
              className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-red-400"
            >
              Delete
            </button>
          )}
        </div>
      </header>

      {error && (
        <p className="mb-3 rounded border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</p>
      )}
      {post && !post.draft && (
        <p className="mb-3 text-xs text-zinc-500">
          Published at <code className="text-zinc-400">/blog/{post.slug}</code> — the link stays put
          even if you change the title.
        </p>
      )}

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        maxLength={300}
        className="w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-lg text-zinc-100 placeholder:text-zinc-600 focus:border-purple-600 focus:outline-none"
      />
      <input
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="One-line summary for the feed (optional)"
        maxLength={500}
        className="mt-2 w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-300 placeholder:text-zinc-600 focus:border-purple-600 focus:outline-none"
      />

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const f = e.dataTransfer.files?.[0]
          if (f) void ingestFile(f)
        }}
        className={`mt-3 grid gap-3 ${showPreview ? 'md:grid-cols-2' : 'grid-cols-1'}`}
      >
        <div className="relative">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write in markdown — or drop a .md / .txt file anywhere in this area."
            rows={26}
            className={`w-full resize-y rounded border bg-zinc-950 px-3 py-2 font-mono text-[13px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none ${
              dragging ? 'border-purple-500' : 'border-zinc-800 focus:border-purple-600'
            }`}
          />
          <div className="mt-1 flex items-center justify-between text-xs text-zinc-600">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-purple-400 hover:underline"
            >
              Upload a .md / .txt file
            </button>
            <span>{body.length.toLocaleString()} chars</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".md,.markdown,.txt,.text,text/markdown,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void ingestFile(f)
              e.target.value = ''
            }}
          />
        </div>

        {showPreview && (
          <div className="prose prose-invert prose-sm max-w-none overflow-y-auto rounded border border-zinc-800 bg-zinc-900/30 p-3 prose-zinc prose-headings:text-zinc-200 prose-a:text-purple-400">
            {body.trim()
              ? <Markdown>{body}</Markdown>
              : <p className="text-sm text-zinc-600">Preview appears here.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
