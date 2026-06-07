import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApi } from '@shared/api/client'
import { SCRIPT_PATHS, type ScriptFindingsResponse } from '@shared/api/scripts'
import { ScriptFindings } from '../components/ScriptFindings'
import { ReportEditor } from './Report'

/**
 * SCRIPT-kind ProjectView. Shows the static-analysis findings on the left
 * and the existing Report editor on the right — same layout intuition as
 * the BIN view, minus the source tree / pseudocode / disasm machinery
 * which doesn't apply to a tarball.
 *
 * Routed via {@link ProjectViewRoute}; this component never loads by URL
 * directly because it depends on the parent already knowing project.kind.
 */
export function ScriptProjectView() {
  const { id = '' } = useParams<{ id: string }>()
  const api = useApi()
  const [findings, setFindings] = useState<ScriptFindingsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await api<ScriptFindingsResponse>(SCRIPT_PATHS.findings(id))
        if (!cancelled) setFindings(data)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [api, id])

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col gap-4 px-6 py-6">
      <header className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-3">
          <Link to="/projects" className="text-sm text-zinc-400 hover:text-zinc-100">
            ← Projects
          </Link>
          <h1 className="text-lg font-semibold text-zinc-100">Script analysis</h1>
        </div>
      </header>

      {loading && <p className="text-sm text-zinc-500">Loading findings…</p>}
      {error && (
        <div className="rounded border border-red-900/60 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {findings && (
        <div className="grid flex-1 gap-4 lg:grid-cols-2">
          <div className="min-h-0 overflow-auto pr-2">
            <ScriptFindings data={findings} />
          </div>
          <div className="min-h-0 overflow-auto rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
            <ReportEditor projectId={id} compact />
          </div>
        </div>
      )}
    </div>
  )
}
