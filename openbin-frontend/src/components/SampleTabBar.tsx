import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApi } from '@shared/api/client'
import type { ProjectSample } from '../api/samples'
import { ADD_SAMPLE_EVENT, SAMPLES_CHANGED_EVENT, notifySamplesChanged } from './AddSampleModal'

/**
 * Multi-sample projects: tab strip above the BIN workspace listing the
 * project's samples — the primary binary first, then every attached sample.
 * Switching writes/clears the {@code ?sample=} search param; ProjectView's
 * reload watches it and swaps the analysis source without a remount.
 *
 * Renders nothing when the project has no attached samples (the overwhelmingly
 * common case), mirroring BundleTabBar's self-hide. Listens for the
 * samples-changed window event (AddSampleModal, manage actions) to refetch,
 * and its "＋ Add" button asks ProjectView (a different tree) to open the
 * add-sample modal via the add event.
 *
 * "manage" flips the bar into edit mode: ✎ renames a sample's label, ✕
 * deletes the sample (its stored analysis included).
 */
export function SampleTabBar({ projectId, primaryLabel }: { projectId: string; primaryLabel: string }) {
  const api = useApi()
  const [samples, setSamples] = useState<ProjectSample[]>([])
  const [managing, setManaging] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const active = searchParams.get('sample')

  const refetch = useCallback(async () => {
    try {
      const rows = await api<ProjectSample[]>(`/api/projects/${projectId}/samples`)
      setSamples(rows)
    } catch {
      // Non-fatal: an older backend without the endpoint just means no bar.
    }
  }, [api, projectId])

  useEffect(() => {
    setSamples([])
    void refetch()
  }, [refetch])

  useEffect(() => {
    const onChanged = () => { void refetch() }
    window.addEventListener(SAMPLES_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(SAMPLES_CHANGED_EVENT, onChanged)
  }, [refetch])

  if (samples.length === 0) return null

  const pick = (sampleId: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (sampleId) next.set('sample', sampleId)
    else next.delete('sample')
    setSearchParams(next, { replace: true })
  }

  async function renameSample(s: ProjectSample) {
    const label = window.prompt('New label for this sample:', s.label)?.trim()
    if (!label || label === s.label) return
    try {
      await api(`/api/projects/${projectId}/samples/${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ label }),
      })
      notifySamplesChanged()
    } catch (e) {
      window.alert(`Rename failed: ${(e as Error).message}`)
    }
  }

  async function deleteSample(s: ProjectSample) {
    if (!window.confirm(`Remove sample "${s.label}"? Its stored analysis is deleted (this does not touch the primary sample).`)) return
    try {
      await api(`/api/projects/${projectId}/samples/${s.id}`, { method: 'DELETE' })
      if (active === s.id) pick(null) // don't leave the view on a deleted sample
      notifySamplesChanged()
    } catch (e) {
      window.alert(`Delete failed: ${(e as Error).message}`)
    }
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs">
      <span
        className="shrink-0 rounded border border-amber-700/60 bg-amber-950/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-amber-300"
        title="This project holds decompile results for several samples"
      >
        {samples.length + 1} samples
      </span>
      <button
        onClick={() => pick(null)}
        className={
          'shrink-0 rounded px-2 py-1 ' +
          (!active
            ? 'bg-zinc-800 text-zinc-100'
            : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200')
        }
        title="The project's primary sample (renames, highlights, and the report live here)"
      >
        {primaryLabel}
      </button>
      {samples.map((s) => {
        const ready = s.status === 'READY'
        return (
          <span key={s.id} className="flex shrink-0 items-center">
            <button
              disabled={!ready}
              onClick={() => pick(s.id)}
              className={
                'rounded px-2 py-1 ' +
                (active === s.id
                  ? 'bg-zinc-800 text-zinc-100'
                  : ready
                    ? 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                    : 'cursor-not-allowed text-zinc-600')
              }
              title={
                ready
                  ? `${s.originalFilename ?? s.label} · ${s.arch ?? 'arch unknown'} · sha256 ${s.sha256.slice(0, 12)}`
                  : `Sample is ${s.status}${s.errorMessage ? ` — ${s.errorMessage}` : ''}`
              }
            >
              {s.label}
              {!ready && ' ⏳'}
            </button>
            {managing && (
              <>
                <button
                  onClick={() => { void renameSample(s) }}
                  title="Rename this sample's label"
                  className="rounded px-1 py-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                >
                  ✎
                </button>
                <button
                  onClick={() => { void deleteSample(s) }}
                  title="Remove this sample (deletes its stored analysis)"
                  className="rounded px-1 py-1 text-red-400/70 hover:bg-red-950/40 hover:text-red-300"
                >
                  ✕
                </button>
              </>
            )}
          </span>
        )
      })}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent(ADD_SAMPLE_EVENT))}
          className="rounded border border-amber-700/60 bg-amber-950/30 px-2 py-0.5 text-[11px] text-amber-200 hover:bg-amber-900/40"
          title="Move an existing project in as a sample, or decompile a new binary via the CLI"
        >
          ＋ Add
        </button>
        <button
          onClick={() => setManaging((m) => !m)}
          className={
            'rounded border px-2 py-0.5 text-[11px] ' +
            (managing
              ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
              : 'border-zinc-700 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200')
          }
          title="Rename or remove samples"
        >
          ⚙ {managing ? 'done' : 'manage'}
        </button>
      </span>
    </div>
  )
}
