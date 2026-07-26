import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApi } from '@shared/api/client'
import type { BundleDetail } from '../api/bundles'

/**
 * Thin sibling-nav strip shown at the top of a ProjectView when the project is
 * a member of a bundle. One tab per sibling binary (current one highlighted);
 * a 🗂 affordance jumps back to the bundle overview. Only mounted when
 * bundleId is set, so standalone projects are visually unchanged.
 *
 * Overflow is handled by horizontal scroll — a sample with many ABIs stays on
 * one line and scrolls rather than wrapping into the workspace below.
 */
export function BundleTabBar({
  bundleId,
  currentProjectId,
}: {
  bundleId: string
  currentProjectId: string
}) {
  const api = useApi()
  const navigate = useNavigate()
  const [bundle, setBundle] = useState<BundleDetail | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const b = await api<BundleDetail>(`/api/bundles/${bundleId}`)
        if (!cancelled) setBundle(b)
      } catch {
        // Best-effort: if the bundle can't be loaded, render nothing rather
        // than block the project view.
      }
    })()
    return () => { cancelled = true }
  }, [api, bundleId])

  if (!bundle || bundle.files.length <= 1) return null

  return (
    <div className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-950/60 px-3 py-1.5">
      <Link
        to={`/bundles/${bundleId}`}
        title={`Bundle: ${bundle.name}`}
        className="mr-1 flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      >
        <span aria-hidden>🗂</span>
        <span className="max-w-[10rem] truncate">{bundle.name}</span>
      </Link>
      <div className="h-4 w-px shrink-0 bg-zinc-800" />
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {bundle.files.map((f) => {
          const active = f.id === currentProjectId
          const ready = f.status === 'READY'
          return (
            <button
              key={f.id}
              onClick={() => { if (!active && ready) navigate(`/projects/${f.id}`) }}
              disabled={!ready && !active}
              title={`${f.name}${f.arch ? ` · ${f.arch}` : ''}`}
              className={`shrink-0 truncate rounded px-2.5 py-1 text-xs transition-colors ${
                active
                  ? 'bg-amber-500/15 font-medium text-amber-200'
                  : ready
                    ? 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                    : 'cursor-default text-zinc-600'
              }`}
            >
              {f.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
