import { Link, NavLink, Outlet } from 'react-router-dom'
import { useMe } from '@shared/api/me'

// Tabbed /settings page — replaced the old navbar dropdown so settings
// feels like a real place instead of a menu. Tabs are routes, so each
// section keeps its own URL (/settings/profile, /settings/api-keys, ...).
// Mirrored in openapk-frontend with purple accents (duplicated components
// — keep the copies in sync).
export function SettingsLayout() {
  const me = useMe()
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-end justify-between">
        <h1 className="text-xl font-semibold text-zinc-100">Settings</h1>
        {me && (
          <Link
            to={`/u/${me.userId}`}
            className="text-sm text-zinc-400 hover:text-amber-300"
            title="Your public researcher profile as others see it"
          >
            View public profile →
          </Link>
        )}
      </div>
      <nav className="mb-6 flex gap-1 border-b border-zinc-800 text-sm">
        <Tab to="/settings/profile">Profile</Tab>
        <Tab to="/settings/api-keys">API Keys</Tab>
        <Tab to="/settings/report-templates">Templates</Tab>
        <Tab to="/settings/usage">Usage</Tab>
      </nav>
      <Outlet />
    </div>
  )
}

function Tab({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `-mb-px border-b-2 px-3 py-2 transition ${
          isActive
            ? 'border-amber-400 text-amber-300'
            : 'border-transparent text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
        }`
      }
    >
      {children}
    </NavLink>
  )
}
