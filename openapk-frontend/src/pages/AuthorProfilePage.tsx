import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { useApi } from '../api/client'
import { Gravatar } from '@shared/components/Gravatar'
import { FollowButton } from '@shared/components/FollowButton'
import { UpvoteButton } from '@shared/components/UpvoteButton'
import { profilePath, type ProfileResponse } from '@shared/api/social'
import iconUrl from '../assets/icon.png'

// Public researcher profile on openapk-frontend — APK reports only.
// Anonymous-readable; the follow button hides itself for signed-out
// viewers because clicking it would bounce them through Keycloak with
// no return context. The /api/community/users/.../profile endpoint is
// permitted in SecurityConfig so anonymous fetch works.
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
    api<ProfileResponse>(profilePath(id, 'apk'))
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
    <Chrome>
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
                <p className="mt-1 text-xs text-zinc-500">
                  Joined {new Date(profile.joinedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                </p>
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
                onChange={(_, count) => setFollowerCount(count)}
              />
            </div>
          </section>

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
                    />
                  </article>
                </li>
              ))}
            </ul>
          )}
        </main>
      )}
    </Chrome>
  )
}

function Chrome({ children }: { children: React.ReactNode }) {
  const auth = useAuth()
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-200">
      <header className="border-b border-zinc-800 bg-zinc-950">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link to="/" className="flex items-center gap-2 text-zinc-100 hover:opacity-80">
            <img src={iconUrl} alt="OpenAPK" className="h-7 w-7" />
            <span className="text-sm font-semibold tracking-wide">
              OPENAPK<span className="text-red-500">.AI</span>
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/community" className="text-purple-300">Community</Link>
            {auth.isAuthenticated ? (
              <Link to="/dashboard" className="text-zinc-300 hover:text-zinc-100">My projects →</Link>
            ) : (
              <button
                onClick={() => void auth.signinRedirect()}
                className="rounded border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-zinc-800"
              >
                Sign in
              </button>
            )}
          </nav>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-zinc-900 px-6 py-4 text-center text-[11px] text-zinc-600">
        <Link to="/terms" className="hover:underline">Terms</Link>
      </footer>
    </div>
  )
}
