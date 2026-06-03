import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../api/client'

type RenameStatus = 'SUGGESTED' | 'APPLIED'

export type Rename = {
  id: string
  original: string
  suggested: string
  scope: string
  status: RenameStatus
  confidence: string
  sourcePath: string | null
  rationale: string | null
  createdAt: string
}

/**
 * Right-panel tab content for managing AI-suggested identifier renames.
 *
 * - SUGGESTED rows have a checkbox + "Apply selected" so the user reviews before
 *   anything mutates the served file content.
 * - APPLIED rows are listed below with an inline Unapply.
 * - `refreshKey` bumps refetch (parent increments after a successful suggest).
 * - `onMutation` fires whenever a rename row is added/changed/removed so the
 *   parent can re-fetch the currently-open file (its content reflects active
 *   renames server-side).
 */
export function Renames({
  projectId, refreshKey, onMutation,
}: {
  projectId: string
  refreshKey: number
  onMutation: () => void
}) {
  const api = useApi()
  const [items, setItems] = useState<Rename[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setError(null)
    try {
      const list = await api<Rename[]>(`/api/projects/${projectId}/renames`)
      setItems(list)
      // Drop selections that no longer exist
      setSelected(prev => {
        const stillThere = new Set(list.map(r => r.original))
        const next = new Set<string>()
        for (const o of prev) if (stillThere.has(o)) next.add(o)
        return next
      })
    } catch (e) {
      setError((e as Error).message)
    }
  }, [api, projectId])

  useEffect(() => { void reload() }, [reload, refreshKey])

  async function applySelected() {
    if (selected.size === 0) return
    setBusy(true)
    setError(null)
    try {
      await api(`/api/projects/${projectId}/renames/apply`, {
        method: 'POST',
        body: JSON.stringify({ originals: Array.from(selected) }),
      })
      setSelected(new Set())
      await reload()
      onMutation()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function unapply(original: string) {
    if (!window.confirm(`Remove the rename for "${original}"? Source files will revert to the original name.`)) return
    setBusy(true)
    setError(null)
    try {
      await api(
        `/api/projects/${projectId}/renames?original=${encodeURIComponent(original)}`,
        { method: 'DELETE' },
      )
      await reload()
      onMutation()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error) return <p className="p-3 text-xs text-red-400">Failed: {error}</p>
  if (items === null) return <p className="p-3 text-xs text-zinc-500">Loading…</p>

  const suggested = items.filter(i => i.status === 'SUGGESTED')
  const applied = items.filter(i => i.status === 'APPLIED')

  if (items.length === 0) {
    return (
      <div className="p-4 text-xs text-zinc-500">
        No renames yet. Open a decompiled file and hit <strong>Suggest renames</strong> in the code viewer header.
      </div>
    )
  }

  return (
    <div className="space-y-4 p-3">
      {suggested.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Suggested ({suggested.length})
            </h3>
            <div className="flex gap-1">
              <button
                onClick={() => setSelected(new Set(suggested.map(s => s.original)))}
                className="text-[10px] text-zinc-400 hover:text-zinc-200"
              >
                Select all
              </button>
              <span className="text-[10px] text-zinc-600">·</span>
              <button
                onClick={() => setSelected(new Set())}
                disabled={selected.size === 0}
                className="text-[10px] text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
              >
                Clear
              </button>
            </div>
          </div>
          <ul className="space-y-2">
            {suggested.map(r => (
              <li
                key={r.id}
                className="rounded border border-zinc-800 bg-zinc-950/60 p-2"
              >
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(r.original)}
                    onChange={e => setSelected(prev => {
                      const next = new Set(prev)
                      if (e.target.checked) next.add(r.original)
                      else next.delete(r.original)
                      return next
                    })}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-1.5 text-xs">
                      <span className="font-mono text-zinc-400 line-through">{r.original}</span>
                      <span className="text-zinc-500">→</span>
                      <span className="font-mono text-purple-300">{r.suggested}</span>
                      <ScopePill scope={r.scope} />
                      <ConfPill confidence={r.confidence} />
                    </div>
                    {r.rationale && (
                      <p className="mt-1 text-[11px] text-zinc-400">{r.rationale}</p>
                    )}
                  </div>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={applySelected}
              disabled={busy || selected.size === 0}
              className="rounded bg-purple-600 px-3 py-1 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50"
            >
              {busy ? 'Applying…' : `Apply selected (${selected.size})`}
            </button>
            <span className="text-[10px] text-zinc-600">
              Applies project-wide. You can unapply later.
            </span>
          </div>
        </section>
      )}

      {applied.length > 0 && (
        <section>
          <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Active ({applied.length})
          </h3>
          <ul className="space-y-1">
            {applied.map(r => (
              <li
                key={r.id}
                className="flex items-center gap-2 rounded border border-emerald-900/40 bg-emerald-950/20 px-2 py-1.5 text-xs"
              >
                <span className="min-w-0 flex-1 truncate font-mono">
                  <span className="text-zinc-500 line-through">{r.original}</span>
                  <span className="mx-1 text-zinc-600">→</span>
                  <span className="text-emerald-200">{r.suggested}</span>
                </span>
                <ScopePill scope={r.scope} />
                <button
                  onClick={() => unapply(r.original)}
                  disabled={busy}
                  className="rounded text-[11px] text-zinc-400 hover:text-red-300 disabled:opacity-30"
                  title="Unapply"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function ScopePill({ scope }: { scope: string }) {
  const styles: Record<string, string> = {
    class:  'bg-purple-950/60 text-purple-300',
    method: 'bg-sky-950/60 text-sky-300',
    field:  'bg-amber-950/60 text-amber-300',
  }
  return (
    <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${styles[scope] ?? 'bg-zinc-800 text-zinc-300'}`}>
      {scope}
    </span>
  )
}

function ConfPill({ confidence }: { confidence: string }) {
  const styles = confidence === 'high'
    ? 'bg-emerald-950/60 text-emerald-300'
    : 'bg-zinc-800 text-zinc-300'
  return <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${styles}`}>{confidence}</span>
}
