import type { BlogPostSummary } from '@shared/api/blog'
// Types + helpers for the /api/social and /api/community/users endpoints.
// The split: /api/social/** is auth-required (mutations + personal feed);
// /api/community/users/{id}/profile/{kind} is anonymous-readable so a
// shared profile link works for signed-out visitors.

import type { CommunityReportSummary } from './community'

export type ToggleResponse = {
  active: boolean // true after a follow/upvote; false after the inverse
  count: number   // new aggregate (follower count or vote count)
}

export type ProfileResponse = {
  userId: string
  displayName: string
  emailMd5: string
  joinedAt: string // ISO instant
  followerCount: number
  followingCount: number
  amFollowing: boolean // always false for anonymous viewers
  // Public identity. Handles are BARE — the link is built client-side, so a
  // stored value can never carry its own scheme. Optional so an older
  // backend response still parses.
  bio?: string | null
  websiteUrl?: string | null
  githubUser?: string | null
  xUser?: string | null
  mastodonUrl?: string | null
  linkedinUrl?: string | null
  isMe?: boolean
  reports: CommunityReportSummary[] // where this user is the LEAD (owner)
  // Reports where this user is a credited CONTRIBUTOR but not the lead.
  // Empty for legacy reports; optional so an older backend response parses.
  collaborativeReports?: CommunityReportSummary[]
  // Published blog posts by this author, newest first.
  posts?: BlogPostSummary[]
}

export type ProjectKindParam = 'apk' | 'bin'

export const followPath = (userId: string) => `/api/social/follows/${userId}`
export const votePath = (reportId: string) => `/api/social/votes/${reportId}`
export const personalFeedPath = (kind: ProjectKindParam, page = 0, size = 20) =>
  `/api/social/feed/${kind}?page=${page}&size=${size}`
export const profilePath = (userId: string, kind: ProjectKindParam) =>
  `/api/community/users/${userId}/profile/${kind}`

// One row in a follower / following list. Not kind-scoped — follow is a
// user-level relationship that exists across both products.
export type SocialUserSummary = {
  userId: string
  displayName: string
  emailMd5: string
  followedAt: string // ISO instant; when the follow row was created
  amFollowing: boolean // viewer follows this row's user? false when anon
}

export const followersPath = (userId: string, page = 0, size = 40) =>
  `/api/community/users/${userId}/followers?page=${page}&size=${size}`
export const followingPath = (userId: string, page = 0, size = 40) =>
  `/api/community/users/${userId}/following?page=${page}&size=${size}`

/**
 * Researcher search over display name + the username half of the email.
 * Anonymous-readable, and covers ALL registered users — the old
 * publishers-only restriction was removed because it made colleagues who
 * hadn't published yet impossible to find (and so impossible to follow or
 * invite). Publishers still rank first. The backend enforces a
 * 2-character minimum on `q`; below that the call returns [].
 */
export const userSearchPath = (q: string, page = 0, size = 20) =>
  `/api/community/users/search?q=${encodeURIComponent(q)}&page=${page}&size=${size}`
