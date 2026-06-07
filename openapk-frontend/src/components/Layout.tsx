import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { NotificationsBell } from '@shared/components/NotificationsBell'
import iconUrl from '../assets/icon.png'

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
            <NavItem to="/dashboard">Dashboard</NavItem>
            <NavItem to="/projects">Projects</NavItem>
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
            <SettingsMenu />
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
          </nav>
        </div>
      </header>
      <main className="flex-1 overflow-auto">
        {/* No max-width here — pages opt in via their own container. ProjectView
            takes full width; Dashboard / API Keys / Projects list wrap themselves. */}
        <Outlet />
      </main>
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

/**
 * Settings dropdown — collapses the per-page settings nav items (Profile,
 * API Keys, Templates, Usage) into a single menu. Marked active whenever
 * the user is on any /settings/* route. Closes on outside click + ESC.
 *
 * Pure-CSS dropdown via local state — no portal, no library. Adequate
 * for a tiny menu like this; if we ever add more entries, switch to a
 * proper headless-ui Menu primitive.
 */
function SettingsMenu() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const ref = useRef<HTMLDivElement | null>(null)
  const isActive = location.pathname.startsWith('/settings/')

  // Close on outside click + escape.
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Close after navigation so the menu doesn't stay open on the new page.
  useEffect(() => { setOpen(false) }, [location.pathname])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1 text-sm ${
          isActive ? 'text-purple-300' : 'text-zinc-300 hover:text-zinc-100'
        }`}
      >
        Settings
        <span aria-hidden className="text-[10px]">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 w-44 overflow-hidden rounded border border-zinc-800 bg-zinc-950 shadow-xl"
        >
          <MenuLink to="/settings/profile">Profile</MenuLink>
          <MenuLink to="/settings/api-keys">API Keys</MenuLink>
          <MenuLink to="/settings/report-templates">Templates</MenuLink>
          <MenuLink to="/settings/usage">Usage</MenuLink>
        </div>
      )}
    </div>
  )
}

function MenuLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      role="menuitem"
      className={({ isActive }) =>
        `block px-3 py-2 text-sm ${
          isActive ? 'bg-purple-950/40 text-purple-200' : 'text-zinc-200 hover:bg-zinc-900'
        }`
      }
    >
      {children}
    </NavLink>
  )
}
