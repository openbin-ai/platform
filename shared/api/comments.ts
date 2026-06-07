// Wire types + helper paths for comment threads on community reports.
// Reads (anonymous + opportunistically personalized): GET /api/community/...
// Writes (auth required): POST /api/social/comments, DELETE /api/social/comments/{id}.

export type CommentResponse = {
  id: string
  reportId: string
  parentCommentId: string | null
  authorId: string | null
  authorDisplayName: string
  authorEmailMd5: string
  body: string
  createdAt: string // ISO instant
  deleted: boolean
  // True only when the viewer authenticated as this comment's author.
  // Drives the inline delete affordance.
  mine: boolean
  // Always present (possibly empty). Replies only appear on top-level
  // comments — schema is depth-1.
  replies: CommentResponse[]
}

export const commentsPath = (reportId: string) =>
  `/api/community/reports/${reportId}/comments`

export const postCommentPath = () => `/api/social/comments`
export const deleteCommentPath = (commentId: string) => `/api/social/comments/${commentId}`
