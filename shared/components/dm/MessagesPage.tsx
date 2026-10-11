import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { useApi } from '@shared/api/client'
import { Gravatar } from '@shared/components/Gravatar'
import {
  DM_CHANGED_EVENT,
  dmInboxPath,
  dmConversationPath,
  dmMarkReadPath,
  dmMessagesPath,
  dmOpenWithPath,
  dmSendPath,
  type DmConversationSummary,
  type DmMessage,
} from '@shared/api/dm'
import { userSearchPath, type SocialUserSummary } from '@shared/api/social'

/**
 * Direct messages: inbox on the left, open thread on the right. On phones
 * it's one pane at a time (inbox, or the thread with a back button).
 *
 * Lives in shared/ so openbin and openapk render the identical page — DMs
 * are user-level, the same conversation shows up on both. The host app
 * owns routing: it passes the active conversation id from its route and
 * gets `onOpen(id | null)` calls back to navigate.
 *
 * Freshness is polling, like the notifications bell: the open thread asks
 * for messages newer than its last one every few seconds, the inbox
 * refreshes on the same tick. No websocket — good enough for a chat
 * between two researchers, and it costs one tiny indexed query per poll.
 */
type Props = {
  activeId: string | null
  onOpen: (conversationId: string | null) => void
  accent?: 'purple' | 'amber'
}

const THREAD_POLL_MS = 4_000
const INBOX_POLL_MS = 15_000
const PAGE = 50

