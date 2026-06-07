import { useAuth } from 'react-oidc-context'
import { Gravatar } from '@shared/components/Gravatar'
import { FollowButton } from '@shared/components/FollowButton'
import type { SocialUserSummary } from '@shared/api/social'

/**
 * One row in a followers / following list. Plain {@code <a>} for the
 * row click instead of a router Link because this component lives in
 * shared/ which can't depend on react-router-dom. A full page reload
 * on profile-click is an acceptable UX cost.
 *
 * The Follow button is rendered inline so users can follow back without
 * navigating away. The button is suppressed when the row is the viewer's
 * own user — backend rejects self-follow anyway, but hiding it removes
 * the temptation.
 */
type Props = {
  row: SocialUserSummary
  // Set to the viewer's own backend user UUID (from /api/users/me) so the
  // self-row hides its Follow button. Optional — when omitted, the button
  // shows for every row and a backend 400 will trigger the rollback.
  viewerUserId?: string | null
  accentClass?: string
  // Caller wants to know when a row toggles so it can update an aggregate
  // count somewhere (e.g. the profile header). The callback receives the
  // row's userId and the new {@code amFollowing} state.
  onFollowChange?: (userId: string, active: boolean) => void
}

export function UserListRow({ row, viewerUserId, accentClass, onFollowChange }: Props) {
  const auth = useAuth()
  const isSelf = !!viewerUserId && viewerUserId === row.userId

  return (
    <article className="flex items-center gap-3 rounded border border-zinc-800 bg-zinc-900/40 px-4 py-3 transition hover:border-zinc-700">
      <a href={`/u/${row.userId}`} className="shrink-0">
        <Gravatar emailMd5={row.emailMd5} size={40} />
      </a>
      <div className="min-w-0 flex-1">
        <a href={`/u/${row.userId}`} className="block truncate text-sm font-medium text-zinc-100 hover:underline">
          {row.displayName}
        </a>
        <div className="text-[11px] text-zinc-500">
          Followed {formatRelative(row.followedAt)}
        </div>
      </div>
      {!isSelf && auth.isAuthenticated && (
        <FollowButton
          userId={row.userId}
          initialFollowing={row.amFollowing}
          accentClass={accentClass}
          onChange={(active) => onFollowChange?.(row.userId, active)}
        />
      )}
    </article>
  )
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Math.max(0, Date.now() - then)
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
