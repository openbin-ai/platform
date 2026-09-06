import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { NotificationsBell } from '@shared/components/NotificationsBell'
import { ThemeToggle } from '@shared/components/ThemeToggle'
import iconUrl from '../assets/icon.png'

// This SAME chrome wraps both the authed app routes and the anonymous
// public pages (community, profiles, terms) — the navbar must never change
// shape between tabs. Auth-only affordances (Dashboard/Projects, Settings,
// bell, sign-out) collapse to a Sign in button for visitors. Mirrors
// openbin-frontend's Layout (duplicated components — keep in sync).
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
            to="/dashboard"
            title="OpenAPK"
            className="flex items-center gap-2 text-zinc-100 transition hover:opacity-80"
          >
            <img src={iconUrl} alt="OpenAPK" className="h-7 w-7" />
            <span className="text-sm font-semibold tracking-wide">
              OPENAPK<span className="text-red-500">.AI</span>
            </span>
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            {auth.isAuthenticated && (
              <>
                <NavItem to="/dashboard">Dashboard</NavItem>
                <NavItem to="/projects">Projects</NavItem>
              </>
            )}
            {/* Community is the platform's headline value prop, not a side
                feature — give it a distinct button treatment so users hit it
                without having to scan the nav. Filled purple accent, sits
                between plain-text nav items and the Settings menu. */}
            <NavLink
              to="/community"
              end
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium shadow-sm transition ${
                  isActive
                    ? 'bg-purple-600 text-white'
                    : 'bg-purple-700/30 text-purple-200 hover:bg-purple-600/40 hover:text-purple-100'
                }`
              }
            >
              <span aria-hidden>★</span>
              Community
            </NavLink>
            <ThemeToggle storageKey="openapk.theme" />
            {auth.isAuthenticated ? (
              <>
                <SettingsNavItem />
                <NotificationsBell accent="purple" />
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
      <CliReleaseBanner />
      <DiscordBanner />
      <main className="flex-1 overflow-auto">
        {/* No max-width here — pages opt in via their own container. ProjectView
            takes full width; Dashboard / API Keys / Projects list wrap themselves. */}
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
      className={`text-sm ${active ? 'text-purple-300' : 'text-zinc-300 hover:text-zinc-100'}`}
    >
      Settings
    </NavLink>
  )
}

// CLI release announcement. The `openbin` CLI (shared across openapk +
// openbin) — v0.10.0 adds an interactive wizard + raw-firmware support.
// Links to the release notes on GitHub. Bump the key suffix to re-show for a
// future release.
const CLI_BANNER_KEY = 'openapk.cliReleaseBanner.dismissed.v2'

function CliReleaseBanner() {
  const [dismissed, setDismissed] = useState(true)
  useEffect(() => {
    try { setDismissed(localStorage.getItem(CLI_BANNER_KEY) === '1') } catch { setDismissed(false) }
  }, [])
  if (dismissed) return null
  return (
    <div className="border-b border-amber-900/50 bg-amber-950/40">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-2 text-xs text-amber-200">
        <span aria-hidden>🧙</span>
        <span className="flex-1">
          <strong>openbin CLI v0.10.0 is out.</strong> New{' '}
          <code className="rounded bg-amber-900/40 px-1 py-0.5 font-mono text-amber-100">openbin tui</code>{' '}
          interactive wizard, automatic architecture detection for raw firmware images, and
          multi-sample BIN projects. Update with{' '}
          <code className="rounded bg-amber-900/40 px-1 py-0.5 font-mono text-amber-100">openbin update</code> —{' '}
          <a
            href="https://github.com/openbin-ai/platform/releases/tag/openbin-v0.10.0"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-amber-100 underline decoration-amber-400/60 underline-offset-2 hover:text-white"
          >
            release notes
          </a>.
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
// openbin-frontend's Layout.tsx (duplicated components — keep the copies in
// sync). Dismissal is per-product via localStorage; bump the key suffix to
// re-show for a future announcement.
const DISCORD_BANNER_KEY = 'openapk.discordBanner.dismissed.v1'

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
        `text-sm ${isActive ? 'text-purple-300' : 'text-zinc-300 hover:text-zinc-100'}`
      }
    >
      {children}
    </NavLink>
  )
}

