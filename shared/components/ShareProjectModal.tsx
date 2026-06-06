import { useCallback, useEffect, useState } from 'react'
import { ApiError, useApi } from '@shared/api/client'
import type { AddCollaboratorRequest, Collaborator, ProjectRole } from '@shared/api/collaborators'

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
  const [collaborators, setCollaborators] = useState<Collaborator[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'VIEWER' | 'EDITOR'>('VIEWER')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

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

  const onAdd = useCallback(async () => {
    if (!email.trim()) return
    setAdding(true)
    setAddError(null)
    try {
      const body: AddCollaboratorRequest = { email: email.trim(), role }
      await api<Collaborator>(`/api/projects/${projectId}/collaborators`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setEmail('')
      await reload()
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : (e as Error).message)
    } finally {
      setAdding(false)
    }
  }, [api, projectId, email, role, reload])

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

  const ac = ACCENTS[accent]

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-zinc-950/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={`flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl ring-1 ${ac.ring}`}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 id="share-title" className="text-sm font-semibold text-zinc-100">
            Share project
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-4 text-[13px] text-zinc-300">
          <p className="text-xs text-zinc-500">
            Invite teammates by email. They&apos;ll see this project in their
            dashboard and inherit access at the role you pick.
            EDITORs can rename, deobfuscate, regenerate analyses and edit
            the report; VIEWERs are read-only. Only the owner can publish to
            the public feed or change the collaborator roster.
          </p>

          {/* Add form */}
          <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex-1 min-w-[180px]">
                <span className="block text-[11px] font-medium text-zinc-400">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@company.com"
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[12px] text-zinc-100 focus:border-zinc-500 focus:outline-none"
                  disabled={adding}
                />
              </label>
              <label>
                <span className="block text-[11px] font-medium text-zinc-400">Role</span>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'VIEWER' | 'EDITOR')}
                  className="mt-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[12px] text-zinc-100 focus:border-zinc-500 focus:outline-none"
                  disabled={adding}
                >
                  <option value="VIEWER">Viewer</option>
                  <option value="EDITOR">Editor</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => void onAdd()}
                disabled={adding || !email.trim()}
                className={`rounded px-3 py-1 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${ac.btn}`}
              >
                {adding ? 'Adding…' : 'Add'}
              </button>
            </div>
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
    </div>
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
