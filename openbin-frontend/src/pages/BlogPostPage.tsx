import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { useApi } from '@shared/api/client'
import { Gravatar } from '@shared/components/Gravatar'
import { Markdown } from '../components/Markdown'
import { CommentsThread } from '@shared/components/CommentsThread'
import { FollowButton } from '@shared/components/FollowButton'
import {
  blogPostPath,
  socialLinksOf,
  upvotePostPath,
  type BlogPostDetail,
} from '@shared/api/blog'

/** A single post: body, author byline with their links, upvote, discussion. */
export function BlogPostPage() {
  const { slug = '' } = useParams()
  const api = useApi()
  const auth = useAuth()
  const [post, setPost] = useState<BlogPostDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [voting, setVoting] = useState(false)

  useEffect(() => {
    setPost(null)
    setError(null)
    void (async () => {
      try {
        setPost(await api<BlogPostDetail>(blogPostPath(slug)))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Post not found')
      }
    })()
  }, [api, slug])

  const toggleUpvote = useCallback(async () => {
    if (!auth.isAuthenticated) { void auth.signinRedirect(); return }
    if (!post) return
    setVoting(true)
    try {
      const r = await api<{ upvotes: number }>(upvotePostPath(post.id), { method: 'POST' })
      setPost({ ...post, upvotes: r.upvotes, upvotedByMe: !post.upvotedByMe })
    } catch {
      // Leave the count as-is; a failed toggle shouldn't lie about state.
    } finally {
      setVoting(false)
    }
  }, [api, auth, post])

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-sm text-zinc-400">{error}</p>
        <Link to="/blog" className="mt-3 inline-block text-sm text-purple-400 hover:underline">
          ← All posts
        </Link>
      </div>
    )
  }
  if (!post) return <p className="mx-auto max-w-3xl px-4 py-8 text-sm text-zinc-500">Loading…</p>

  // The detail payload prefixes the author's links; socialLinksOf takes the
  // profile shape, so map rather than duplicating the link-building rules.
  const links = socialLinksOf({
    websiteUrl: post.authorWebsiteUrl,
    githubUser: post.authorGithubUser,
    xUser: post.authorXUser,
    mastodonUrl: post.authorMastodonUrl,
    linkedinUrl: post.authorLinkedinUrl,
  })

  return (
    <article className="mx-auto max-w-3xl px-4 py-8">
      <Link to="/blog" className="text-xs text-zinc-500 hover:text-zinc-300">← All posts</Link>

      {post.draft && (
        <p className="mt-3 rounded border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
          This is a draft — only you can see it.
        </p>
      )}

      <h1 className="mt-3 text-2xl font-semibold text-zinc-100">{post.title}</h1>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-zinc-500">
        <Link to={`/u/${post.authorId}`} className="flex items-center gap-2 hover:text-zinc-300">
          <Gravatar emailMd5={post.authorEmailMd5} size={24} />
          <span className="text-sm text-zinc-300">{post.authorDisplayName}</span>
        </Link>
        <FollowButton userId={post.authorId} initialFollowing={false} />
        {post.publishedAt && <span>{new Date(post.publishedAt).toLocaleDateString()}</span>}
        <span>{post.readingMinutes} min read</span>
        {post.mine && (
          <Link to={`/blog/${post.id}/edit`} className="text-purple-400 hover:underline">edit</Link>
        )}
      </div>

      {post.authorBio && <p className="mt-2 text-xs text-zinc-500">{post.authorBio}</p>}
      {links.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              // noopener: the post author controls this URL.
              rel="noopener noreferrer nofollow"
              className="text-purple-400 hover:underline"
            >
              {l.text}
            </a>
          ))}
        </div>
      )}

      <div className="prose prose-invert prose-sm mt-6 max-w-none prose-zinc prose-headings:text-zinc-200 prose-a:text-purple-400 prose-img:max-w-full prose-img:h-auto">
        <Markdown>{post.bodyMd}</Markdown>
      </div>

      <div className="mt-8 flex items-center gap-3 border-t border-zinc-800 pt-4">
        <button
          type="button"
          onClick={() => void toggleUpvote()}
          disabled={voting}
          className={`rounded border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
            post.upvotedByMe
              ? 'border-purple-600 bg-purple-950/40 text-purple-200'
              : 'border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
          }`}
        >
          ▲ {post.upvotes}
        </button>
        <span className="text-xs text-zinc-600">
          {post.upvotedByMe ? 'You upvoted this' : 'Found this useful?'}
        </span>
      </div>

      {!post.draft && <CommentsThread postId={post.id} postSlug={post.slug} accent="purple" />}
    </article>
  )
}
