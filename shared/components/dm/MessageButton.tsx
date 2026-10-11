import { useCallback, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { useApi } from '@shared/api/client'
import { dmOpenWithPath, type DmConversationSummary } from '@shared/api/dm'

/**
 * "Message" button on a researcher's profile. Get-or-creates the 1:1
 * conversation, then hands the conversation id to the host app, which
 * navigates to its /messages/:id route (shared/ can't import the router).
 * Hidden for the viewer's own profile; signed-out viewers get bounced
 * through Keycloak like the Follow button.
 */
type Props = {
  userId: string
  isSelf?: boolean
  // From ProfileResponse.canMessage. Undefined (older backend) = show.
  canMessage?: boolean
  onOpen: (conversationId: string) => void
  className?: string
}

export function MessageButton({ userId, isSelf, canMessage, onOpen, className }: Props) {
  const auth = useAuth()
  const api = useApi()
  const [busy, setBusy] = useState(false)

  const click = useCallback(async () => {
    if (!auth.isAuthenticated) {
      void auth.signinRedirect()
      return
    }
    if (busy) return
    setBusy(true)
    try {
      const c = await api<DmConversationSummary>(dmOpenWithPath(userId), { method: 'POST' })
      onOpen(c.id)
    } catch {
      /* a failed open leaves the user on the profile — nothing to roll back */
    } finally {
      setBusy(false)
    }
  }, [api, auth, busy, onOpen, userId])

  if (isSelf || canMessage === false) return null
  return (
    <button
      type="button"
      onClick={() => void click()}
      disabled={busy}
      className={className ?? 'inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-1 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-60'}
    >
      ✉ Message
    </button>
  )
}
