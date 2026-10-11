import { useEffect, useState } from 'react'
import { useApi } from '@shared/api/client'

// What BINNY light did during one answer: each tool call and its outcome,
// kept on the assistant turn so the transcript shows the work, not just the
// conclusion. Artifacts link to where the thing landed.

export type ToolEvent = {
  id: string
  name: string
  input: Record<string, unknown>
  ok?: boolean
  summary?: string
  artifact?: { kind: 'highlight' | 'report_section' | 'script'; id: string; label: string }
}

const LABEL: Record<string, string> = {
  get_function: 'Read function',
  find_functions: 'Searched functions',
  list_strings: 'Searched strings',
  read_file: 'Read file',
  search_code: 'Searched code',
  create_highlight: 'Pinned highlight',
  write_report_section: 'Wrote report section',
  save_script: 'Saved script',
}

function inputHint(e: ToolEvent): string {
  const i = e.input
  const v = i.name ?? i.path ?? i.query ?? i.target ?? i.section_id
  return typeof v === 'string' ? v : ''
}

export function BinnyToolCards({ events, projectId, onOpenPanel }: {
  events: ToolEvent[]
  projectId: string
  /** Host panel switcher: 'highlights' or 'report'. Optional (script view has neither). */
  onOpenPanel?: (panel: 'highlights' | 'report') => void
}) {
  const [script, setScript] = useState<string | null>(null)
  if (events.length === 0) return null
  return (
    <ul className="mb-2 space-y-1">
      {events.map((e) => {
        const pending = e.ok === undefined
        const label = LABEL[e.name] ?? e.name
        const hint = inputHint(e)
        return (
          <li key={e.id} className="flex items-start gap-2 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-[11px]">
            <span className={`mt-0.5 shrink-0 ${pending ? 'text-zinc-500' : e.ok ? 'text-emerald-300' : 'text-red-300'}`} aria-hidden>
              {pending ? '…' : e.ok ? '✓' : '✕'}
            </span>
            <div className="min-w-0 flex-1">
              <span className="text-zinc-200">{label}</span>
              {hint && <span className="ml-1 truncate font-mono text-zinc-400">{hint}</span>}
              {e.summary && !pending && <span className="ml-1 text-zinc-500">· {e.summary}</span>}
            </div>
            {e.artifact?.kind === 'highlight' && onOpenPanel && (
              <button onClick={() => onOpenPanel('highlights')} className="shrink-0 text-amber-300 hover:underline">Highlights</button>
            )}
            {e.artifact?.kind === 'report_section' && onOpenPanel && (
              <button onClick={() => onOpenPanel('report')} className="shrink-0 text-amber-300 hover:underline">Report</button>
            )}
            {e.artifact?.kind === 'script' && (
              <button onClick={() => setScript(e.artifact!.id)} className="shrink-0 text-amber-300 hover:underline">View</button>
            )}
          </li>
        )
      })}
      {script && <ScriptViewer projectId={projectId} scriptId={script} onClose={() => setScript(null)} />}
    </ul>
  )
}

type Script = { id: string; name: string; language: string; description: string | null; content: string; createdAt: string }

/** Read-only view of a saved script with copy and download. Nothing runs. */
export function ScriptViewer({ projectId, scriptId, onClose }: { projectId: string; scriptId: string; onClose: () => void }) {
  const api = useApi()
  const [s, setS] = useState<Script | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api<Script>(`/api/projects/${projectId}/scripts/${scriptId}`)
      .then((r) => { if (!cancelled) setS(r) })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'failed to load') })
    return () => { cancelled = true }
  }, [api, projectId, scriptId])

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  function download() {
    if (!s) return
    const blob = new Blob([s.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = s.name
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-zinc-800 bg-zinc-950" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
          <span className="truncate font-mono text-sm text-zinc-100">{s?.name ?? 'Script'}</span>
          {s && <span className="text-xs text-zinc-500">{s.language}</span>}
          <span className="ml-auto flex items-center gap-2">
            {s && (
              <>
                <button onClick={() => void navigator.clipboard?.writeText(s.content)} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800">Copy</button>
                <button onClick={download} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800">Download</button>
              </>
            )}
            <button onClick={onClose} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800">Close</button>
          </span>
        </div>
        {s?.description && <p className="border-b border-zinc-800 px-4 py-2 text-xs text-zinc-400">{s.description}</p>}
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {err && <p className="text-xs text-red-400">{err}</p>}
          {!s && !err && <p className="text-xs text-zinc-500">Loading…</p>}
          {s && <pre className="whitespace-pre font-mono text-[12px] leading-relaxed text-zinc-200">{s.content}</pre>}
        </div>
        <p className="border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
          Saved on this project. Review it before running it anywhere.
        </p>
      </div>
    </div>
  )
}
