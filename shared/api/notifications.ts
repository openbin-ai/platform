// Wire types + paths for the in-app notifications bell. The same email-
// pref toggles that gate transactional emails also gate the in-app row
// creation, so opting out of a category mutes both channels.

export type NotificationKind =
  | 'NEW_FOLLOWER'
  | 'COMMENT_ON_MY_REPORT'
  | 'REPLY_TO_MY_COMMENT'
  | 'COLLABORATOR_INVITE'
  // Forward-compat — backend may emit kinds the frontend doesn't know
  // about. Render those with a generic fallback ("New activity").
  | string

// Payload shape is discriminated by `kind`. Every payload at minimum
// carries the actor's display name + email md5 for avatar/label rendering.
export type NotificationPayload = {
  actorId?: string
  actorDisplayName?: string
  actorEmailMd5?: string
  // Kind-specific extras — present only on the relevant kinds.
  reportId?: string
  reportTitle?: string
  projectId?: string
  projectName?: string
  projectKind?: 'APK' | 'BIN'
  role?: 'VIEWER' | 'EDITOR'
}

export type NotificationResponse = {
  id: string
  kind: NotificationKind
  payload: NotificationPayload
  link: string // route to navigate to on click
  read: boolean
  createdAt: string // ISO instant
}

export const notificationsPath = (size = 20) =>
  `/api/notifications?size=${size}`
export const unreadCountPath = () => `/api/notifications/unread-count`
export const markReadPath = (id: string) => `/api/notifications/${id}/read`
export const markAllReadPath = () => `/api/notifications/read-all`
