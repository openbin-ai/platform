import { useMemo, useState } from 'react'
import { useApi } from '@shared/api/client'

/**
 * Multi-sample projects: combine N selected standalone BIN projects into ONE.
 * The chosen PRIMARY keeps its name, URL, report, renames and publish state;
 * every other selection is moved in as a read-only sample and its original
 * project page is deleted (with the warning below). Public projects can only
 * be the primary — moving them would break community links, so the backend
 * blocks it and this modal explains it up front.
 */

export type CombineCandidate = {
  id: string
  name: string
  sha256: string
  arch: string | null
  executableFormat: string | null
  publicReadAt: string | null
}

type MoveState = 'pending' | 'moving' | 'done' | { error: string }

export function CombineProjectsModal({
  projects,
  onClose,
  onDone,
}: {
  projects: CombineCandidate[]
  onClose: () => void
  onDone: () => void
}) {
  const api = useApi()
  // Default primary: a public project if one is selected (it can't move), else
  // the first selection.
  const [primaryId, setPrimaryId] = useState<string>(
    () => (projects.find((p) => p.publicReadAt) ?? projects[0]).id,
  )
  const [states, setStates] = useState<Record<string, MoveState>>({})
  const [running, setRunning] = useState(false)
  const [finished, setFinished] = useState(false)

  const movees = useMemo(() => projects.filter((p) => p.id !== primaryId), [projects, primaryId])
  const publicMovees = movees.filter((p) => p.publicReadAt)
  const primary = projects.find((p) => p.id === primaryId)!

  async function run() {
    setRunning(true)
    let anyMoved = false
    // Sequential on purpose: each move deletes a project; parallel moves would
    // race the target's duplicate-sha checks and make partial failures harder
    // to read.
    for (const p of movees) {
      setStates((s) => ({ ...s, [p.id]: 'moving' }))
      try {
        await api(`/api/projects/${primaryId}/samples/move-from`, {
          method: 'POST',
          body: JSON.stringify({ sourceProjectId: p.id }),
        })
        anyMoved = true
        setStates((s) => ({ ...s, [p.id]: 'done' }))
      } catch (e) {
        setStates((s) => ({ ...s, [p.id]: { error: (e as Error).message } }))
      }
    }
    setRunning(false)
    setFinished(true)
    if (anyMoved) onDone() // refresh the list even on partial success
  }

  const allDone = finished && movees.every((p) => states[p.id] === 'done')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={running ? undefined : onClose}>
      <div
        className="w-full max-w-xl rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">Combine {projects.length} projects into one</h2>
          <button onClick={onClose} disabled={running} className="rounded px-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40" aria-label="Close">✕</button>
        </div>

        <div className="space-y-3 p-4">
          <p className="text-xs text-zinc-400">
            Pick the <strong className="text-zinc-200">primary</strong> — it keeps its name, URL, report,
            renames and publish state. The others become read-only samples of it.
          </p>
          <ul className="divide-y divide-zinc-800/60 rounded border border-zinc-800 bg-zinc-950/60">
            {projects.map((p) => {
              const st = states[p.id]
              const isPrimary = p.id === primaryId
              return (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-zinc-900">
                    <input
                      type="radio"
                      name="combine-primary"
                      checked={isPrimary}
                      disabled={running || finished}
                      onChange={() => setPrimaryId(p.id)}
                      className="accent-amber-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-zinc-100">
                        {p.name}
                        {p.publicReadAt && <span className="ml-2 text-[10px] text-emerald-400">🌐 public</span>}
                      </span>
                      <span className="block truncate text-[11px] text-zinc-500">
                        {p.executableFormat ?? '—'} · {p.arch ?? 'arch unknown'} · sha256 {p.sha256.slice(0, 12)}…
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px]">
                      {isPrimary ? (
                        <span className="rounded bg-amber-950/50 px-1.5 py-0.5 uppercase tracking-wide text-amber-300">primary</span>
                      ) : st === 'moving' ? (
                        <span className="text-amber-300">moving…</span>
                      ) : st === 'done' ? (
                        <span className="text-emerald-400">✓ moved</span>
                      ) : st && typeof st === 'object' ? (
                        <span className="text-red-400" title={st.error}>✗ failed</span>
                      ) : (
                        <span className="text-zinc-500">→ becomes a sample</span>
                      )}
                    </span>
                  </label>
                  {st && typeof st === 'object' && (
                    <p className="px-3 pb-2 text-[11px] text-red-400/90">{st.error}</p>
                  )}
                </li>
              )
            })}
          </ul>

          {publicMovees.length > 0 && (
            <div className="rounded border border-red-900/60 bg-red-950/30 px-3 py-2 text-[11px] leading-relaxed text-red-300">
              🌐 {publicMovees.map((p) => `"${p.name}"`).join(', ')} {publicMovees.length === 1 ? 'is' : 'are'} public —
              a public project can only be the primary. Make it the primary, unpublish it first, or deselect it.
            </div>
          )}
          {!finished && (
            <div className="rounded border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
              ⚠ The {movees.length === 1 ? 'other project' : `${movees.length} other projects`} will be{' '}
              <strong>deleted</strong> — their reports, renames and highlights are removed; the analyses
              live on as samples of “{primary.name}”.
            </div>
          )}

          <div className="flex justify-end gap-2">
            {allDone ? (
              <a
                href={`/projects/${primaryId}`}
                className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-amber-500"
              >
                Open “{primary.name}” →
              </a>
            ) : (
              <>
                <button onClick={onClose} disabled={running} className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40">
                  {finished ? 'Close' : 'Cancel'}
                </button>
                <button
                  onClick={() => { void run() }}
                  disabled={running || finished || publicMovees.length > 0 || movees.length === 0}
                  className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-amber-500 disabled:opacity-40"
                >
                  {running ? 'Combining…' : `Combine (${movees.length} move${movees.length === 1 ? '' : 's'})`}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
