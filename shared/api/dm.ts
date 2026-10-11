// Direct messages — wire types + paths for /api/dm. User-level, not
// product-level: a conversation started on openbin continues on openapk.

export type DmUser = {
  userId: string | null // null when the other party deleted their account
  displayName: string
  emailMd5: string
}

export type DmConversationSummary = {
  id: string
  // 1:1 DM: the other party. Project team chat: null (see projectId).
  other: DmUser | null
  // Project team chat (one per project, shared by the roster); null for a DM.
  projectId: string | null
  projectName: string | null
  memberCount: number
  lastMessageAt: string | null // ISO instant; null until the first message
  lastMessagePreview: string | null
  lastMessageMine: boolean
  unread: number // my unread message count in this conversation
}

export type DmMessage = {
  id: string
  senderId: string
  // Name + avatar hash of the sender, for labelling bubbles in a group thread.
  sender: DmUser
  body: string
  createdAt: string // ISO instant
  mine: boolean
}

// Who may open a DM with me. Checked when a thread is opened AND on every
// send, so tightening it makes existing threads read-only for the other side.
export type DmPolicy = 'EVERYONE' | 'FOLLOWING' | 'NOBODY'
export type DmSettings = { policy: DmPolicy }
export const dmSettingsPath = () => `/api/dm/settings`

export const dmInboxPath = () => `/api/dm/conversations`
export const dmUnreadPath = () => `/api/dm/unread-count`
export const dmOpenWithPath = (userId: string) => `/api/dm/conversations/with/${userId}`
// Get-or-create a project's team chat (any roster member).
export const dmProjectChatPath = (projectId: string) => `/api/dm/conversations/for-project/${projectId}`
export const dmConversationPath = (id: string) => `/api/dm/conversations/${id}`
export const dmMessagesPath = (id: string, opts: { before?: string; after?: string; size?: number } = {}) => {
  const q = new URLSearchParams()
  if (opts.before) q.set('before', opts.before)
  if (opts.after) q.set('after', opts.after)
  if (opts.size) q.set('size', String(opts.size))
  const s = q.toString()
  return `/api/dm/conversations/${id}/messages${s ? '?' + s : ''}`
}
export const dmSendPath = (id: string) => `/api/dm/conversations/${id}/messages`
export const dmMarkReadPath = (id: string) => `/api/dm/conversations/${id}/read`

// The messages page fires this on the window after it changes read state or
// sends, so the nav badge refreshes without waiting for its next poll.
export const DM_CHANGED_EVENT = 'openbin:dm:changed'
