import { useEffect, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { useApi } from './client'

/**
 * Self-profile response — mirrors {@code UserResponse.java}.
 * The {@code userId} field is the backend UUID, used by the chrome to
 * build a "View public profile" link for the signed-in user. {@code email}
 * is intentionally only returned to the user themselves.
 */
export type MeResponse = {
  userId: string
  displayName: string | null
  email: string | null
  emailMd5: string
}

// Module-level cache so the second call doesn't re-fire the request.
// One /api/users/me round-trip per logged-in session is plenty — the
// values that drive UI here (userId, displayName, emailMd5) never change
// inside a session except via the user's own edit on /settings/profile,
// which lives in the same SPA process and can write back via `setMeCache`.
let cache: MeResponse | null = null
let inflight: Promise<MeResponse> | null = null

export function setMeCache(next: MeResponse | null) {
  cache = next
}

/**
 * Lazy-load the current user's backend profile. Returns null while
 * loading or when the user isn't signed in; the consumer renders nothing
 * (or a skeleton) until a value arrives.
 *
 * Reuses an in-flight fetch across components so mounting the Layout
 * + Settings dropdown + a profile-link page in the same nav doesn't fan
 * out into three identical requests.
 */
export function useMe(): MeResponse | null {
  const auth = useAuth()
  const api = useApi()
  const [me, setMe] = useState<MeResponse | null>(cache)

  useEffect(() => {
    if (!auth.isAuthenticated) {
      setMe(null)
      return
    }
    if (cache) {
      setMe(cache)
      return
    }
    let cancelled = false
    const p = inflight ?? api<MeResponse>('/api/users/me').then((r) => {
      cache = r
      inflight = null
      return r
    }).catch((e) => {
      inflight = null
      throw e
    })
    inflight = p
    p.then((r) => { if (!cancelled) setMe(r) }).catch(() => { /* swallow — user will see the empty state */ })
    return () => { cancelled = true }
  }, [auth.isAuthenticated, api])

  return me
}
