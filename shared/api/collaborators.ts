// Project collaboration types shared by openapk-frontend and openbin-frontend.
// Mirrors ai.openapk.core.projects.{ProjectRole, CollaboratorResponse,
// AddCollaboratorRequest} on the backend; keep field names byte-equal.

export type ProjectRole = 'OWNER' | 'EDITOR' | 'VIEWER'

export type Collaborator = {
  userId: string
  email: string
  displayName: string | null
  role: ProjectRole
  addedAt: string
  addedBy: string
}

/**
 * Invite body. Supply EXACTLY ONE of `userId` or `email` — the backend
 * rejects both-at-once rather than picking a winner.
 *
 * `userId` is what the share modal sends when the owner picks someone from
 * researcher search or their followers/following: those endpoints return
 * user ids and deliberately never expose email addresses, so an id is the
 * only way to invite a person you can see in the UI.
 */
export type AddCollaboratorRequest = {
  userId?: string
  email?: string
  role: 'VIEWER' | 'EDITOR'   // OWNER is rejected by the backend
}

/**
 * One row of the in-project member roster (GET /api/projects/{id}/members).
 * Mirrors ai.openapk.core.projects.dto.ProjectMemberResponse — includes the
 * OWNER (unlike Collaborator) plus last-active presence. `lastActiveAt` is
 * null until the member has sent a presence heartbeat.
 */
export type ProjectMember = {
  userId: string
  email: string
  displayName: string | null
  role: ProjectRole
  addedAt: string
  lastActiveAt: string | null
  isBot: boolean
  isSelf: boolean
}

/** Compact "active 2m ago" style relative time; null → "". */
export function relativeActive(iso: string | null): string {
  if (!iso) return ''
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 45) return 'active now'
  if (secs < 90) return 'active 1m ago'
  if (secs < 3600) return `active ${Math.round(secs / 60)}m ago`
  if (secs < 7200) return 'active 1h ago'
  if (secs < 86400) return `active ${Math.round(secs / 3600)}h ago`
  return `active ${Math.round(secs / 86400)}d ago`
}

/** True when the member was active within the last 2 minutes (online dot). */
export function isOnline(iso: string | null): boolean {
  if (!iso) return false
  return Date.now() - new Date(iso).getTime() < 120_000
}

/**
 * True when the caller can mutate this project (rename suggest, report
 * edit, deobf generate, etc.). Use to gate every write button in the UI.
 * Null role is treated as OWNER for back-compat with pre-collab clients
 * that don't include the role in the response yet.
 */
export function canEdit(role: ProjectRole | null | undefined): boolean {
  return role == null || role === 'OWNER' || role === 'EDITOR'
}

/** True when the caller is the project owner (delete, change roster, publish to community). */
export function isOwner(role: ProjectRole | null | undefined): boolean {
  return role == null || role === 'OWNER'
}
