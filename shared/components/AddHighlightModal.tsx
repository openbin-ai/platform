import { useEffect, useState, type ComponentType } from 'react'
import { useApi } from '@shared/api/client'
import {
  type Highlight,
  type HighlightType,
  type CreateHighlightRequest,
  HIGHLIGHT_TYPE_META,
  mediaUrl,
} from '@shared/api/highlights'

// The "Add to Highlights?" prompt shown right after a screenshot is saved to
// the shared media store. Declining is a no-op (the shot still lives in the
// Gallery, today's behavior). Accepting pins the annotated screenshot to the
// evidence board — pre-anchored to the currently-open function/file when the
// caller could detect one, else as a standalone VISUAL.
//
// The screenshot is ALREADY uploaded by the time this opens; we only reference
// its media key. `Img` is injected (per-frontend AuthenticatedImg) like the
// board itself.

export function AddHighlightModal({
  projectId, mediaKey, defaultTarget, Img, onClose, onCreated,
}: {
  projectId: string
  mediaKey: string
  /** The open function/file, offered as the default anchor when present. */
  defaultTarget?: { type: 'FUNCTION' | 'FILE'; ref: string } | null
  Img: ComponentType<{ src: string; className?: string }>
  onClose: () => void
  onCreated: (h: Highlight) => void
}) {
  const api = useApi()
  const [type, setType] = useState<HighlightType>(defaultTarget?.type ?? 'VISUAL')
  const [targetRef, setTargetRef] = useState(defaultTarget?.ref ?? '')
  const [tag, setTag] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  async function submit() {
    setErr(null)
    if (type !== 'VISUAL' && !targetRef.trim()) {
      setErr('A function or file highlight needs a target — or switch to Visual.')
      return
    }
    setSaving(true)
    try {
      const body: CreateHighlightRequest = {
        type,
        targetRef: type === 'VISUAL' ? null : targetRef.trim(),
        mediaKey,
        tag: tag.trim() || null,
        note: note.trim() || null,
      }
      const created = await api<Highlight>(`/api/projects/${projectId}/highlights`, {
        method: 'POST', body: JSON.stringify(body),
      })
      onCreated(created)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-capture-hide className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
          <h2 className="text-sm font-medium text-zinc-100">Add to Highlights?</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">✕</button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-xs text-zinc-500">
            Saved to the Gallery. Pin it to the evidence board too — highlights auto-assemble the report’s Highlights section.
          </p>
          <div className="overflow-hidden rounded border border-zinc-800 bg-zinc-950">
            <Img src={mediaUrl(projectId, mediaKey)} className="block max-h-56 w-full object-contain" />
          </div>

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
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-2.5">
          <button onClick={onClose} className="rounded px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-800">
            Skip
          </button>
          <button
            onClick={() => void submit()}
            disabled={saving}
            className="rounded border border-purple-700/60 bg-purple-950/40 px-3 py-1 text-xs text-purple-200 hover:bg-purple-900/50 disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add to Highlights'}
          </button>
        </div>
      </div>
    </div>
  )
}
