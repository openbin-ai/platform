// Types + fetch helpers for the anonymous /api/community/** endpoints.
// Mirrors the backend DTOs in core/.../reports/dto/CommunityReport*.java.
//
// These types live in shared/ so both openapk-frontend (community of APK
// reports) and openbin-frontend (community of BIN reports) can consume
// the same shapes. The endpoints themselves are split per kind: openapk
// hits /api/community/apk/reports, openbin hits /api/community/bin/reports.
// Single-report read + abuse flag are kind-agnostic (just by report id).

export type CommunityReportSummary = {
  reportId: string
  projectId: string
  title: string
  projectName: string
  malwareType: string | null
  tags: string[]
  sha256: string
  communityPublishedAt: string // ISO instant
  authorId: string
  authorDisplayName: string
  authorEmailMd5: string
  preview: string
  voteCount: number
  votedByMe: boolean
  // Frozen byline (LEAD first). Empty for reports published before bylines
  // existed — fall back to the author* fields, which carry the lead.
  contributors: Contributor[]
}

/**
 * One entry in a report's contributor byline. Mirrors
 * ai.openapk.core.reports.dto.Contributor. `credit` is LEAD (the owner who
 * published) or CONTRIBUTOR. `userId` is null when the credited account was
 * deleted (the snapshotted displayName still renders). `isBot` flags synthetic
 * authors like BINNY.
 */
export type Contributor = {
  userId: string | null
  displayName: string
  emailMd5: string
  credit: 'LEAD' | 'CONTRIBUTOR'
  isBot: boolean
}

export type CommunityReportDetail = {
  reportId: string
  projectId: string
  kind: 'APK' | 'BIN' | 'SCRIPT'
  title: string
  sections: { id: string; title: string; content: string }[]
  malwareType: string | null
  tags: string[]
  projectName: string
  originalFilename: string
  sha256: string
  sizeBytes: number | null
  executableFormat: string | null
  arch: string | null
  packageName: string | null
  communityPublishedAt: string
  authorId: string
  authorDisplayName: string
  authorEmailMd5: string
  voteCount: number
  votedByMe: boolean
  amFollowingAuthor: boolean
  // Frozen byline (LEAD first); empty for legacy reports.
  contributors: Contributor[]
  // ISO instant when the project was made public-readable, or null if
  // private. Drives the "View project & fork" link on the report page.
  projectPublicReadAt?: string | null
}

export type CommunityFeedParams = {
  q?: string
  malwareType?: string
  tags?: string[]
  sha256?: string
  // 'trending' = upvotes desc, recency tiebreaker. Default chronological.
  sort?: 'new' | 'trending'
  page?: number
  size?: number
}

// STIX 2.1 malware-type open vocabulary. Kept in sync with
// core/.../reports/MalwareTypes.java — change one, change both.
// Order is the rough "what users pick most" ordering, not alphabetical,
// so the dropdown puts likely choices first.
export const STIX_MALWARE_TYPES: readonly string[] = [
  'trojan',
  'ransomware',
  'spyware',
  'backdoor',
  'remote-access-trojan',
  'keylogger',
  'dropper',
  'downloader',
  'rootkit',
  'bootkit',
  'worm',
  'virus',
  'adware',
  'botnet',
  'bot',
  'wiper',
  'webshell',
  'exploit-kit',
  'screen-capture',
  'rogue-security-software',
  'resource-exploitation',
  'unknown',
] as const

/**
 * Build the query string for a community feed request. Tags become
 * repeated `tag=` params so the backend's `List<String>` binding picks
 * up multiple values cleanly.
 */
export function buildFeedQuery(params: CommunityFeedParams): string {
  const usp = new URLSearchParams()
  if (params.q && params.q.trim()) usp.set('q', params.q.trim())
  if (params.malwareType) usp.set('malware_type', params.malwareType)
  if (params.sha256) usp.set('sha256', params.sha256)
  if (params.tags) for (const t of params.tags) if (t.trim()) usp.append('tag', t.trim())
  if (params.sort && params.sort !== 'new') usp.set('sort', params.sort)
  if (params.page != null) usp.set('page', String(params.page))
  if (params.size != null) usp.set('size', String(params.size))
  const q = usp.toString()
  return q ? `?${q}` : ''
}

// 64-hex SHA-256 detection — drives the "type a hash, jump to exact
// report" UX in the search input.
export const SHA256_RE = /^[0-9a-fA-F]{64}$/
