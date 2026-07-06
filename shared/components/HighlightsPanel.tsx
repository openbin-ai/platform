import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react'
import { useApi } from '@shared/api/client'
import {
  type Highlight,
  type HighlightType,
  type CreateHighlightRequest,
  HIGHLIGHT_TYPE_META,
  mediaUrl,
} from '@shared/api/highlights'

// The Highlights board: a curated evidence layer over the project's shared
// media store (the Gallery stays the raw capture bin). Cards anchor to a
// FUNCTION, a FILE, or stand alone as a VISUAL screenshot; each carries an
// optional tag + note and records its author for the contributor byline.
// Reads are visible to any member (and later public/fork viewers); writes are
// gated by `canEdit`. Auto-populated by the screenshot flow (see
// AddHighlightModal) but also editable directly here.
//
// `Img` is injected because the authenticated-image component lives per-frontend
// (openbin-frontend / openapk-frontend each have their own AuthenticatedImg
// that knows the S3-presign vs blob dance); the shared board stays agnostic.

type Props = {
  projectId: string
  canEdit: boolean
  Img: ComponentType<{ src: string; className?: string }>
  /** Bump to force a refetch (e.g. after a screenshot adds a highlight). */
  refreshKey?: number
  /** Pre-fills the "add" form's anchor with the current selection. */
  defaultTarget?: { type: 'FUNCTION' | 'FILE'; ref: string } | null
  /** Click an anchored card to jump to its target in the main view. */
  onNavigate?: (h: Highlight) => void
}

