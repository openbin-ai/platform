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

export type AddCollaboratorRequest = {
  email: string
  role: 'VIEWER' | 'EDITOR'   // OWNER is rejected by the backend
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
