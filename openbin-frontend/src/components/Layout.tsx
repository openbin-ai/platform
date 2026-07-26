import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { NotificationsBell } from '@shared/components/NotificationsBell'
import iconUrl from '../assets/icon.png'

// Top-bar chrome shared across every page that isn't the immersive
// ProjectView (which intentionally fills the viewport like an IDE).
// Brand accent matches openbin-landing — amber for the .AI wordmark.
// Sign-out goes through Keycloak's end-session endpoint (configured in
// shared/auth/oidcConfig.ts via post_logout_redirect_uri).
//
// This SAME chrome wraps both the authed app routes and the anonymous
// public pages (community, docs, profiles, terms) — the navbar must never
// change shape between tabs. Auth-only affordances (Dashboard/Projects,
// Settings, bell, sign-out) collapse to a Sign in button for visitors.
export function Layout() {
  const auth = useAuth()
  const name =
    (auth.user?.profile?.name as string | undefined) ??
    (auth.user?.profile?.email as string | undefined) ??
    'signed in'

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-800 bg-zinc-950">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link
            to="/"
            title="OpenBin"
            className="flex items-center gap-2 text-zinc-100 transition hover:opacity-80"
          >
            <img src={iconUrl} alt="OpenBin" className="h-7 w-7" />
            <span className="text-sm font-semibold tracking-wide">
              OPENBIN<span className="text-amber-400">.AI</span>
            </span>
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            {auth.isAuthenticated && (
              <>
                <NavItem to="/">Dashboard</NavItem>
                <NavItem to="/projects">Projects</NavItem>
              </>
            )}
            <NavItem to="/docs">Docs</NavItem>
            {/* Community is the platform's headline value prop — give it
                a distinct button treatment so users find it without scanning
                the nav. Filled amber accent matches the openbin brand. */}
            <NavLink
              to="/community"
              end
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium shadow-sm transition ${
                  isActive
                    ? 'bg-amber-500 text-black'
                    : 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 hover:text-amber-200'
                }`
              }
            >
              <span aria-hidden>★</span>
              Community
            </NavLink>
            {auth.isAuthenticated ? (
              <>
                <SettingsNavItem />
                <NotificationsBell accent="amber" />
                <div className="flex items-center gap-3 border-l border-zinc-800 pl-6">
                  <span className="text-zinc-400">{name}</span>
                  <button
                    className="rounded border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-zinc-800"
                    onClick={() => void auth.signoutRedirect()}
                  >
                    Sign out
                  </button>
                </div>
              </>
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
      <CliUpdateBanner />
      <DiscordBanner />
      <main className="flex-1 overflow-auto">
        {/* No max-width here — pages opt in via their own container. */}
        <Outlet />
      </main>
      <footer className="border-t border-zinc-900 bg-zinc-950 px-6 py-3 text-center text-[11px] text-zinc-600">
        <Link to="/terms" className="hover:underline">Terms</Link>
        <span className="mx-2">·</span>
        <Link to="/privacy" className="hover:underline">Privacy</Link>
        <span className="mx-2">·</span>
        <a href="https://discord.gg/HQsCZBHXwc" target="_blank" rel="noopener noreferrer" className="hover:underline">Discord</a>
      </footer>
    </div>
  )
}

/** Settings is a plain nav link to the tabbed /settings page; highlighted
 *  while any settings tab is open. */
function SettingsNavItem() {
  const location = useLocation()
  const active = location.pathname.startsWith('/settings')
  return (
    <NavLink
      to="/settings/profile"
      className={`text-sm ${active ? 'text-amber-400' : 'text-zinc-300 hover:text-zinc-100'}`}
    >
      Settings
    </NavLink>
  )
}

// Site-wide announcement nudging CLI users to update. We can't detect a
// visitor's installed CLI version from the browser, so this is a broadcast
// notice (not version-aware) — dismissible, and re-shown for the NEXT
// announcement by bumping the key suffix. Bump in lockstep with a meaningful
// worker/CLI release the user should pick up.
const CLI_BANNER_KEY = 'openbin.cliUpdateBanner.dismissed.v4'

function CliUpdateBanner() {
  const [dismissed, setDismissed] = useState(true)
  useEffect(() => {
    try { setDismissed(localStorage.getItem(CLI_BANNER_KEY) === '1') } catch { setDismissed(false) }
  }, [])
  if (dismissed) return null
  return (
    <div className="border-b border-amber-900/50 bg-amber-950/40">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-2 text-xs text-amber-200">
        <span aria-hidden>🪟</span>
        <span className="flex-1">
          <strong>openbin v0.7.0 is out — now on Windows.</strong> Plus XAPK / split-APK support and a
          fix for empty Entry/Exports panels. Update with{' '}
          <code className="rounded bg-amber-900/40 px-1 py-0.5 font-mono text-amber-100">openbin update</code>, or install fresh —{' '}
          <a href="/docs/cli" className="font-semibold text-amber-100 underline decoration-amber-400/60 underline-offset-2 hover:text-white">CLI &amp; Docker setup</a>.
        </span>
        <button
          onClick={() => {
            try { localStorage.setItem(CLI_BANNER_KEY, '1') } catch { /* ignore */ }
            setDismissed(true)
          }}
          className="shrink-0 rounded px-1.5 py-0.5 text-amber-300/70 hover:bg-amber-900/40 hover:text-amber-100"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

// One-time announcement: the official Discord server. Mirrored in
// openapk-frontend's Layout.tsx (duplicated components — keep the copies in
// sync). Separate key from the CLI banner so dismissing one never hides the
// other; Discord-blurple accent so the two banners read as distinct when
// stacked.
const DISCORD_BANNER_KEY = 'openbin.discordBanner.dismissed.v1'

function DiscordBanner() {
  const [dismissed, setDismissed] = useState(true)
  useEffect(() => {
    try { setDismissed(localStorage.getItem(DISCORD_BANNER_KEY) === '1') } catch { setDismissed(false) }
  }, [])
  if (dismissed) return null
  return (
    <div className="border-b border-indigo-900/50 bg-indigo-950/40">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-2 text-xs text-indigo-200">
        <span aria-hidden>💬</span>
        <span className="flex-1">
          <strong>Our official Discord server is live!</strong> Join for announcements, help, and to
          talk reverse engineering with the community —{' '}
          <a
            href="https://discord.gg/HQsCZBHXwc"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-indigo-100 underline decoration-indigo-400/60 underline-offset-2 hover:text-white"
          >
            discord.gg/HQsCZBHXwc
          </a>
        </span>
        <button
          onClick={() => {
            try { localStorage.setItem(DISCORD_BANNER_KEY, '1') } catch { /* ignore */ }
            setDismissed(true)
          }}
          className="shrink-0 rounded px-1.5 py-0.5 text-indigo-300/70 hover:bg-indigo-900/40 hover:text-indigo-100"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `text-sm ${isActive ? 'text-amber-400' : 'text-zinc-300 hover:text-zinc-100'}`
      }
    >
      {children}
    </NavLink>
  )
}

