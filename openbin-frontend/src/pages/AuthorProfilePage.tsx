import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApi } from '@shared/api/client'
import { Gravatar } from '@shared/components/Gravatar'
import { FollowButton } from '@shared/components/FollowButton'
import { UpvoteButton } from '@shared/components/UpvoteButton'
import { socialLinksOf } from '@shared/api/blog'
import { profilePath, type ProfileResponse } from '@shared/api/social'

const UPVOTE_ACCENT = 'border-amber-600 bg-amber-950/40 text-amber-200 hover:bg-amber-900/50'

// Public researcher profile on openbin-frontend — BIN reports only.
// Anonymous-readable; mirrors the APK version in shape and behavior.
export function AuthorProfilePage() {
  const { id } = useParams<{ id: string }>()
  const api = useApi()
  const [profile, setProfile] = useState<ProfileResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [followerCount, setFollowerCount] = useState<number | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setError(null)
    api<ProfileResponse>(profilePath(id, 'bin'))
      .then((p) => {
        if (cancelled) return
        setProfile(p)
        setFollowerCount(p.followerCount)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load profile')
      })
    return () => { cancelled = true }
  }, [api, id])

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-200">
      {error ? (
        <main className="mx-auto max-w-3xl px-6 py-12">
          <h1 className="text-xl font-semibold text-zinc-100">Profile unavailable</h1>
          <p className="mt-2 text-sm text-zinc-400">
            This researcher doesn't exist or has no public reports.
          </p>
          <Link to="/community" className="mt-4 inline-block text-sm text-zinc-400 hover:underline">
            ← Back to community
          </Link>
        </main>
      ) : !profile ? (
        <main className="mx-auto max-w-3xl px-6 py-12 text-sm text-zinc-500">Loading…</main>
      ) : (
        <main className="mx-auto w-full max-w-4xl px-6 py-8">
          <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
            <div className="flex flex-wrap items-start gap-4">
              <Gravatar emailMd5={profile.emailMd5} size={64} />
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-semibold text-zinc-100 sm:text-2xl">{profile.displayName}</h1>
                {profile.bio && <p className="mt-1 text-sm text-zinc-300">{profile.bio}</p>}
                <p className="mt-1 text-xs text-zinc-500">
                  Joined {new Date(profile.joinedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                </p>
                {socialLinksOf(profile).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {socialLinksOf(profile).map((l) => (
                      <a
                        key={l.label}
                        href={l.href}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="text-amber-400 hover:underline"
                      >
                        {l.text}
                      </a>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex gap-4 text-sm">
                  <Link to={`/u/${profile.userId}/followers`} className="text-zinc-300 hover:text-zinc-100">
                    <span className="font-mono text-base text-zinc-100">{followerCount ?? profile.followerCount}</span>{' '}
                    <span className="text-zinc-500">followers</span>
                  </Link>
                  <Link to={`/u/${profile.userId}/following`} className="text-zinc-300 hover:text-zinc-100">
                    <span className="font-mono text-base text-zinc-100">{profile.followingCount}</span>{' '}
                    <span className="text-zinc-500">following</span>
                  </Link>
                </div>
              </div>
              <FollowButton
                userId={profile.userId}
                initialFollowing={profile.amFollowing}
                accentClass={UPVOTE_ACCENT}
                onChange={(_, count) => setFollowerCount(count)}
              />
            </div>
          </section>

          {profile.posts && profile.posts.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-400">
                Blog posts
              </h2>
              <ul className="space-y-2">
                {profile.posts.map((p) => (
                  <li key={p.id} className="rounded border border-zinc-800 bg-zinc-900/40 p-3">
                    <Link to={`/blog/${p.slug}`} className="text-sm text-zinc-100 hover:text-amber-300">
                      {p.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-zinc-500">
                      {p.publishedAt && <span>{new Date(p.publishedAt).toLocaleDateString()}</span>}
                      <span>{p.readingMinutes} min read</span>
                      <span>▲ {p.upvotes}</span>
                      <span>💬 {p.commentCount}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-400">
            Published reports
          </h2>
          {profile.reports.length === 0 ? (
            <p className="rounded border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-sm text-zinc-500">
              No public reports yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {profile.reports.map((r) => (
                <li key={r.reportId}>
                  <article className="flex items-start justify-between gap-3 rounded border border-zinc-800 bg-zinc-900/40 p-4 transition hover:border-zinc-700 hover:bg-zinc-900/60">
                    <Link to={`/community/reports/${r.reportId}`} className="min-w-0 flex-1">
                      <h3 className="truncate text-base font-medium text-zinc-100">{r.title}</h3>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {new Date(r.communityPublishedAt).toLocaleDateString()} · <span className="font-mono">{r.projectName}</span>
                      </div>
                      {r.preview && (
                        <p className="mt-2 line-clamp-2 text-sm text-zinc-400">{r.preview}</p>
                      )}
                    </Link>
                    <UpvoteButton
                      reportId={r.reportId}
                      initialCount={r.voteCount}
                      initialVoted={r.votedByMe}
                      accentClass={UPVOTE_ACCENT}
                    />
                  </article>
                </li>
              ))}
            </ul>
          )}

          {profile.collaborativeReports && profile.collaborativeReports.length > 0 && (
            <>
              <h2 className="mb-3 mt-8 text-sm font-medium uppercase tracking-wide text-zinc-400">
                Collaborative reports
              </h2>
              <p className="mb-3 -mt-1 text-xs text-zinc-500">
                Reports this researcher contributed to — led by someone else.
              </p>
              <ul className="space-y-3">
                {profile.collaborativeReports.map((r) => (
                  <li key={r.reportId}>
                    <article className="flex items-start justify-between gap-3 rounded border border-zinc-800 bg-zinc-900/40 p-4 transition hover:border-zinc-700 hover:bg-zinc-900/60">
                      <Link to={`/community/reports/${r.reportId}`} className="min-w-0 flex-1">
                        <h3 className="truncate text-base font-medium text-zinc-100">{r.title}</h3>
                        <div className="mt-0.5 text-xs text-zinc-500">
                          {new Date(r.communityPublishedAt).toLocaleDateString()} · <span className="font-mono">{r.projectName}</span>
                          {' · led by '}<span className="text-zinc-400">{r.authorDisplayName}</span>
                        </div>
                        {r.preview && (
                          <p className="mt-2 line-clamp-2 text-sm text-zinc-400">{r.preview}</p>
                        )}
                      </Link>
                      <UpvoteButton
                        reportId={r.reportId}
                        initialCount={r.voteCount}
                        initialVoted={r.votedByMe}
                        accentClass={UPVOTE_ACCENT}
                      />
                    </article>
                  </li>
                ))}
              </ul>
            </>
          )}
        </main>
      )}
    </div>
  )
}
