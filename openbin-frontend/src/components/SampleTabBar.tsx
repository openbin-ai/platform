import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApi } from '@shared/api/client'
import type { ProjectSample } from '../api/samples'

/**
 * Multi-sample projects: tab strip above the BIN workspace listing the
 * project's samples — the primary binary first, then every attached sample.
 * Switching writes/clears the {@code ?sample=} search param; ProjectView's
 * reload watches it and swaps the analysis source without a remount.
 *
 * Renders nothing when the project has no attached samples (the overwhelmingly
 * common case), mirroring BundleTabBar's self-hide.
 */
export function SampleTabBar({ projectId, primaryLabel }: { projectId: string; primaryLabel: string }) {
  const api = useApi()
  const [samples, setSamples] = useState<ProjectSample[]>([])
  const [searchParams, setSearchParams] = useSearchParams()
  const active = searchParams.get('sample')

  useEffect(() => {
    let cancelled = false
    setSamples([])
    void (async () => {
      try {
        const rows = await api<ProjectSample[]>(`/api/projects/${projectId}/samples`)
        if (!cancelled) setSamples(rows)
      } catch {
        // Non-fatal: an older backend without the endpoint just means no bar.
      }
    })()
    return () => { cancelled = true }
  }, [api, projectId])

  if (samples.length === 0) return null

  const pick = (sampleId: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (sampleId) next.set('sample', sampleId)
    else next.delete('sample')
    setSearchParams(next, { replace: true })
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
          <button
            key={s.id}
            disabled={!ready}
            onClick={() => pick(s.id)}
            className={
              'shrink-0 rounded px-2 py-1 ' +
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
        )
      })}
      <span className="ml-auto shrink-0 text-[10px] text-zinc-600">
        add samples: <code className="text-zinc-500">openbin tui</code> → “Add to an existing project”
      </span>
    </div>
  )
}
