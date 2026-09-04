import { useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '@shared/api/client'
import { isOwner, type ProjectRole } from '@shared/api/collaborators'
import type { ProjectSample } from '../api/samples'

/**
 * Multi-sample projects: add a sample to an existing BIN project. Two paths:
 *
 *  - "Move from my projects": absorb an existing standalone BIN project — its
 *    analysis becomes a read-only sample here and the ORIGINAL PROJECT IS
 *    DELETED (report/renames/highlights included; the modal warns). Public
 *    projects must be unpublished first (backend enforces; rows are disabled
 *    here with the reason).
 *  - "Decompile a new binary": the web can't run Ghidra (cloud sunset), so
 *    this hands over the CLI command. The modal polls the sample list while
 *    open and announces arrivals via the samples-changed event.
 */

/** Cross-tree refresh channel (SampleTabBar lives in ProjectViewRoute). */
export const SAMPLES_CHANGED_EVENT = 'openbin:samples:changed'
export function notifySamplesChanged() {
  window.dispatchEvent(new CustomEvent(SAMPLES_CHANGED_EVENT))
}

/** Fired by the SampleTabBar's "＋ Add" button; ProjectView opens the modal. */
export const ADD_SAMPLE_EVENT = 'openbin:samples:add'

type CandidateProject = {
  id: string
  kind: 'APK' | 'BIN' | 'SCRIPT'
  name: string
  originalFilename: string
  sizeBytes: number
  sha256: string
  status: string
  arch: string | null
  executableFormat: string | null
  role: ProjectRole | null
  publicReadAt: string | null
  bundleId: string | null
}

export function AddSampleModal({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string
  projectName: string
  onClose: () => void
}) {
  const api = useApi()
  const [tab, setTab] = useState<'move' | 'cli'>('move')
  const [candidates, setCandidates] = useState<CandidateProject[] | null>(null)
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const all = await api<CandidateProject[]>('/api/projects')
        if (!cancelled) setCandidates(all.filter((p) => p.kind === 'BIN' && p.id !== projectId))
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    })()
    return () => { cancelled = true }
  }, [api, projectId])

  // While open, poll the sample list so a CLI upload finishing in another
  // terminal shows up without a manual refresh.
  const lastCount = useRef<number | null>(null)
  useEffect(() => {
    const id = setInterval(() => {
      void (async () => {
        try {
          const rows = await api<ProjectSample[]>(`/api/projects/${projectId}/samples`)
          if (lastCount.current !== null && rows.length !== lastCount.current) {
            notifySamplesChanged()
          }
          lastCount.current = rows.length
        } catch { /* transient — next tick retries */ }
      })()
    }, 5000)
    return () => clearInterval(id)
  }, [api, projectId])

  const shown = useMemo(() => {
    if (!candidates) return []
    const q = filter.trim().toLowerCase()
    return candidates.filter((p) => !q || p.name.toLowerCase().includes(q) || p.originalFilename.toLowerCase().includes(q))
  }, [candidates, filter])

  // Why a row can't be moved (server enforces the same rules).
  function blockReason(p: CandidateProject): string | null {
    if (!isOwner(p.role)) return 'shared with you — only projects you own can be moved'
    if (p.status !== 'READY') return `analysis is ${p.status}`
    if (p.publicReadAt) return 'public — unpublish it first (moving deletes its page)'
    return null
  }

  async function move() {
    if (!picked) return
    setBusy(true)
    setError(null)
    try {
      await api(`/api/projects/${projectId}/samples/move-from`, {
        method: 'POST',
        body: JSON.stringify({ sourceProjectId: picked }),
      })
      notifySamplesChanged()
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const cliCmd = `openbin decompile --project ${projectId} ./your-binary`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">
            Add a sample to <span className="text-amber-300">{projectName}</span>
          </h2>
          <button onClick={onClose} className="rounded px-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Close">✕</button>
        </div>

        <div className="flex gap-1 border-b border-zinc-800 px-4 pt-2">
          <TabBtn active={tab === 'move'} onClick={() => setTab('move')}>Move from my projects</TabBtn>
          <TabBtn active={tab === 'cli'} onClick={() => setTab('cli')}>Decompile a new binary</TabBtn>
        </div>

        {tab === 'move' ? (
          <div className="space-y-3 p-4">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="🔍 filter your BIN projects…"
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600"
            />
            <div className="max-h-64 overflow-y-auto rounded border border-zinc-800 bg-zinc-950/60">
              {candidates === null ? (
                <p className="p-3 text-xs text-zinc-500">Loading your projects…</p>
              ) : shown.length === 0 ? (
                <p className="p-3 text-xs text-zinc-500">No other BIN projects{filter ? ' match' : ''}.</p>
              ) : (
                <ul className="divide-y divide-zinc-800/60">
                  {shown.map((p) => {
                    const blocked = blockReason(p)
                    return (
                      <li key={p.id}>
                        <label
                          className={`flex items-center gap-3 px-3 py-2 text-sm ${
                            blocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-zinc-900'
                          }`}
                          title={blocked ?? undefined}
                        >
                          <input
                            type="radio"
                            name="move-source"
                            disabled={!!blocked}
                            checked={picked === p.id}
                            onChange={() => setPicked(p.id)}
                            className="accent-amber-500"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-zinc-100">{p.name}</span>
                            <span className="block truncate text-[11px] text-zinc-500">
                              {p.executableFormat ?? '—'} · {p.arch ?? 'arch unknown'} · sha256 {p.sha256.slice(0, 12)}…
                              {p.bundleId && ' · bundle member'}
                              {blocked && <span className="text-amber-400/80"> — {blocked}</span>}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            <div className="rounded border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
              ⚠ Moving <strong>deletes the original project page</strong> — its report, renames and
              highlights are removed. The analysis becomes a read-only sample of this project.
            </div>
            {error && <div className="rounded border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">Cancel</button>
              <button
                onClick={() => { void move() }}
                disabled={!picked || busy}
                className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-amber-500 disabled:opacity-40"
              >
                {busy ? 'Moving…' : 'Move here'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 p-4">
            <p className="text-xs leading-relaxed text-zinc-400">
              Decompiling runs on <strong className="text-zinc-200">your machine</strong> (cloud Ghidra is
              sunset). The result uploads straight into this project as a sample:
            </p>
            <div className="flex items-center gap-2">
              <pre className="min-w-0 flex-1 overflow-x-auto rounded border border-zinc-800 bg-black/50 p-3 font-mono text-[12px] text-amber-200">{cliCmd}</pre>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(cliCmd).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  })
                }}
                className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                {copied ? '✓ copied' : 'copy'}
              </button>
            </div>
            <p className="text-xs leading-relaxed text-zinc-500">
              Prefer a guided flow? <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-zinc-300">openbin tui</code>{' '}
              walks through file → architecture (with firmware auto-detection) → “Add to an existing project”.
              New samples appear here automatically once the upload finishes.
            </p>
            <div className="flex justify-end">
              <button onClick={onClose} className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-t border-b-2 px-3 py-1.5 text-xs transition-colors ${
        active ? 'border-amber-400 text-zinc-100' : 'border-transparent text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  )
}
