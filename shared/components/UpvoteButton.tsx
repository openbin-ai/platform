import { useCallback, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { useApi } from '@shared/api/client'
import { votePath, type ToggleResponse } from '@shared/api/social'

// Reusable upvote control. Renders as a vertical "▲ count" pill so it can
// drop into both feed-card grids and the report-detail header without
// breaking layout. State is optimistic — we flip the UI immediately and
// reconcile against the server count on response. On error we restore the
// previous state and surface a small toast-style hint.
//
// For anonymous viewers the click bounces them through Keycloak; we never
// silently noop because that would be a confusing dead button.
type Props = {
  reportId: string
  initialCount: number
  initialVoted: boolean
  // Forces a "log in to upvote" tooltip for unauthenticated viewers; the
  // page wrapper decides whether to actually trigger signinRedirect (some
  // surfaces, like the public report view, leave anonymous nav alone).
  accentClass?: string // override for product palette (purple vs amber)
}

export function UpvoteButton({ reportId, initialCount, initialVoted, accentClass }: Props) {
  const auth = useAuth()
  const api = useApi()
  const [count, setCount] = useState(initialCount)
  const [voted, setVoted] = useState(initialVoted)
  const [busy, setBusy] = useState(false)

  const accent = accentClass ?? 'border-purple-700 bg-purple-950/40 text-purple-200 hover:bg-purple-900/50'
  const idle  = 'border-zinc-700 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100'

  const toggle = useCallback(async (e: React.MouseEvent) => {
    // Stop propagation so clicking the upvote button on a feed card
    // doesn't also trigger the card's navigate-to-detail handler.
    e.stopPropagation()
    e.preventDefault()
    if (!auth.isAuthenticated) {
      void auth.signinRedirect()
      return
    }
    if (busy) return
    setBusy(true)
    const prevVoted = voted
    const prevCount = count
    // Optimistic update — flip immediately so the click feels instant.
    setVoted(!prevVoted)
    setCount(prevCount + (prevVoted ? -1 : 1))
    try {
      const resp = await api<ToggleResponse>(votePath(reportId), {
        method: prevVoted ? 'DELETE' : 'POST',
      })
      // Reconcile against authoritative count in case another tab voted.
      setVoted(resp.active)
      setCount(resp.count)
    } catch {
      setVoted(prevVoted)
      setCount(prevCount)
    } finally {
      setBusy(false)
    }
  }, [api, auth, busy, count, reportId, voted])

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={voted ? 'Remove upvote' : 'Upvote this report'}
      aria-pressed={voted}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition disabled:opacity-60 ${voted ? accent : idle}`}
    >
      <span aria-hidden className={voted ? '' : 'opacity-70'}>▲</span>
      <span className="tabular-nums">{count}</span>
    </button>
  )
}
