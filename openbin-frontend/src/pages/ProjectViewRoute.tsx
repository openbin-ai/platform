import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useApi } from '@shared/api/client'
import { ProjectView } from './ProjectView'
import { ScriptProjectView } from './ScriptProjectView'

type ProjectKindOnly = { kind: 'APK' | 'BIN' | 'SCRIPT' }

/**
 * Top-level dispatch for {@code /projects/:id}. Loads the project's kind
 * once, then renders the kind-specific page. The legacy {@link ProjectView}
 * (binary RE workspace) is heavy and has its own internal data fetch, so
 * it stays as-is — we just gate entry to it.
 *
 * Why a separate dispatcher: a kind branch inside {@link ProjectView}
 * itself would have to live above ~140 hook calls (Rules of Hooks forbids
 * conditional early return after hooks), so the dispatcher pattern is
 * structurally cleaner than refactoring all of ProjectView.
 */
export function ProjectViewRoute() {
  const { id = '' } = useParams<{ id: string }>()
  const api = useApi()
  const [kind, setKind] = useState<'APK' | 'BIN' | 'SCRIPT' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const p = await api<ProjectKindOnly>(`/api/projects/${id}`)
        if (!cancelled) setKind(p.kind)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    })()
    return () => { cancelled = true }
  }, [api, id])

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="rounded border border-red-900/60 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      </div>
    )
  }
  if (kind === null) {
    return <div className="px-6 py-8 text-sm text-zinc-500">Loading project…</div>
  }
  if (kind === 'SCRIPT') return <ScriptProjectView />
  return <ProjectView />
}
