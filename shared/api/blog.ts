// Blog posts: standalone writing, not tied to a project.
//
// Reads are anonymous (/api/community/blog/**, permitAll) so a shared link
// works logged-out; authoring is authenticated (/api/blog/**).

export type BlogPostSummary = {
  id: string
  slug: string
  title: string
  summary: string
  authorId: string
  authorDisplayName: string
  authorEmailMd5: string
  publishedAt: string | null
  updatedAt: string
  upvotes: number
  commentCount: number
  upvotedByMe: boolean
  mine: boolean
  draft: boolean
  readingMinutes: number
}

export type BlogPostDetail = {
  id: string
  slug: string
  title: string
  summary: string | null
  bodyMd: string
  authorId: string
  authorDisplayName: string
  authorEmailMd5: string
  authorBio: string | null
  authorWebsiteUrl: string | null
  authorGithubUser: string | null
  authorXUser: string | null
  authorMastodonUrl: string | null
  authorLinkedinUrl: string | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  upvotes: number
  upvotedByMe: boolean
  mine: boolean
  draft: boolean
  readingMinutes: number
}

export const blogFeedPath = () => `/api/community/blog`
export const blogPostPath = (slug: string) => `/api/community/blog/${encodeURIComponent(slug)}`
export const blogByAuthorPath = (authorId: string) => `/api/community/blog/authors/${authorId}`

export const myPostsPath = () => `/api/blog`
export const createPostPath = () => `/api/blog`
export const updatePostPath = (id: string) => `/api/blog/${id}`
export const publishPostPath = (id: string, publish: boolean) =>
  `/api/blog/${id}/publish?publish=${publish}`
export const deletePostPath = (id: string) => `/api/blog/${id}`
export const upvotePostPath = (id: string) => `/api/blog/${id}/upvote`

/**
 * Links a profile exposes. Handles are stored bare and turned into URLs
 * here, which is why the backend refuses anything that looks like a URL in
 * those fields — the href is built, never taken from user input.
 */
export type SocialLinks = {
  websiteUrl?: string | null
  githubUser?: string | null
  xUser?: string | null
  mastodonUrl?: string | null
  linkedinUrl?: string | null
}

export function socialLinksOf(p: SocialLinks): { label: string; href: string; text: string }[] {
  const out: { label: string; href: string; text: string }[] = []
  if (p.githubUser) out.push({ label: 'GitHub', href: `https://github.com/${p.githubUser}`, text: `@${p.githubUser}` })
  if (p.xUser) out.push({ label: 'X', href: `https://x.com/${p.xUser}`, text: `@${p.xUser}` })
  if (p.mastodonUrl && isHttp(p.mastodonUrl)) out.push({ label: 'Mastodon', href: p.mastodonUrl, text: hostOf(p.mastodonUrl) })
  if (p.linkedinUrl && isHttp(p.linkedinUrl)) out.push({ label: 'LinkedIn', href: p.linkedinUrl, text: 'LinkedIn' })
  if (p.websiteUrl && isHttp(p.websiteUrl)) out.push({ label: 'Website', href: p.websiteUrl, text: hostOf(p.websiteUrl) })
  return out
}

/**
 * Second line of defence. The API rejects non-http(s) URLs on write, but rows
 * predating that check — or any future write path that forgets — must not be
 * able to render a `javascript:` href.
 */
function isHttp(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
