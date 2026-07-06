import { useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { useApi } from '@shared/api/client'

// Fork a project into a new one owned by the caller (POST /api/projects/{id}/fork),
// then open the fresh fork's authenticated project view. Anonymous visitors are
// sent to sign-in first (the fork is owned, so it needs an account). Navigation
// defaults to a full load of /projects/{newId} (shared code stays router-
// agnostic); pass onForked to hook SPA navigation instead. Used on the public
// project view and the project header.
export function ForkButton({
  projectId,
  accent = 'purple',
  compact = false,
  onForked,
}: {
  projectId: string
  accent?: 'purple' | 'amber'
  compact?: boolean
  onForked?: (newId: string) => void
}) {
  const api = useApi()
  const auth = useAuth()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function fork() {
    if (!auth.isAuthenticated) {
      void auth.signinRedirect()
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const r = await api<{ id: string }>(`/api/projects/${projectId}/fork`, { method: 'POST' })
      if (onForked) onForked(r.id)
      else window.location.assign(`/projects/${r.id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Fork failed')
      setBusy(false)
    }
  }

  const accentCls = accent === 'amber'
    ? 'border-amber-600 bg-amber-950/40 text-amber-200 hover:bg-amber-900/40'
    : 'border-purple-600 bg-purple-950/40 text-purple-200 hover:bg-purple-900/40'

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => void fork()}
        disabled={busy}
        title="Create your own editable copy of this project"
        className={`rounded border px-3 py-1 font-medium disabled:opacity-50 ${accentCls} ${compact ? 'text-[11px]' : 'text-xs'}`}
      >
        {busy ? 'Forking…' : '🍴 Fork'}
      </button>
      {err && (
        <span className="absolute right-0 top-full z-20 mt-1 w-56 rounded border border-red-900/60 bg-red-950/90 px-2 py-1 text-[11px] text-red-300 shadow">
          {err}
        </span>
      )}
    </span>
  )
}
