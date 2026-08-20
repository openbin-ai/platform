// Wire types + helper paths for comment threads on community reports.
// Reads (anonymous + opportunistically personalized): GET /api/community/...
// Writes (auth required): POST /api/social/comments, DELETE /api/social/comments/{id}.

export type CommentResponse = {
  id: string
  // Exactly one of reportId / postId is set — a comment belongs to a
  // community report or a blog post, never both.
  reportId: string | null
  postId: string | null
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
  // Always present (possibly empty). Threads nest to arbitrary depth; these
  // are this comment's direct children.
  replies: CommentResponse[]
}

// Root-comment ordering. Replies within a thread are always chronological.
export type CommentSort = 'hot' | 'new' | 'top'

export const commentsPath = (reportId: string, sort: CommentSort = 'hot') =>
  `/api/community/reports/${reportId}/comments?sort=${sort}`

/** Blog-post thread. Keyed by slug because that's what the URL carries. */
export const blogCommentsPath = (slug: string, sort: CommentSort = 'hot') =>
  `/api/community/blog/${encodeURIComponent(slug)}/comments?sort=${sort}`

export const postCommentPath = () => `/api/social/comments`
export const deleteCommentPath = (commentId: string) => `/api/social/comments/${commentId}`
