import { useEffect, useState } from 'react'
import { Gallery, type MediaItem } from './Gallery'
import { AuthenticatedImg } from './AuthenticatedImg'

/**
 * Modal that shows the project gallery in pick mode.
 *
 * Two-step UX: click a thumbnail to preview it large, then "Insert" to
 * commit. Lets the user actually see which screenshot is which before
 * dropping it into the report.
 */
export function GalleryPickerModal({
  projectId, onClose, onPick,
}: {
  projectId: string
  onClose: () => void
  onPick: (url: string) => void
}) {
  const [selected, setSelected] = useState<MediaItem | null>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && selected) onPick(selected.url)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose, onPick, selected])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="flex h-full max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
          <h2 className="text-sm font-medium text-zinc-100">
            {selected ? 'Preview & insert' : 'Pick a screenshot'}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {selected && (
          <div className="flex flex-col items-center gap-3 border-b border-zinc-800 bg-zinc-950 px-4 py-3">
            <AuthenticatedImg
              src={selected.url}
              className="max-h-[50vh] max-w-full rounded border border-zinc-800 object-contain"
            />
            <div className="flex w-full items-center justify-between gap-2">
              <div className="min-w-0 text-[11px] text-zinc-500">
                <span className="font-mono">{selected.filename.slice(0, 16)}…</span>
                {' · '}
                <span>{(selected.sizeBytes / 1024).toFixed(0)} KB</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelected(null)}
                  className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  Choose different
                </button>
                <button
                  onClick={() => onPick(selected.url)}
                  className="rounded bg-amber-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-amber-500"
                >
                  Insert this screenshot
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          <Gallery
            projectId={projectId}
            mode="pick"
            large
            selectedUrl={selected?.url ?? null}
            onPick={item => setSelected(item)}
          />
        </div>
      </div>
    </div>
  )
}
