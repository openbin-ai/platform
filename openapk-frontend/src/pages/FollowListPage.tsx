import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { useApi } from '../api/client'
import { UserListRow } from '@shared/components/UserListRow'
import {
  followersPath,
  followingPath,
  profilePath,
  type ProfileResponse,
  type SocialUserSummary,
} from '@shared/api/social'
import iconUrl from '../assets/icon.png'

// Sub-page of /u/:id — paginated list of either followers or following.
// `mode` is fixed at the route boundary (App.tsx) so the same component
// drives both /u/:id/followers and /u/:id/following without an internal
// toggle state.
//
// Anonymous viewers can read the list; the per-row Follow button bounces
// them through Keycloak the moment they click it.
export function FollowListPage({ mode }: { mode: 'followers' | 'following' }) {
  const { id } = useParams<{ id: string }>()
  const api = useApi()
  const [profile, setProfile] = useState<ProfileResponse | null>(null)
  const [rows, setRows] = useState<SocialUserSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 40

  // Pull the profile header in parallel so the page can show whose list
  // we're looking at without making the user click back to /u/:id first.
  useEffect(() => {
    if (!id) return
    let cancelled = false
    api<ProfileResponse>(profilePath(id, 'apk'))
      .then((p) => { if (!cancelled) setProfile(p) })
      .catch(() => { /* header is decorative; tolerate failure */ })
    return () => { cancelled = true }
  }, [api, id])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setRows(null)
    setError(null)
    const path = mode === 'followers'
      ? followersPath(id, page, PAGE_SIZE)
      : followingPath(id, page, PAGE_SIZE)
    api<SocialUserSummary[]>(path)
      .then((r) => { if (!cancelled) setRows(r) })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load list')
      })
    return () => { cancelled = true }
  }, [api, id, mode, page])

  const title = mode === 'followers' ? 'Followers' : 'Following'

  return (
    <Chrome>
      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <nav className="mb-4 text-xs text-zinc-500">
          <Link to={`/u/${id}`} className="hover:text-zinc-300">
            ← {profile?.displayName ?? 'Profile'}
          </Link>
        </nav>
        <header className="mb-5 flex items-baseline justify-between">
          <h1 className="text-xl font-semibold text-zinc-100">{title}</h1>
          {profile && (
            <div className="flex gap-4 text-xs">
              <Link
                to={`/u/${id}/followers`}
                className={mode === 'followers' ? 'text-purple-300' : 'text-zinc-500 hover:text-zinc-300'}
              >
                <span className="font-mono text-zinc-100">{profile.followerCount}</span> followers
              </Link>
              <Link
                to={`/u/${id}/following`}
                className={mode === 'following' ? 'text-purple-300' : 'text-zinc-500 hover:text-zinc-300'}
              >
                <span className="font-mono text-zinc-100">{profile.followingCount}</span> following
              </Link>
            </div>
          )}
        </header>

        {error && (
          <p className="rounded border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
        {!rows && !error && <p className="text-sm text-zinc-500">Loading…</p>}
        {rows && rows.length === 0 && page === 0 && (
          <p className="rounded border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-sm text-zinc-500">
            {mode === 'followers'
              ? "Nobody's following this user yet."
              : "This user isn't following anyone yet."}
          </p>
        )}
        {rows && rows.length > 0 && (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.userId}>
                <UserListRow row={r} />
              </li>
            ))}
          </ul>
        )}

        {/* Pagination: if we got a full page, there might be more. */}
        {(page > 0 || (rows && rows.length >= PAGE_SIZE)) && (
          <div className="mt-6 flex items-center justify-between border-t border-zinc-800 pt-4 text-xs">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            >
              ← Newer
            </button>
            <span className="text-zinc-500">Page {page + 1}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!rows || rows.length < PAGE_SIZE}
              className="rounded border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            >
              Older →
            </button>
          </div>
        )}
      </main>
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
