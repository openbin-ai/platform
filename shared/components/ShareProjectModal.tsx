import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ApiError, useApi } from '@shared/api/client'
import { useMe } from '@shared/api/me'
import { followersPath, followingPath, userSearchPath, type SocialUserSummary } from '@shared/api/social'
import { Gravatar } from '@shared/components/Gravatar'
import type { AddCollaboratorRequest, Collaborator, ProjectRole } from '@shared/api/collaborators'

type PickerTab = 'search' | 'following' | 'followers' | 'email'

const PICKER_TABS: { id: PickerTab; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'following', label: 'Following' },
  { id: 'followers', label: 'Followers' },
  { id: 'email', label: 'Email' },
]

/**
 * Owner-only modal for managing a project's collaborator roster.
 *
 * <p>VIEWER and EDITOR appear in the dropdown when adding. OWNER does
 * not — there is exactly one owner per project, set by who uploaded it.
 * Adding an existing collaborator updates their role; removing revokes
 * access.
 *
 * <p>{@code accent} matches the host frontend's brand color (purple on
 * openbin, amber on openapk) so the action button stays consistent with
 * the rest of the app.
 */
export function ShareProjectModal({
  projectId,
  onClose,
  accent = 'indigo',
}: {
  projectId: string
  onClose: () => void
  accent?: 'indigo' | 'purple' | 'amber'
}) {
  const api = useApi()
  const me = useMe()
  const [collaborators, setCollaborators] = useState<Collaborator[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'VIEWER' | 'EDITOR'>('VIEWER')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  // People picker: search by name, or pick from the follow graph. Email is
  // kept as a fallback tab for teammates outside the graph.
  const [tab, setTab] = useState<PickerTab>('search')
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState<SocialUserSummary[] | null>(null)
  const [peopleError, setPeopleError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoadError(null)
    try {
      const list = await api<Collaborator[]>(`/api/projects/${projectId}/collaborators`)
      setCollaborators(list)
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : (e as Error).message)
    }
  }, [api, projectId])

  useEffect(() => { void reload() }, [reload])

  const invite = useCallback(async (body: AddCollaboratorRequest) => {
    setAdding(true)
    setAddError(null)
    try {
      await api<Collaborator>(`/api/projects/${projectId}/collaborators`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      await reload()
      return true
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : (e as Error).message)
      return false
    } finally {
      setAdding(false)
    }
  }, [api, projectId, reload])

  const onAddEmail = useCallback(async () => {
    if (!email.trim()) return
    if (await invite({ email: email.trim(), role })) setEmail('')
  }, [email, role, invite])

  // Debounced search. Below the backend's 2-char floor we clear rather
  // than fire a request that always returns [].
  useEffect(() => {
    if (tab !== 'search') return
    const q = query.trim()
    if (q.length < 2) { setPeople(null); setPeopleError(null); return }
    let cancelled = false
    const t = setTimeout(() => {
      api<SocialUserSummary[]>(userSearchPath(q, 0, 15))
        .then((rows) => { if (!cancelled) { setPeople(rows); setPeopleError(null) } })
        .catch((e: unknown) => {
          if (!cancelled) setPeopleError(e instanceof Error ? e.message : 'Search failed')
        })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [api, tab, query])

  // Follow-graph tabs load once per switch; these lists are small and
  // change rarely, so there's no need to refetch while the modal is open.
  useEffect(() => {
    if (tab === 'search' || tab === 'email' || !me?.userId) return
    let cancelled = false
    setPeople(null)
    setPeopleError(null)
    const path = tab === 'followers'
      ? followersPath(me.userId, 0, 50)
      : followingPath(me.userId, 0, 50)
    api<SocialUserSummary[]>(path)
      .then((rows) => { if (!cancelled) setPeople(rows) })
      .catch((e: unknown) => {
        if (!cancelled) setPeopleError(e instanceof Error ? e.message : 'Could not load list')
      })
    return () => { cancelled = true }
  }, [api, tab, me?.userId])

  const onRemove = useCallback(async (userId: string) => {
    setRemoving(userId)
    try {
      await api(`/api/projects/${projectId}/collaborators/${userId}`, { method: 'DELETE' })
      await reload()
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : (e as Error).message)
    } finally {
      setRemoving(null)
    }
  }, [api, projectId, reload])

  // Already-has-access set, so the picker can grey those rows out instead
  // of letting the click come back as a 409/no-op.
  const existingIds = useMemo(
    () => new Set((collaborators ?? []).map((c) => c.userId)),
    [collaborators],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const ac = ACCENTS[accent]

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className={`flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl ring-1 ${ac.ring}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 id="share-title" className="text-sm font-semibold text-zinc-100">
            Share project
          </h2>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose() }}
            className="rounded p-1 text-lg leading-none text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-4 text-[13px] text-zinc-300">
          <p className="text-xs text-zinc-500">
            Invited people see this project in their dashboard at the role
            you pick. EDITORs can rename, deobfuscate, regenerate analyses
            and edit the report; VIEWERs are read-only. Only the owner can
            publish to the public feed or change the roster.
          </p>

          {/* Add form */}
          <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex gap-1">
                {PICKER_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { setTab(t.id); setAddError(null) }}
                    className={`rounded px-2 py-0.5 text-[11px] ${
                      tab === t.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1">
                <span className="text-[11px] text-zinc-500">Role</span>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'VIEWER' | 'EDITOR')}
                  className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-100 focus:border-zinc-500 focus:outline-none"
                  disabled={adding}
                >
                  <option value="VIEWER">Viewer</option>
                  <option value="EDITOR">Editor</option>
                </select>
              </label>
            </div>

            {tab === 'email' ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[180px] flex-1">
                  <span className="block text-[11px] font-medium text-zinc-400">Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void onAddEmail() }}
                    placeholder="teammate@company.com"
                    className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[12px] text-zinc-100 focus:border-zinc-500 focus:outline-none"
                    disabled={adding}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void onAddEmail()}
                  disabled={adding || !email.trim()}
                  className={`rounded px-3 py-1 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${ac.btn}`}
                >
                  {adding ? 'Adding…' : 'Add'}
                </button>
              </div>
            ) : (
              <>
                {tab === 'search' && (
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search researchers by name…"
                    autoFocus
                    className="mb-2 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[12px] text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
                  />
                )}
                <PeopleList
                  people={people}
                  error={peopleError}
                  emptyHint={
                    tab === 'search'
                      ? (query.trim().length < 2 ? 'Type at least 2 characters.' : 'No researchers match.')
                      : tab === 'followers' ? 'Nobody follows you yet.' : 'You aren’t following anyone yet.'
                  }
                  // The owner and existing collaborators can't be invited
                  // again — show them as already-in rather than letting the
                  // click 409.
                  existing={existingIds}
                  selfId={me?.userId}
                  busy={adding}
                  accentBtn={ac.btn}
                  onInvite={(userId) => void invite({ userId, role })}
                />
              </>
            )}
            {addError && (
              <p className="mt-2 font-mono text-[11px] text-red-400">{addError}</p>
            )}
          </div>

          {/* Roster */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Collaborators
              </span>
              {collaborators && collaborators.length > 0 && (
                <span className="text-[11px] text-zinc-600">{collaborators.length}</span>
              )}
            </div>
            {loadError ? (
              <p className="rounded border border-red-900/60 bg-red-950/40 p-2 font-mono text-[11px] text-red-300/90">
                {loadError}
              </p>
            ) : collaborators === null ? (
              <p className="text-xs text-zinc-600">Loading…</p>
            ) : collaborators.length === 0 ? (
              <p className="text-xs text-zinc-600">No collaborators yet.</p>
            ) : (
              <ul className="divide-y divide-zinc-800 rounded border border-zinc-800">
                {collaborators.map((c) => (
                  <li key={c.userId} className="flex items-center justify-between gap-3 p-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] text-zinc-100">
                        {c.displayName || c.email}
                      </div>
                      {c.displayName && (
                        <div className="truncate font-mono text-[10px] text-zinc-500">
                          {c.email}
                        </div>
                      )}
                    </div>
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${ROLE_CHIP[c.role]}`}>
                      {c.role.toLowerCase()}
                    </span>
                    <button
                      type="button"
                      onClick={() => void onRemove(c.userId)}
                      disabled={removing === c.userId}
                      className="shrink-0 rounded px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-red-300 disabled:opacity-40"
                    >
                      {removing === c.userId ? '…' : 'Remove'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Scrollable list of candidate invitees. Rows already on the project (and
 * the owner themselves) render as disabled with a reason, so the picker
 * never offers an action that can only fail.
 */
function PeopleList({
  people,
  error,
  emptyHint,
  existing,
  selfId,
  busy,
  accentBtn,
  onInvite,
}: {
  people: SocialUserSummary[] | null
  error: string | null
  emptyHint: string
  existing: Set<string>
  selfId?: string
  busy: boolean
  accentBtn: string
  onInvite: (userId: string) => void
}) {
  if (error) {
    return <p className="rounded border border-red-900/60 bg-red-950/40 p-2 font-mono text-[11px] text-red-300/90">{error}</p>
  }
  if (people === null) {
    return <p className="py-3 text-center text-[11px] text-zinc-600">{emptyHint}</p>
  }
  if (people.length === 0) {
    return <p className="py-3 text-center text-[11px] text-zinc-600">{emptyHint}</p>
  }
  return (
    <ul className="max-h-52 divide-y divide-zinc-800/60 overflow-y-auto rounded border border-zinc-800">
      {people.map((p) => {
        const already = existing.has(p.userId)
        const isSelf = selfId === p.userId
        const blocked = already || isSelf
        return (
          <li key={p.userId} className="flex items-center gap-2 px-2 py-1.5">
            <Gravatar emailMd5={p.emailMd5} size={22} />
            <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-200">{p.displayName}</span>
            {blocked ? (
              <span className="shrink-0 text-[10px] text-zinc-600">
                {isSelf ? 'you' : 'already added'}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onInvite(p.userId)}
                disabled={busy}
                className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium disabled:opacity-40 ${accentBtn}`}
              >
                Add
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

const ACCENTS: Record<'indigo' | 'purple' | 'amber', { btn: string; ring: string }> = {
  indigo: { btn: 'bg-indigo-500 hover:bg-indigo-400 text-white', ring: 'ring-indigo-700/40' },
  purple: { btn: 'bg-purple-500 hover:bg-purple-400 text-white', ring: 'ring-purple-700/40' },
  amber:  { btn: 'bg-amber-500 hover:bg-amber-400 text-zinc-950', ring: 'ring-amber-700/40' },
}

const ROLE_CHIP: Record<ProjectRole, string> = {
  OWNER:  'border-zinc-600 bg-zinc-800/60 text-zinc-300',
  EDITOR: 'border-emerald-700/60 bg-emerald-900/30 text-emerald-300',
  VIEWER: 'border-zinc-700 bg-zinc-900 text-zinc-400',
}