export function HighlightsPanel({
  projectId, canEdit, Img, refreshKey = 0, defaultTarget, onNavigate,
}: Props) {
  const api = useApi()
  const [items, setItems] = useState<Highlight[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      setItems(await api<Highlight[]>(`/api/projects/${projectId}/highlights`))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [api, projectId])

  useEffect(() => { void load() }, [load, refreshKey])

  const tags = useMemo(() => {
    const s = new Set<string>()
    for (const h of items ?? []) if (h.tag) s.add(h.tag)
    return [...s].sort()
  }, [items])

  const shown = useMemo(() => {
    const list = items ?? []
    return tagFilter ? list.filter(h => h.tag === tagFilter) : list
  }, [items, tagFilter])

  async function remove(id: string) {
    if (!window.confirm('Remove this highlight? The underlying screenshot stays in the Gallery.')) return
    try {
      await api(`/api/projects/${projectId}/highlights/${id}`, { method: 'DELETE' })
      setItems(prev => prev?.filter(h => h.id !== id) ?? null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function patch(id: string, body: { tag?: string | null; note?: string | null; position?: number }) {
    const updated = await api<Highlight>(`/api/projects/${projectId}/highlights/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    })
    setItems(prev => prev?.map(h => (h.id === id ? updated : h)) ?? null)
    return updated
  }

  // Reorder by swapping adjacent positions. Works against the FULL list order
  // (not the filtered view) so it's disabled while a tag filter is active.
  async function move(id: string, dir: -1 | 1) {
    if (!items) return
    const idx = items.findIndex(h => h.id === id)
    const swapIdx = idx + dir
    if (idx < 0 || swapIdx < 0 || swapIdx >= items.length) return
    const a = items[idx], b = items[swapIdx]
    try {
      await Promise.all([
        api(`/api/projects/${projectId}/highlights/${a.id}`, { method: 'PATCH', body: JSON.stringify({ position: b.position }) }),
        api(`/api/projects/${projectId}/highlights/${b.id}`, { method: 'PATCH', body: JSON.stringify({ position: a.position }) }),
      ])
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (error) return <p className="p-3 text-xs text-red-400">Highlights failed: {error}</p>
  if (items === null) return <p className="p-3 text-xs text-zinc-500">Loading…</p>

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <FilterChip active={tagFilter === null} onClick={() => setTagFilter(null)}>
            All · {items.length}
          </FilterChip>
          {tags.map(t => (
            <FilterChip key={t} active={tagFilter === t} onClick={() => setTagFilter(t)}>
              {t}
            </FilterChip>
          ))}
        </div>
        {canEdit && (
          <button
            onClick={() => setAdding(a => !a)}
            className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800"
          >
            {adding ? 'Cancel' : '+ Add'}
          </button>
        )}
      </div>

      {adding && canEdit && (
        <AddHighlightForm
          projectId={projectId}
          defaultTarget={defaultTarget}
          onDone={(created) => {
            setAdding(false)
            if (created) setItems(prev => (prev ? [...prev, created] : [created]))
          }}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <div className="p-4 text-xs text-zinc-500">
            {tagFilter
              ? 'No highlights with this tag.'
              : 'No highlights yet. Pin a function, file, or an annotated screenshot here to build the evidence board — it auto-assembles the report’s Highlights section.'}
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {shown.map((h, i) => (
              <HighlightCard
                key={h.id}
                h={h}
                projectId={projectId}
                canEdit={canEdit}
                Img={Img}
                onNavigate={onNavigate}
                onDelete={() => void remove(h.id)}
                onSave={(body) => patch(h.id, body)}
                onMoveUp={tagFilter === null && i > 0 ? () => void move(h.id, -1) : undefined}
                onMoveDown={tagFilter === null && i < shown.length - 1 ? () => void move(h.id, 1) : undefined}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${
        active
          ? 'border-purple-600 bg-purple-950/40 text-purple-200'
          : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  )
}

function HighlightCard({
  h, projectId, canEdit, Img, onNavigate, onDelete, onSave, onMoveUp, onMoveDown,
}: {
  h: Highlight
  projectId: string
  canEdit: boolean
  Img: ComponentType<{ src: string; className?: string }>
  onNavigate?: (h: Highlight) => void
  onDelete: () => void
  onSave: (body: { tag?: string | null; note?: string | null }) => Promise<Highlight>
  onMoveUp?: () => void
  onMoveDown?: () => void
}) {
  const meta = HIGHLIGHT_TYPE_META[h.type]
  const [editing, setEditing] = useState(false)
  const [tag, setTag] = useState(h.tag ?? '')
  const [note, setNote] = useState(h.note ?? '')
  const [saving, setSaving] = useState(false)
  const anchored = h.type !== 'VISUAL' && h.targetRef

  async function save() {
    setSaving(true)
    try {
      await onSave({ tag: tag.trim() || null, note: note.trim() || null })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="p-3">
      <div className="flex items-start gap-2">
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${meta.accent}`} title={meta.label}>
          {meta.icon} {meta.label}
        </span>
        {anchored && (
          <button
            onClick={() => onNavigate?.(h)}
            disabled={!onNavigate}
            className="min-w-0 flex-1 truncate text-left font-mono text-xs text-zinc-200 hover:text-purple-300 disabled:hover:text-zinc-200"
            title={onNavigate ? `Go to ${h.targetRef}` : h.targetRef ?? ''}
          >
            {h.targetRef}
          </button>
        )}
        {!anchored && <span className="min-w-0 flex-1" />}
        {canEdit && (
          <div className="flex shrink-0 items-center gap-0.5 text-zinc-500">
            {onMoveUp && <button onClick={onMoveUp} title="Move up" className="rounded px-1 hover:bg-zinc-800 hover:text-zinc-200">↑</button>}
            {onMoveDown && <button onClick={onMoveDown} title="Move down" className="rounded px-1 hover:bg-zinc-800 hover:text-zinc-200">↓</button>}
            <button onClick={() => setEditing(e => !e)} title="Edit tag / note" className="rounded px-1 hover:bg-zinc-800 hover:text-zinc-200">✎</button>
            <button onClick={onDelete} title="Remove highlight" className="rounded px-1 hover:bg-zinc-800 hover:text-red-400">✕</button>
          </div>
        )}
      </div>

      {h.mediaKey && (
        <div className="mt-2 overflow-hidden rounded border border-zinc-800 bg-zinc-950">
          <Img src={mediaUrl(projectId, h.mediaKey)} className="block max-h-48 w-full object-contain" />
        </div>
      )}

      {editing ? (
        <div className="mt-2 space-y-2">
          <input
            value={tag}
            onChange={e => setTag(e.target.value)}
            placeholder="tag (e.g. crypto, c2)"
            maxLength={48}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
          />
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="note"
            rows={2}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => { setEditing(false); setTag(h.tag ?? ''); setNote(h.note ?? '') }} className="rounded px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800">Cancel</button>
            <button onClick={() => void save()} disabled={saving} className="rounded border border-purple-700/60 bg-purple-950/40 px-2 py-1 text-[11px] text-purple-200 hover:bg-purple-900/50 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {h.tag && (
            <span className="mt-2 inline-block rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-300">
              #{h.tag}
            </span>
          )}
          {h.note && <p className="mt-1.5 whitespace-pre-wrap text-xs text-zinc-400">{h.note}</p>}
        </>
      )}

      <div className="mt-2 text-[10px] text-zinc-600">
        {h.createdByName ? `by ${h.createdByName}` : 'author unknown'}
        {' · '}{new Date(h.createdAt).toLocaleDateString()}
      </div>
    </li>
  )
}

