import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi } from '@shared/api/client'
import {
  type ProjectMember,
  type ProjectRole,
  relativeActive,
  isOnline,
} from '@shared/api/collaborators'

// In-project presence roster: overlapping avatar stack in the project header
// showing who's on this project + a click-through list with role and
// last-active. Also owns the presence heartbeat (pings on mount + every 60s
// while the project view is open). Read-only: managing the roster stays in
// the ShareProjectModal.
//
// Avatars are initials (the authenticated /members payload has email, not the
// md5 Gravatar wants) with a deterministic color per user.

const HEARTBEAT_MS = 60_000
const REFRESH_MS = 45_000
const MAX_AVATARS = 5

const AVATAR_COLORS = [
  '#7c3aed', '#0ea5e9', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6',
]

function colorFor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function initials(m: ProjectMember): string {
  const src = m.displayName?.trim() || m.email || '?'
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}

function roleLabel(role: ProjectRole): string {
  return role.charAt(0) + role.slice(1).toLowerCase()
}

function Avatar({ m, size = 26, ring = true }: { m: ProjectMember; size?: number; ring?: boolean }) {
  const online = isOnline(m.lastActiveAt)
  return (
    <span
      title={m.displayName || m.email}
      className="relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size, height: size, fontSize: size * 0.4,
        background: m.isBot ? '#3f3f46' : colorFor(m.userId),
        boxShadow: ring ? '0 0 0 2px var(--members-ring, #0a0a0a)' : undefined,
      }}
    >
      {m.isBot ? '🤖' : initials(m)}
      {online && (
        <span
          className="absolute rounded-full bg-emerald-400"
          style={{ width: size * 0.28, height: size * 0.28, right: -1, bottom: -1, boxShadow: '0 0 0 2px var(--members-ring, #0a0a0a)' }}
        />
      )}
    </span>
  )
}

export function MembersBar({ projectId }: { projectId: string }) {
  const api = useApi()
  const [members, setMembers] = useState<ProjectMember[] | null>(null)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      setMembers(await api<ProjectMember[]>(`/api/projects/${projectId}/members`))
    } catch {
      // Roster is non-critical chrome — swallow (e.g. transient 401 mid-refresh).
    }
  }, [api, projectId])

  const beat = useCallback(async () => {
    try {
      await api(`/api/projects/${projectId}/presence`, { method: 'POST' })
    } catch { /* non-critical */ }
  }, [api, projectId])

  useEffect(() => {
    let alive = true
    void beat().then(() => { if (alive) void load() })
    const hb = setInterval(() => void beat(), HEARTBEAT_MS)
    const rf = setInterval(() => { if (!document.hidden) void load() }, REFRESH_MS)
    return () => { alive = false; clearInterval(hb); clearInterval(rf) }
  }, [beat, load])

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open])

  if (!members || members.length === 0) return null

  // Sort: online first, then owner, then by role, so the visible avatars are
  // the people actually around.
  const sorted = [...members].sort((a, b) => {
    const ao = isOnline(a.lastActiveAt) ? 0 : 1
    const bo = isOnline(b.lastActiveAt) ? 0 : 1
    if (ao !== bo) return ao - bo
    if (a.role === 'OWNER') return -1
    if (b.role === 'OWNER') return 1
    return 0
  })
  const shown = sorted.slice(0, MAX_AVATARS)
  const overflow = sorted.length - shown.length

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center rounded-full py-0.5 pl-0.5 pr-2 transition hover:bg-zinc-800/60"
        title="Who's working this project"
      >
        <span className="flex items-center" style={{ ['--members-ring' as string]: 'var(--color-zinc-900)' }}>
          {shown.map((m, i) => (
            <span key={m.userId} style={{ marginLeft: i === 0 ? 0 : -8 }}>
              <Avatar m={m} />
            </span>
          ))}
          {overflow > 0 && (
            <span
              className="relative inline-flex items-center justify-center rounded-full bg-zinc-700 text-[10px] font-semibold text-zinc-200"
              style={{ width: 26, height: 26, marginLeft: -8, boxShadow: '0 0 0 2px #18181b' }}
            >
              +{overflow}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-64 rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 shadow-xl">
          <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Members · {members.length}
          </div>
          {sorted.map((m) => (
            <div key={m.userId} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-zinc-800/60">
              <span style={{ ['--members-ring' as string]: 'var(--color-zinc-900)' }}>
                <Avatar m={m} size={28} ring={false} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-zinc-200">
                  {m.displayName || m.email}
                  {m.isSelf && <span className="ml-1 text-[11px] text-zinc-500">(you)</span>}
                </div>
                <div className="text-[11px] text-zinc-500">
                  {roleLabel(m.role)}
                  {m.lastActiveAt && <span className="text-zinc-600"> · {relativeActive(m.lastActiveAt)}</span>}
                </div>
              </div>
              {isOnline(m.lastActiveAt) && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
