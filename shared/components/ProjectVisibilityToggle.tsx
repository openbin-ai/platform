import { useEffect, useRef, useState } from 'react'
import { useApi } from '@shared/api/client'

// Owner-only control for a project's anonymous public-read visibility
// (projects.public_read_at). Toggles via PUT/DELETE /api/projects/{id}/public
// and, when public, offers the shareable read-only link
// (/public/projects/{id} on this origin). Rendered in the ProjectView header
// next to Share; the parent gates it to the owner.

export function ProjectVisibilityToggle({
  projectId,
  initialPublicReadAt,
  accent = 'purple',
}: {
  projectId: string
  initialPublicReadAt: string | null
  accent?: 'purple' | 'amber'
}) {
  const api = useApi()
  const [publicAt, setPublicAt] = useState<string | null>(initialPublicReadAt)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const isPublic = !!publicAt
  const link = typeof window !== 'undefined'
    ? `${window.location.origin}/public/projects/${projectId}`
    : `/public/projects/${projectId}`

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open])

  async function toggle() {
    setBusy(true)
    try {
      const r = await api<{ publicReadAt: string | null }>(
        `/api/projects/${projectId}/public`,
        { method: isPublic ? 'DELETE' : 'PUT' },
      )
      setPublicAt(r.publicReadAt)
    } catch {
      /* leave state as-is on failure */
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — user can select the text manually */
    }
  }

  const onAccent = accent === 'amber'
    ? 'border-amber-600/60 bg-amber-950/40 text-amber-200'
    : 'border-emerald-600/60 bg-emerald-950/40 text-emerald-200'

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={isPublic ? 'This project is publicly readable' : 'This project is private'}
        className={`rounded border px-2 py-1 text-[11px] ${
          isPublic ? onAccent : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'
        }`}
      >
        {isPublic ? '🌐 Public' : '🔒 Private'}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-lg border border-zinc-800 bg-zinc-900 p-3 shadow-xl">
          <div className="text-sm text-zinc-200">
            {isPublic ? 'Publicly readable' : 'Private'}
          </div>
          <p className="mt-1 text-[11px] text-zinc-500">
            {isPublic
              ? 'Anyone with the link can view this project’s report, highlights, and analysis — read-only. No sign-in required.'
              : 'Only you and your collaborators can see this project.'}
          </p>

          {isPublic && (
            <div className="mt-2 flex items-center gap-1">
              <input
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 truncate rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300"
              />
              <button
                onClick={() => void copy()}
                className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}

          <button
            onClick={() => void toggle()}
            disabled={busy}
            className={`mt-3 w-full rounded border px-2 py-1.5 text-xs disabled:opacity-50 ${
              isPublic
                ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                : (accent === 'amber'
                    ? 'border-amber-600 bg-amber-950/40 text-amber-200 hover:bg-amber-900/40'
                    : 'border-emerald-600 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/40')
            }`}
          >
            {busy ? '…' : isPublic ? 'Make private' : 'Make public'}
          </button>
        </div>
      )}
    </div>
  )
}
