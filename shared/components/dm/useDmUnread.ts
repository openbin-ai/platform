import { useEffect, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { useApi } from '@shared/api/client'
import { DM_CHANGED_EVENT, dmUnreadPath } from '@shared/api/dm'

/**
 * Number of conversations with unread messages, for the nav badge. Polls
 * every 30s while signed in (same cadence as the notifications bell), and
 * re-fetches on window focus and whenever the messages page announces a
 * change. Returns 0 while signed out.
 */
export function useDmUnread(): number {
  const auth = useAuth()
  const api = useApi()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (!auth.isAuthenticated) {
      setUnread(0)
      return
    }
    let cancelled = false
    const tick = async () => {
      try {
        const r = await api<{ unread: number }>(dmUnreadPath())
        if (!cancelled) setUnread(r.unread)
      } catch { /* transient — next tick */ }
    }
    void tick()
    const interval = setInterval(tick, 30_000)
    const refetch = () => { void tick() }
    window.addEventListener('focus', refetch)
    window.addEventListener(DM_CHANGED_EVENT, refetch)
    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener('focus', refetch)
      window.removeEventListener(DM_CHANGED_EVENT, refetch)
    }
  }, [api, auth.isAuthenticated])

  return unread
}
