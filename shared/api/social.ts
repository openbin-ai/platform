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
  reports: CommunityReportSummary[]
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
 * Researcher search. The endpoint is anonymous-readable and only matches
 * users who have at least one community-published report. The backend
 * enforces a 2-character minimum on `q`; below that the call returns [].
 */
export const userSearchPath = (q: string, page = 0, size = 20) =>
  `/api/community/users/search?q=${encodeURIComponent(q)}&page=${page}&size=${size}`
