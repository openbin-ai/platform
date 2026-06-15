import { useCallback, useEffect, useState } from 'react'
import { useApi } from '@shared/api/client'
import { AuthenticatedImg } from './AuthenticatedImg'

export type MediaItem = {
  filename: string
  url: string
  sizeBytes: number
  createdAt: string
}

/**
 * Project media gallery. Two modes:
 * - browse: renders a thumbnail grid with delete buttons; used as the right-panel Gallery tab.
 * - pick:   renders the same grid but each thumbnail calls onPick(url) when clicked;
 *           no delete buttons. Used by the report section's "Insert from gallery" modal.
 *
 * `refreshKey` bumps refetch — pass an incrementing counter from the parent
 * after an upload so the grid shows the new image.
 */
export function Gallery({
  projectId,
  mode = 'browse',
  onPick,
  refreshKey = 0,
  large = false,
  selectedUrl,
}: {
  projectId: string
  mode?: 'browse' | 'pick'
  onPick?: (item: MediaItem) => void
  refreshKey?: number
  /** Bigger thumbnails (used in the picker modal so screenshots are
   *  actually identifiable). Browse mode keeps the default density. */
  large?: boolean
  /** Picker-mode highlight ring for the currently selected item. */
  selectedUrl?: string | null
}) {
  const api = useApi()
  const [items, setItems] = useState<MediaItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deletingName, setDeletingName] = useState<string | null>(null)
  // Browse-mode click-to-preview. Pick mode previews via the picker modal.
  const [lightbox, setLightbox] = useState<MediaItem | null>(null)

  useEffect(() => {
    if (!lightbox) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [lightbox])

  const reload = useCallback(async () => {
    setError(null)
    try {
      const list = await api<MediaItem[]>(`/api/projects/${projectId}/media`)
      setItems(list)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [api, projectId])

  useEffect(() => { void reload() }, [reload, refreshKey])

  async function remove(filename: string) {
    if (!window.confirm(`Delete ${filename.slice(0, 8)}…? Any report that references it will show a broken link.`)) return
    setDeletingName(filename)
    try {
      await api(`/api/projects/${projectId}/media/${filename}`, { method: 'DELETE' })
      setItems(prev => prev?.filter(it => it.filename !== filename) ?? null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDeletingName(null)
    }
  }

  if (error) {
    return <p className="p-3 text-xs text-red-400">Gallery failed: {error}</p>
  }
  if (items === null) {
    return <p className="p-3 text-xs text-zinc-500">Loading…</p>
  }
  if (items.length === 0) {
    return (
      <div className="p-4 text-xs text-zinc-500">
        No screenshots yet. Use the 📸 or 📷 button in the code viewer header to add one.
      </div>
    )
  }

  const minCol = large ? 200 : 120
  const thumbHCls = large ? 'h-40' : 'h-24'

  return (
    <div className="grid gap-2 p-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minCol}px, 1fr))` }}>
      {items.map(item => {
        const selected = mode === 'pick' && selectedUrl === item.url
        return (
        <div
          key={item.filename}
          className={`group relative overflow-hidden rounded border bg-zinc-950 ${
            selected ? 'border-amber-500 ring-2 ring-amber-500/60' : 'border-zinc-800'
          }`}
        >
          {mode === 'pick' ? (
            <button
              onClick={() => onPick?.(item)}
              className="block w-full text-left"
              title="Click to preview"
            >
              <AuthenticatedImg src={item.url} className={`block ${thumbHCls} w-full object-contain bg-zinc-950 hover:opacity-90`} />
            </button>
          ) : (
            <button
              onClick={() => setLightbox(item)}
              className="block w-full"
              title="Click to preview"
            >
              <AuthenticatedImg src={item.url} className={`block ${thumbHCls} w-full object-cover hover:opacity-90`} />
            </button>
          )}
          <div className="flex items-center justify-between border-t border-zinc-800 px-1.5 py-1 text-[10px] text-zinc-500">
            <span title={new Date(item.createdAt).toLocaleString()}>
              {formatRelative(item.createdAt)}
            </span>
            {mode === 'browse' && (
              <button
                onClick={() => remove(item.filename)}
                disabled={deletingName === item.filename}
                className="rounded text-zinc-500 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100 disabled:opacity-30"
                title="Delete"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        )
      })}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/80 p-6"
          onClick={() => setLightbox(null)}
        >
          <div className="flex items-center justify-end">
            <button
              onClick={() => setLightbox(null)}
              className="rounded p-1 text-zinc-300 hover:bg-zinc-800 hover:text-white"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-auto" onClick={e => e.stopPropagation()}>
            <AuthenticatedImg
              src={lightbox.url}
              className="max-h-full max-w-full rounded border border-zinc-800 object-contain"
            />
          </div>
          <div className="mt-2 text-center text-[11px] text-zinc-400">
            <span className="font-mono">{lightbox.filename.slice(0, 16)}…</span>
            {' · '}{(lightbox.sizeBytes / 1024).toFixed(0)} KB
            {' · '}press Esc or click outside to close
          </div>
        </div>
      )}
    </div>
  )
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return new Date(iso).toLocaleDateString()
}
