import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi } from '../api/client'
import { Annotator } from './Annotator'

type Stage = 'pick' | 'edit'

/**
 * Modal for attaching an image to a section. Two entry modes:
 *
 * - default (no initialBlob): shows a picker UI (paste / drop / browse).
 *   After the user supplies an image, switches to the annotator.
 *
 * - initialBlob set: skips the picker UI entirely and drops the user directly
 *   into the annotator with that image. Used by the section-card 📸 button
 *   which captures the screen *outside* the modal (so our UI isn't in the shot)
 *   and hands the result here. Combine with cropFirst=true to start in
 *   crop-region mode.
 *
 * Successful upload calls onInsert with a relative media URL like
 * "/api/projects/<id>/media/<uuid>.png".
 */
export function ScreenshotModal({
  projectId, onClose, onInsert, initialBlob, cropFirst,
}: {
  projectId: string
  onClose: () => void
  onInsert: (url: string) => void
  initialBlob?: Blob
  cropFirst?: boolean
}) {
  const api = useApi()
  const [stage, setStage] = useState<Stage>(initialBlob ? 'edit' : 'pick')
  const [imgSrc, setImgSrc] = useState<string | null>(
    initialBlob ? URL.createObjectURL(initialBlob) : null,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Clean up blob URLs on close
  useEffect(() => () => {
    if (imgSrc?.startsWith('blob:')) URL.revokeObjectURL(imgSrc)
  }, [imgSrc])

  // Esc to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Not an image')
      return
    }
    setError(null)
    setImgSrc(URL.createObjectURL(file))
    setStage('edit')
  }, [])

  // Listen for Ctrl/Cmd+V paste while picker is open
  useEffect(() => {
    if (stage !== 'pick') return
    const h = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            loadFile(file)
            e.preventDefault()
            return
          }
        }
      }
    }
    window.addEventListener('paste', h)
    return () => window.removeEventListener('paste', h)
  }, [stage, loadFile])

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) loadFile(file)
  }

  async function upload(blob: Blob) {
    setSaving(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', blob, 'screenshot.png')
      const result = await api<{ filename: string; url: string }>(
        `/api/projects/${projectId}/media`,
        { method: 'POST', body: fd },
      )
      onInsert(result.url)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function pasteFromClipboardApi() {
    setError(null)
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type)
            loadFile(new File([blob], 'pasted.png', { type }))
            return
          }
        }
      }
      setError('No image on the clipboard')
    } catch (e) {
      setError(`Clipboard read failed: ${(e as Error).message}. Try Ctrl+V directly, or browse for a file.`)
    }
  }

  return (
    <div
      data-capture-hide
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
    >
      <div className="flex h-full max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
          <h2 className="text-sm font-medium text-zinc-100">
            {stage === 'pick' ? 'Attach a screenshot' : (cropFirst ? 'Crop region' : 'Annotate')}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="border-b border-red-900/60 bg-red-950/40 px-4 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {stage === 'pick' ? (
          <div
            onDrop={onDrop}
            onDragOver={e => e.preventDefault()}
            className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
          >
            <div className="text-zinc-400">
              <p className="text-sm">Paste an image (Ctrl/Cmd + V), drop one here, or:</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={pasteFromClipboardApi}
                className="rounded border border-zinc-700 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                📋 Paste from clipboard
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="rounded border border-zinc-700 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                📁 Browse…
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) loadFile(f)
                }}
              />
            </div>
            <p className="mt-4 text-[11px] text-zinc-600">
              For a screen capture, use the 📸 button on the section header instead — it hides the panel so it doesn't appear in the shot.
            </p>
          </div>
        ) : imgSrc ? (
          <Annotator
            src={imgSrc}
            cropFirst={cropFirst}
            saving={saving}
            onCancel={() => {
              if (initialBlob) onClose()
              else { setStage('pick'); setImgSrc(null) }
            }}
            onSave={upload}
          />
        ) : null}
      </div>
    </div>
  )
}
