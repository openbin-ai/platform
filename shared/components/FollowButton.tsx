import { useCallback, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { useApi } from '@shared/api/client'
import { followPath, type ToggleResponse } from '@shared/api/social'

// Follow/unfollow toggle. Hidden entirely when the viewer is the same
// user as the target (self-follow is rejected at the DB layer; rendering
// the button just to disable it adds noise to the profile header).
//
// State is optimistic with rollback on error, same as UpvoteButton.
type Props = {
  userId: string
  // Pass null when the viewer is the same as userId — the parent does
  // the comparison since the auth `sub` claim isn't the same shape as
  // the backend user UUID. The wrapper decides what to render in that
  // case (typically just the follower count, no button).
  initialFollowing: boolean
  accentClass?: string
  onChange?: (active: boolean, count: number) => void
}

export function FollowButton({ userId, initialFollowing, accentClass, onChange }: Props) {
  const auth = useAuth()
  const api = useApi()
  const [following, setFollowing] = useState(initialFollowing)
  const [busy, setBusy] = useState(false)

  const active = accentClass ?? 'border-purple-600 bg-purple-950/40 text-purple-200 hover:bg-purple-900/50'
  const idle  = 'border-amber-500 bg-amber-500 text-black hover:bg-amber-400'

  const toggle = useCallback(async () => {
    if (!auth.isAuthenticated) {
      void auth.signinRedirect()
      return
    }
    if (busy) return
    setBusy(true)
    const prev = following
    setFollowing(!prev)
    try {
      const resp = await api<ToggleResponse>(followPath(userId), {
        method: prev ? 'DELETE' : 'POST',
      })
      setFollowing(resp.active)
      onChange?.(resp.active, resp.count)
    } catch {
      setFollowing(prev)
    } finally {
      setBusy(false)
    }
  }, [api, auth, busy, following, onChange, userId])

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-3 py-1 text-xs font-medium transition disabled:opacity-60 ${following ? active : idle}`}
    >
      {following ? 'Following' : '+ Follow'}
    </button>
  )
}