function AddHighlightForm({
  projectId, defaultTarget, onDone,
}: {
  projectId: string
  defaultTarget?: { type: 'FUNCTION' | 'FILE'; ref: string } | null
  onDone: (created: Highlight | null) => void
}) {
  const api = useApi()
  const [type, setType] = useState<HighlightType>(defaultTarget?.type ?? 'FUNCTION')
  const [targetRef, setTargetRef] = useState(defaultTarget?.ref ?? '')
  const [tag, setTag] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setErr(null)
    if (type !== 'VISUAL' && !targetRef.trim()) {
      setErr('A function or file highlight needs a target. Switch to Visual for a standalone note.')
      return
    }
    setSaving(true)
    try {
      const body: CreateHighlightRequest = {
        type,
        targetRef: type === 'VISUAL' ? null : targetRef.trim(),
        tag: tag.trim() || null,
        note: note.trim() || null,
      }
      const created = await api<Highlight>(`/api/projects/${projectId}/highlights`, {
        method: 'POST', body: JSON.stringify(body),
      })
      onDone(created)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2 border-b border-zinc-800 bg-zinc-950/40 p-3">
      {err && <p className="text-[11px] text-red-400">{err}</p>}
      <div className="flex gap-1">
        {(['FUNCTION', 'FILE', 'VISUAL'] as const).map(t => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`flex-1 rounded border px-2 py-1 text-[11px] ${
              type === t ? HIGHLIGHT_TYPE_META[t].accent : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
            }`}
          >
            {HIGHLIGHT_TYPE_META[t].icon} {HIGHLIGHT_TYPE_META[t].label}
          </button>
        ))}
      </div>
      {type !== 'VISUAL' && (
        <input
          value={targetRef}
          onChange={e => setTargetRef(e.target.value)}
          placeholder={type === 'FUNCTION' ? 'function name or address' : 'file path'}
          maxLength={512}
          className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
        />
      )}
      <input
        value={tag}
        onChange={e => setTag(e.target.value)}
        placeholder="tag (optional)"
        maxLength={48}
        className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
      />
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="note (optional)"
        rows={2}
        className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
      />
      <div className="flex justify-end">
        <button
          onClick={() => void submit()}
          disabled={saving}
          className="rounded border border-purple-700/60 bg-purple-950/40 px-3 py-1 text-[11px] text-purple-200 hover:bg-purple-900/50 disabled:opacity-50"
        >
          {saving ? 'Adding…' : 'Add highlight'}
        </button>
      </div>
    </div>
  )
}
