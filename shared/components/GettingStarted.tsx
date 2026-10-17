import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { useApi } from '@shared/api/client'

/**
 * First-run checklist for the dashboard. Shows until every step is done or
 * the user dismisses it. Two steps are checked from the server (a saved API
 * key, a first project); the rest are ticked by the user and remembered in
 * localStorage, so the card never nags about something already done.
 *
 * Renders nothing while the two requests are in flight; a failed request
 * only loses the auto-check for that step.
 */
type LinkComponent = ComponentType<{ to: string; className?: string; children?: ReactNode; onClick?: () => void }>

type Props = {
  app: 'openbin' | 'openapk'
  Link: LinkComponent
  /** Solid button classes for the app's accent (amber or purple). */
  accentButton: string
}

type StepId = 'key' | 'cli' | 'project' | 'docs' | 'community'

type Step = {
  id: StepId
  title: string
  detail: ReactNode
  to: string
  action: string
  external?: boolean
}

export function GettingStarted({ app, Link, accentButton }: Props) {
  const api = useApi()
  const storageKey = `${app}.gettingStarted.v1`

  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [hasProject, setHasProject] = useState<boolean | null>(null)
  const [manual, setManual] = useState<Record<string, boolean>>(() => readManual(storageKey))
  const [dismissed, setDismissed] = useState<boolean>(() => readManual(storageKey).__dismissed === true)

  useEffect(() => {
    let cancelled = false
    api<unknown[]>('/api/credentials')
      .then((rows) => { if (!cancelled) setHasKey(rows.length > 0) })
      .catch(() => { if (!cancelled) setHasKey(false) })
    api<unknown[]>('/api/projects')
      .then((rows) => { if (!cancelled) setHasProject(rows.length > 0) })
      .catch(() => { if (!cancelled) setHasProject(false) })
    return () => { cancelled = true }
  }, [api])

  const steps = useMemo<Step[]>(() => {
    const thing = app === 'openapk' ? 'APK' : 'binary'
    const cmd = app === 'openapk' ? 'openbin apk ./app.apk' : 'openbin decompile ./sample.bin'
    return [
      {
        id: 'key',
        title: 'Add your model key',
        detail: 'BINNY runs on your own Anthropic, OpenAI, Bedrock or compatible key. Stored encrypted, used only for your calls.',
        to: '/settings/api-keys',
        action: 'Open API keys',
      },
      {
        id: 'cli',
        title: 'Install the CLI',
        detail: 'Decompiling runs on your machine. One command installs it; Docker must be running.',
        to: '/docs/cli/install',
        action: 'Install steps',
      },
      {
        id: 'project',
        title: `Decompile your first ${thing}`,
        detail: <>Run <code className="font-mono text-zinc-100">{cmd}</code> and open the URL it prints. That is your first project.</>,
        to: '/docs/start/first-project',
        action: 'How it works',
      },
      {
        id: 'docs',
        title: 'Learn the workspace',
        detail: 'Functions, strings, call graph, highlights, screenshots, BINNY. Ten minutes well spent.',
        to: '/docs/workspace/navigating-code',
        action: 'Read the guide',
      },
      {
        id: 'community',
        title: 'See what others published',
        detail: 'Reports from other researchers, forkable projects, and the weekly CTF.',
        to: '/community',
        action: 'Browse',
      },
    ]
  }, [app])

  if (dismissed) return null
  if (hasKey === null || hasProject === null) return null

  const done = (id: StepId) =>
    id === 'key' ? hasKey || manual[id] === true
    : id === 'project' ? hasProject || manual[id] === true
    : manual[id] === true
  const doneCount = steps.filter((s) => done(s.id)).length
  if (doneCount === steps.length) return null

  function mark(id: StepId, value: boolean) {
    const nextManual = { ...manual, [id]: value }
    setManual(nextManual)
    writeManual(storageKey, nextManual)
  }
  function dismiss() {
    setDismissed(true)
    writeManual(storageKey, { ...manual, __dismissed: true })
  }

  return (
    <section aria-labelledby="getting-started-title" className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="getting-started-title" className="text-lg font-semibold text-zinc-50">Getting started</h2>
          <p className="mt-1 text-sm text-zinc-400">
            {doneCount} of {steps.length} done. Each step takes a minute or two.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          Hide this
        </button>
      </div>

      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Setup progress">
        <div className="h-full rounded-full bg-amber-400 transition-[width]" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>

      <ol className="mt-5 divide-y divide-zinc-800/80">
        {steps.map((s, i) => {
          const isDone = done(s.id)
          const auto = (s.id === 'key' && hasKey) || (s.id === 'project' && hasProject)
          return (
            <li key={s.id} className="flex gap-4 py-3.5 first:pt-0 last:pb-0">
              <button
                type="button"
                onClick={() => { if (!auto) mark(s.id, !isDone) }}
                aria-pressed={isDone}
                aria-label={`${isDone ? 'Mark not done' : 'Mark done'}: ${s.title}`}
                disabled={!!auto}
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                  isDone
                    ? 'border-amber-400 bg-amber-400 text-black'
                    : 'border-zinc-600 text-zinc-400 hover:border-zinc-400'
                } ${auto ? 'cursor-default' : ''}`}
              >
                {isDone ? '✓' : i + 1}
              </button>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${isDone ? 'text-zinc-500 line-through decoration-zinc-600' : 'text-zinc-100'}`}>{s.title}</p>
                {!isDone && <p className="mt-0.5 text-sm text-zinc-400">{s.detail}</p>}
              </div>
              {!isDone && (
                <Link
                  to={s.to}
                  onClick={() => { if (s.id === 'docs' || s.id === 'community' || s.id === 'cli') mark(s.id, true) }}
                  className={`self-center whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${accentButton}`}
                >
                  {s.action}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function readManual(key: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

function writeManual(key: string, value: Record<string, boolean>) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode or blocked storage: the card simply shows again next time.
  }
}
