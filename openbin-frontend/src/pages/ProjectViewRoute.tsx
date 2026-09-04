import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useApi } from '@shared/api/client'
import { ProjectView } from './ProjectView'
import { ScriptProjectView } from './ScriptProjectView'
import { BundleTabBar } from '../components/BundleTabBar'
import { SampleTabBar } from '../components/SampleTabBar'

type ProjectDispatch = { kind: 'APK' | 'BIN' | 'SCRIPT'; bundleId: string | null; name: string }

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
  const [bundleId, setBundleId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Reset bundle state on id change so navigating between siblings doesn't
    // briefly show the previous project's tab bar.
    setBundleId(null)
    void (async () => {
      try {
        const p = await api<ProjectDispatch>(`/api/projects/${id}`)
        if (!cancelled) {
          setKind(p.kind)
          setBundleId(p.bundleId)
          setName(p.name)
        }
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
  // BIN projects that belong to a bundle get the sibling tab strip above the
  // workspace; standalone projects render unchanged (bundleId null → no bar).
  return (
    <div className="flex h-full min-h-0 flex-col">
      {kind === 'BIN' && bundleId && (
        <BundleTabBar bundleId={bundleId} currentProjectId={id} />
      )}
      {kind === 'BIN' && (
        // Multi-sample projects: renders only when the project actually has
        // attached samples (self-hides otherwise, like BundleTabBar).
        <SampleTabBar projectId={id} primaryLabel={name || 'primary'} />
      )}
      <div className="min-h-0 flex-1">
        <ProjectView />
      </div>
    </div>
  )
}