export function MessagesPage({ activeId, onOpen, accent = 'purple' }: Props) {
  const auth = useAuth()
  const api = useApi()
  const tone = accent === 'amber' ? AMBER : PURPLE

  const [inbox, setInbox] = useState<DmConversationSummary[] | null>(null)
  const [inboxErr, setInboxErr] = useState<string | null>(null)

  const loadInbox = useCallback(async () => {
    try {
      const rows = await api<DmConversationSummary[]>(dmInboxPath())
      setInbox(rows)
      setInboxErr(null)
    } catch (e) {
      setInboxErr(e instanceof Error ? e.message : 'failed to load')
    }
  }, [api])

  useEffect(() => {
    if (!auth.isAuthenticated) return
    void loadInbox()
    const t = setInterval(() => { if (!document.hidden) void loadInbox() }, INBOX_POLL_MS)
    const onFocus = () => { void loadInbox() }
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus) }
  }, [auth.isAuthenticated, loadInbox])

  // Local, optimistic unread clear so the row stops glowing the moment the
  // thread opens; the server's cursor catches up via markRead.
  const clearUnread = useCallback((id: string) => {
    setInbox((rows) => rows?.map((r) => (r.id === id ? { ...r, unread: 0 } : r)) ?? rows)
  }, [])

  if (!auth.isAuthenticated) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center text-sm text-zinc-400">
        Sign in to see your messages.
      </div>
    )
  }

  const active = inbox?.find((r) => r.id === activeId) ?? null
  const showList = !activeId
  const showThread = !!activeId

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-0 sm:px-6 sm:py-6">
      <div className="flex min-h-0 flex-1 overflow-hidden border-zinc-800 bg-zinc-950 sm:rounded-lg sm:border">
        {/* Inbox pane */}
        <aside
          className={`${showList ? 'flex' : 'hidden'} w-full min-w-0 flex-col border-zinc-800 sm:flex sm:w-80 sm:shrink-0 sm:border-r`}
        >
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <h1 className="text-sm font-semibold text-zinc-100">Messages</h1>
          </div>
          <NewMessage tone={tone} onOpened={(id) => { void loadInbox(); onOpen(id) }} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {inbox === null && !inboxErr && <p className="px-4 py-6 text-xs text-zinc-500">Loading…</p>}
            {inboxErr && <p className="px-4 py-6 text-xs text-red-400">Couldn't load messages: {inboxErr}</p>}
            {inbox && inbox.length === 0 && (
              <p className="px-4 py-8 text-center text-xs text-zinc-500">
                No conversations yet. Find a researcher above, or use the Message button on their profile.
              </p>
            )}
            {inbox?.map((row) => (
              <InboxRow key={row.id} row={row} active={row.id === activeId} tone={tone} onClick={() => onOpen(row.id)} />
            ))}
          </div>
        </aside>

        {/* Thread pane */}
        <section className={`${showThread ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col sm:flex`}>
          {activeId ? (
            <Thread
              key={activeId}
              id={activeId}
              summary={active}
              tone={tone}
              onBack={() => onOpen(null)}
              onActivity={() => { clearUnread(activeId); void loadInbox() }}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-zinc-500">
              Pick a conversation, or start a new one.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// --- inbox row -----------------------------------------------------------------

function InboxRow({ row, active, tone, onClick }: {
  row: DmConversationSummary; active: boolean; tone: Tone; onClick: () => void
}) {
  const unread = row.unread > 0
  const group = !!row.projectId
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 border-b border-zinc-900 px-4 py-3 text-left transition hover:bg-zinc-900/60 ${active ? 'bg-zinc-900' : ''}`}
    >
      {group ? <GroupMark size={36} /> : <Gravatar emailMd5={row.other?.emailMd5 ?? ''} size={36} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-sm ${unread ? 'font-semibold text-zinc-50' : 'text-zinc-200'}`}>
            {group ? row.projectName : row.other?.displayName}
            {group && <span className="ml-1.5 text-[10px] font-normal text-zinc-500">team chat</span>}
          </span>
          {row.lastMessageAt && (
            <span className="shrink-0 text-[10px] text-zinc-500">{relative(row.lastMessageAt)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`truncate text-xs ${unread ? 'text-zinc-200' : 'text-zinc-500'}`}>
            {row.lastMessagePreview
              ? `${row.lastMessageMine ? 'You: ' : ''}${row.lastMessagePreview}`
              : 'No messages yet'}
          </span>
          {unread && (
            <span className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tone.badge}`}>
              {row.unread}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

// --- new conversation (researcher search) ------------------------------------------

function NewMessage({ tone, onOpened }: { tone: Tone; onOpened: (id: string) => void }) {
  const api = useApi()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SocialUserSummary[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setHits(null); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const rows = await api<SocialUserSummary[]>(userSearchPath(term, 0, 8))
        if (!cancelled) setHits(rows)
      } catch { if (!cancelled) setHits([]) }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [api, q])

  const pick = async (u: SocialUserSummary) => {
    if (busy) return
    setBusy(true)
    try {
      const c = await api<DmConversationSummary>(dmOpenWithPath(u.userId), { method: 'POST' })
      setQ('')
      setHits(null)
      onOpened(c.id)
    } catch { /* leave the search as-is; user can retry */ } finally { setBusy(false) }
  }

  return (
    <div className="relative border-b border-zinc-800 px-3 py-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="New message — search researchers…"
        className={`w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none ${tone.ring}`}
      />
      {hits && (
        <div className="absolute inset-x-3 top-full z-10 mt-1 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 shadow-xl">
          {hits.length === 0 && <p className="px-3 py-2 text-xs text-zinc-500">No researchers match.</p>}
          {hits.map((u) => (
            <button
              key={u.userId}
              type="button"
              disabled={busy}
              onClick={() => void pick(u)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-900"
            >
              <Gravatar emailMd5={u.emailMd5} size={22} />
              <span className="truncate">{u.displayName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// --- thread ------------------------------------------------------------------------------

/**
 * One open conversation: history, poll, composer. Exported so a project
 * workspace can mount its team chat without the inbox around it. For a
 * group thread (summary.projectId set) bubbles from others carry the
 * sender's avatar and name. `hideHeader` lets the host supply its own.
 */
export function DmThread({ id, summary, accent = 'purple', onBack, onActivity, hideHeader = false }: {
  id: string
  summary: DmConversationSummary | null
  accent?: 'purple' | 'amber'
  onBack?: () => void
  onActivity?: () => void
  hideHeader?: boolean
}) {
  const tone = accent === 'amber' ? AMBER : PURPLE
  return <Thread id={id} summary={summary} tone={tone} onBack={onBack ?? (() => {})} onActivity={onActivity ?? (() => {})} hideHeader={hideHeader} />
}

function Thread({ id, summary, tone, onBack, onActivity, hideHeader = false }: {
  id: string
  summary: DmConversationSummary | null
  tone: Tone
  onBack: () => void
  onActivity: () => void
  hideHeader?: boolean
}) {
  const api = useApi()
  const [header, setHeader] = useState<DmConversationSummary | null>(summary)
  const [msgs, setMsgs] = useState<DmMessage[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [hasOlder, setHasOlder] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const stickToBottom = useRef(true)

  // The inbox row may not have arrived yet when a deep link opens the
  // thread; fetch the header on its own in that case.
  useEffect(() => {
    if (summary) { setHeader(summary); return }
    let cancelled = false
    api<DmConversationSummary>(dmConversationPath(id))
      .then((c) => { if (!cancelled) setHeader(c) })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'not found') })
    return () => { cancelled = true }
  }, [api, id, summary])

  const announce = useCallback(() => {
    window.dispatchEvent(new Event(DM_CHANGED_EVENT))
    onActivity()
  }, [onActivity])

  const markRead = useCallback(async () => {
    try { await api(dmMarkReadPath(id), { method: 'POST' }) } catch { /* tolerated */ }
    announce()
  }, [api, announce, id])

  // Initial page.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const page = await api<DmMessage[]>(dmMessagesPath(id, { size: PAGE }))
        if (cancelled) return
        setMsgs(page)
        setHasOlder(page.length === PAGE)
        stickToBottom.current = true
        void markRead()
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'failed to load')
      }
    })()
    return () => { cancelled = true }
  }, [api, id, markRead])

  // Poll for newer messages while open and visible.
  useEffect(() => {
    if (msgs === null) return
    const t = setInterval(async () => {
      if (document.hidden) return
      const last = msgs[msgs.length - 1]
      if (!last) {
        // Empty thread: re-fetch the first page until something arrives.
        try {
          const page = await api<DmMessage[]>(dmMessagesPath(id, { size: PAGE }))
          if (page.length) { setMsgs(page); void markRead() }
        } catch { /* next tick */ }
        return
      }
      try {
        const fresh = await api<DmMessage[]>(dmMessagesPath(id, { after: last.createdAt, size: PAGE }))
        if (fresh.length) {
          setMsgs((cur) => {
            const seen = new Set((cur ?? []).map((m) => m.id))
            return [...(cur ?? []), ...fresh.filter((m) => !seen.has(m.id))]
          })
          if (fresh.some((m) => !m.mine)) void markRead()
        }
      } catch { /* next tick */ }
    }, THREAD_POLL_MS)
    return () => clearInterval(t)
  }, [api, id, markRead, msgs])

  // Keep the view pinned to the newest message unless the user scrolled up.
  useEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [msgs])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const loadOlder = async () => {
    const first = msgs?.[0]
    if (!first) return
    try {
      const older = await api<DmMessage[]>(dmMessagesPath(id, { before: first.createdAt, size: PAGE }))
      stickToBottom.current = false
      setMsgs((cur) => [...older, ...(cur ?? [])])
      setHasOlder(older.length === PAGE)
    } catch { /* leave as-is */ }
  }

  const send = async () => {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const m = await api<DmMessage>(dmSendPath(id), { method: 'POST', body: JSON.stringify({ body }) })
      setDraft('')
      stickToBottom.current = true
      setMsgs((cur) => [...(cur ?? []), m])
      announce()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'send failed')
    } finally {
      setSending(false)
    }
  }

  const grouped = useMemo(() => groupByDay(msgs ?? []), [msgs])
  const other = header?.other
  const group = !!header?.projectId

  return (
    <>
      {!hideHeader && (
        <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
          <button type="button" onClick={onBack} className="text-zinc-400 hover:text-zinc-100 sm:hidden" aria-label="Back to inbox">
            ←
          </button>
          {group && header && (
            <>
              <GroupMark size={30} />
              <a href={`/projects/${header.projectId}/overview`} className="truncate text-sm font-medium text-zinc-100 hover:underline">
                {header.projectName}
              </a>
              <span className="text-xs text-zinc-500">
                team chat · {header.memberCount} member{header.memberCount === 1 ? '' : 's'}
              </span>
            </>
          )}
          {!group && other && (
            <>
              <Gravatar emailMd5={other.emailMd5} size={30} />
              {other.userId ? (
                <a href={`/u/${other.userId}`} className="truncate text-sm font-medium text-zinc-100 hover:underline">
                  {other.displayName}
                </a>
              ) : (
                <span className="truncate text-sm font-medium text-zinc-400">{other.displayName}</span>
              )}
            </>
          )}
        </header>
      )}

      <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {msgs === null && !err && <p className="text-xs text-zinc-500">Loading…</p>}
        {hasOlder && (
          <div className="mb-3 text-center">
            <button type="button" onClick={() => void loadOlder()} className="text-xs text-zinc-400 hover:text-zinc-200">
              Load older messages
            </button>
          </div>
        )}
        {msgs && msgs.length === 0 && (
          <p className="py-8 text-center text-xs text-zinc-500">
            {group ? 'Nothing here yet. Everyone on the project roster can read and post.' : 'Say hi. This is the start of your conversation.'}
          </p>
        )}
        {grouped.map((g) => (
          <div key={g.day}>
            <div className="my-3 text-center text-[10px] uppercase tracking-wide text-zinc-600">{g.day}</div>
            {g.items.map((m, i) => (
              <Bubble
                key={m.id}
                m={m}
                tone={tone}
                // Group threads label the sender; a run of bubbles from the
                // same person only labels the first.
                sender={group && !m.mine && g.items[i - 1]?.senderId !== m.senderId ? m.sender : null}
              />
            ))}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {err && <p className="border-t border-zinc-800 px-4 py-2 text-xs text-red-400">{err}</p>}

      <form
        onSubmit={(e) => { e.preventDefault(); void send() }}
        className="flex items-end gap-2 border-t border-zinc-800 p-3"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
          }}
          rows={1}
          maxLength={4000}
          placeholder="Write a message… (Enter to send, Shift+Enter for a new line)"
          className={`max-h-40 min-h-[38px] flex-1 resize-y rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none ${tone.ring}`}
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className={`rounded-md px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${tone.send}`}
        >
          Send
        </button>
      </form>
    </>
  )
}

function Bubble({ m, tone, sender }: { m: DmMessage; tone: Tone; sender: DmMessage['sender'] | null }) {
  return (
    <div className={`${sender ? 'mt-2' : ''} mb-1.5 flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
      {!m.mine && sender && (
        <span className="mr-2 mt-4 shrink-0">
          <Gravatar emailMd5={sender.emailMd5} size={22} />
        </span>
      )}
      {!m.mine && !sender && <span className="mr-2 w-[22px] shrink-0" aria-hidden />}
      <div className="max-w-[80%]">
        {sender && <div className="mb-0.5 px-1 text-[11px] text-zinc-500">{sender.displayName}</div>}
        <div
          title={new Date(m.createdAt).toLocaleString()}
          className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed ${
            m.mine ? tone.mine : 'bg-zinc-800 text-zinc-100'
          }`}
        >
          {m.body}
        </div>
      </div>
    </div>
  )
}

/** Avatar stand-in for a team chat row: a project has no face to show. */
function GroupMark({ size }: { size: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-800 text-zinc-300"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      aria-hidden
    >
      #
    </span>
  )
}

// --- helpers ------------------------------------------------------------------------------

type Tone = { badge: string; ring: string; send: string; mine: string }

const PURPLE: Tone = {
  badge: 'bg-purple-600 text-white',
  ring: 'focus:border-purple-500',
  send: 'bg-purple-600 text-white hover:bg-purple-500',
  mine: 'bg-purple-600 text-white',
}
const AMBER: Tone = {
  badge: 'bg-amber-500 text-black',
  ring: 'focus:border-amber-500',
  send: 'bg-amber-500 text-black hover:bg-amber-400',
  mine: 'bg-amber-500 text-black',
}

function groupByDay(items: DmMessage[]): { day: string; items: DmMessage[] }[] {
  const out: { day: string; items: DmMessage[] }[] = []
  for (const m of items) {
    const day = dayLabel(m.createdAt)
    const last = out[out.length - 1]
    if (last && last.day === day) last.items.push(m)
    else out.push({ day, items: [m] })
  }
  return out
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return 'Today'
  const y = new Date(today); y.setDate(today.getDate() - 1)
  if (sameDay(d, y)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

function relative(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
