import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import iconUrl from '../assets/icon.png'

// Top-bar chrome shared across every page that isn't the immersive
// ProjectView (which intentionally fills the viewport like an IDE).
// Brand accent matches openbin-landing — amber for the .AI wordmark.
// Sign-out goes through Keycloak's end-session endpoint (configured in
// shared/auth/oidcConfig.ts via post_logout_redirect_uri).
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
          <nav className="flex items-center gap-6 text-sm">
            <NavItem to="/">Dashboard</NavItem>
            <NavItem to="/projects">Projects</NavItem>
            <NavItem to="/community">Community</NavItem>
            <SettingsMenu />
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
        {/* No max-width here — pages opt in via their own container. */}
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
        `text-sm ${isActive ? 'text-amber-400' : 'text-zinc-300 hover:text-zinc-100'}`
      }
    >
      {children}
    </NavLink>
  )
}

/**
 * Settings dropdown — collapses Profile / API Keys / Templates / Usage
 * into a single menu. Active when on any /settings/* route. Closes on
 * outside click, ESC, or after navigation. Mirrors the openapk-frontend
 * SettingsMenu with amber accents instead of purple.
 */
function SettingsMenu() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const ref = useRef<HTMLDivElement | null>(null)
  const isActive = location.pathname.startsWith('/settings/')

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

  useEffect(() => { setOpen(false) }, [location.pathname])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1 text-sm ${
          isActive ? 'text-amber-400' : 'text-zinc-300 hover:text-zinc-100'
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
          isActive ? 'bg-amber-950/40 text-amber-300' : 'text-zinc-200 hover:bg-zinc-900'
        }`
      }
    >
      {children}
    </NavLink>
  )
}
