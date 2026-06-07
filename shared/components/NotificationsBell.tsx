import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { useApi } from '@shared/api/client'
import { Gravatar } from '@shared/components/Gravatar'
import {
  markAllReadPath,
  markReadPath,
  notificationsPath,
  unreadCountPath,
  type NotificationPayload,
  type NotificationResponse,
} from '@shared/api/notifications'

/**
 * Bell icon in the global header. Polls /api/notifications/unread-count
 * every 30s so the badge stays roughly fresh without a websocket. The
 * dropdown body is only fetched when the user opens it, so the polling
 * cost is one tiny GET regardless of how many notifications they have.
 *
 * Hidden when the viewer isn't authenticated — anonymous browsers don't
 * have notifications, and the bell would just be a dead control.
 */
type Props = {
  // Tailwind accent for the unread badge + dropdown highlights. Matches
  // the host product (purple for openapk, amber for openbin).
  accent?: 'purple' | 'amber'
}

export function NotificationsBell({ accent = 'purple' }: Props) {
  const auth = useAuth()
  const api = useApi()
  const [unread, setUnread] = useState<number>(0)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationResponse[] | null>(null)
  const [loading, setLoading] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // Poll unread count while signed in. 30s is the right balance between
  // "feels live" and "doesn't hammer the API or the database's partial
  // unread index". Also re-fetches on window focus so coming back from
  // a tab catches up faster.
  useEffect(() => {
    if (!auth.isAuthenticated) return
    let cancelled = false
    const tick = async () => {
      try {
        const r = await api<{ unread: number }>(unreadCountPath())
        if (!cancelled) setUnread(r.unread)
      } catch { /* tolerate transient API failures — try again next tick */ }
    }
    void tick()
    const interval = setInterval(tick, 30_000)
    const onFocus = () => { void tick() }
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [api, auth.isAuthenticated])

  // Close the dropdown on any click outside the bell's wrapper. Capture
  // phase so dropdown-internal handlers don't trigger this teardown.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api<NotificationResponse[]>(notificationsPath(20))
      setItems(r)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [api])

  const onToggle = useCallback(async () => {
    const next = !open
    setOpen(next)
    if (next) await loadItems()
  }, [loadItems, open])

  const onRowClick = useCallback(async (n: NotificationResponse) => {
    // Best-effort mark-read; navigation proceeds either way so a flaky
    // network doesn't strand the user on the dropdown.
    if (!n.read) {
      try { await api(markReadPath(n.id), { method: 'POST' }) } catch { /* tolerated */ }
      setUnread((c) => Math.max(0, c - 1))
    }
    // Plain navigation — shared/ can't depend on react-router-dom, so
    // we use the browser History API to keep client-side routing intact.
    window.history.pushState({}, '', n.link)
    window.dispatchEvent(new PopStateEvent('popstate'))
    setOpen(false)
  }, [api])

  const onMarkAllRead = useCallback(async () => {
    try {
      await api(markAllReadPath(), { method: 'POST' })
      setUnread(0)
      setItems((prev) => prev?.map((n) => ({ ...n, read: true })) ?? null)
    } catch { /* swallow */ }
  }, [api])

  if (!auth.isAuthenticated) return null

  const badgeBg = accent === 'amber' ? 'bg-amber-500 text-black' : 'bg-purple-600 text-white'
  const linkColor = accent === 'amber' ? 'text-amber-300' : 'text-purple-300'

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={onToggle}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative rounded p-1.5 text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100"
      >
        {/* Inline bell svg keeps the component dependency-free. */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className={`absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-tight ${badgeBg}`}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 shadow-xl">
          <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">Notifications</span>
            {items && items.some((n) => !n.read) && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className={`text-[11px] ${linkColor} hover:underline`}
              >
                Mark all read
              </button>
            )}
          </header>

          <div className="max-h-[420px] overflow-y-auto">
            {loading && !items && (
              <p className="px-3 py-6 text-center text-xs text-zinc-500">Loading…</p>
            )}
            {items && items.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-zinc-500">
                Nothing here yet. New followers, comments and invites will show up here.
              </p>
            )}
            {items && items.length > 0 && (
              <ul className="divide-y divide-zinc-800">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => void onRowClick(n)}
                      className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-zinc-900 ${!n.read ? 'bg-zinc-900/40' : ''}`}
                    >
                      <Gravatar emailMd5={n.payload.actorEmailMd5 ?? ''} size={28} className="mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-xs text-zinc-200">
                          <RowText kind={n.kind} payload={n.payload} />
                        </p>
                        <p className="mt-0.5 text-[10px] text-zinc-500">{formatRelative(n.createdAt)}</p>
                      </div>
                      {!n.read && (
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${badgeBg}`} />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Render the row's headline. Kept centralized so future kinds add one
 * branch here instead of touching the layout.
 */
function RowText({ kind, payload }: { kind: string; payload: NotificationPayload }) {
  const actor = <strong className="font-medium text-zinc-100">{payload.actorDisplayName ?? 'Someone'}</strong>
  if (kind === 'NEW_FOLLOWER') {
    return <>{actor} started following you.</>
  }
  if (kind === 'COMMENT_ON_MY_REPORT') {
    return <>{actor} commented on <em className="not-italic text-zinc-100">{payload.reportTitle ?? 'your report'}</em>.</>
  }
  if (kind === 'REPLY_TO_MY_COMMENT') {
    return <>{actor} replied to your comment on <em className="not-italic text-zinc-100">{payload.reportTitle ?? 'a report'}</em>.</>
  }
  if (kind === 'COLLABORATOR_INVITE') {
    const role = payload.role === 'EDITOR' ? 'an editor' : 'a viewer'
    return <>{actor} invited you to <em className="not-italic text-zinc-100">{payload.projectName ?? 'a project'}</em> as {role}.</>
  }
  return <>{actor} sent you new activity.</>
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Math.max(0, Date.now() - then)
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
