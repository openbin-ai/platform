import { useEffect, useMemo, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { useApi } from '@shared/api/client'

// Read-only code browser for the public project page (BIN projects).
//
// The backend endpoint (/api/public/projects/{id}/binary-analysis) requires
// an authenticated caller — any account, no project membership — so anonymous
// visitors get a sign-in teaser instead of the code. That's deliberate: the
// report + highlights sell the research, the code view is the sign-up hook,
// and Fork is one click away once you can see the code.
//
// Deliberately slim compared to ProjectView's IDE: function list + pseudo-C /
// disasm panes only. No renames, no AI tools, no xref navigation. Mirrored in
// openbin-frontend with amber accents (duplicated components — keep in sync).

type DisasmLine = { addr: string; text: string }
type PublicFunction = {
  name: string
  address: string
  size: number
  signature: string
  decompiled: string | null
  disassembly: DisasmLine[] | null
  external: boolean
  thunk: boolean
  body_skipped?: boolean
}
type PublicAnalysis = { functions: PublicFunction[] }

export function PublicCodeView({ projectId }: { projectId: string }) {
  const auth = useAuth()
  const api = useApi()
  const [analysis, setAnalysis] = useState<PublicAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<'pseudo' | 'disasm'>('pseudo')

  const signedIn = auth.isAuthenticated

  useEffect(() => {
    if (!signedIn) return
    let cancelled = false
    setError(null)
    api<PublicAnalysis>(`/api/public/projects/${projectId}/binary-analysis`)
      .then((a) => { if (!cancelled) setAnalysis(a) })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load code')
      })
    return () => { cancelled = true }
  }, [api, projectId, signedIn])

  // Real (non-import) functions first, by address; imports/thunks at the
  // bottom so the list leads with the code worth reading.
  const fns = useMemo(() => {
    if (!analysis) return []
    const needle = filter.trim().toLowerCase()
    return analysis.functions
      .filter((f) => !needle || f.name.toLowerCase().includes(needle))
      .sort((a, b) =>
        Number(a.external || a.thunk) - Number(b.external || b.thunk) ||
        a.address.localeCompare(b.address))
  }, [analysis, filter])

  const fn = useMemo(
    () => fns.find((f) => f.name === selected) ?? fns.find((f) => !f.external && !f.thunk) ?? fns[0] ?? null,
    [fns, selected],
  )

  if (!signedIn) {
    return (
      <div className="flex flex-col items-center gap-3 rounded border border-zinc-800 bg-zinc-900/40 px-6 py-10 text-center">
        <p className="text-sm text-zinc-300">
          The decompiled code for this project is available to signed-in users.
        </p>
        <p className="text-xs text-zinc-500">
          Free account — browse every function, then fork the project to annotate it yourself.
        </p>
        <button
          onClick={() => void auth.signinRedirect()}
          className="mt-1 rounded border border-purple-600 bg-purple-950/40 px-4 py-1.5 text-sm font-medium text-purple-200 hover:bg-purple-900/40"
        >
          Sign in to view the code
        </button>
      </div>
    )
  }

  if (error) {
    return <p className="rounded border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">Code failed to load: {error}</p>
  }
  if (!analysis) {
    return <p className="rounded border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-sm text-zinc-500">Loading code…</p>
  }

  return (
    <div className="grid h-[36rem] grid-cols-[16rem_1fr] overflow-hidden rounded border border-zinc-800 bg-zinc-950">
      {/* function list */}
      <div className="flex min-h-0 flex-col border-r border-zinc-800">
        <div className="border-b border-zinc-800 p-2">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${analysis.functions.length} functions…`}
            className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-purple-500 focus:outline-none"
          />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {fns.map((f) => (
            <li key={f.name}>
              <button
                onClick={() => setSelected(f.name)}
                className={`block w-full truncate px-3 py-1.5 text-left font-mono text-xs ${
                  fn?.name === f.name
                    ? 'bg-purple-950/40 text-purple-200'
                    : f.external || f.thunk
                      ? 'text-zinc-600 hover:bg-zinc-900'
                      : 'text-zinc-300 hover:bg-zinc-900'
                }`}
                title={f.signature}
              >
                {f.name}
              </button>
            </li>
          ))}
          {fns.length === 0 && (
            <li className="px-3 py-4 text-xs text-zinc-600">No functions match.</li>
          )}
        </ul>
      </div>

      {/* code pane */}
      <div className="flex min-h-0 flex-col">
        {fn ? (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-mono text-xs text-zinc-200" title={fn.signature}>{fn.signature || fn.name}</div>
                <div className="font-mono text-[10px] text-zinc-600">{fn.address} · {fn.size} bytes</div>
              </div>
              {fn.disassembly && fn.disassembly.length > 0 && (
                <div className="flex shrink-0 gap-1 text-[11px]">
                  {(['pseudo', 'disasm'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={`rounded px-2 py-0.5 ${
                        mode === m ? 'bg-purple-950/60 text-purple-200' : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {m === 'pseudo' ? 'Pseudo-C' : 'Disasm'}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <FunctionBody fn={fn} mode={mode} />
            </div>
          </>
        ) : (
          <p className="p-6 text-sm text-zinc-500">This analysis contains no functions.</p>
        )}
      </div>
    </div>
  )
}

function FunctionBody({ fn, mode }: { fn: PublicFunction; mode: 'pseudo' | 'disasm' }) {
  if (fn.external) return <EmptyBody label="External import — no body in this binary." />
  if (fn.thunk) return <EmptyBody label="Thunk — jumps straight to another function." />
  if (mode === 'disasm' && fn.disassembly && fn.disassembly.length > 0) {
    return (
      <pre className="font-mono text-xs leading-relaxed text-zinc-300">
        {fn.disassembly.map((l) => `${l.addr}  ${l.text}`).join('\n')}
      </pre>
    )
  }
  if (fn.decompiled && fn.decompiled.trim()) {
    return <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-200">{fn.decompiled}</pre>
  }
  if (fn.body_skipped) return <EmptyBody label="Metadata only — the decompile budget was spent before this function. Fork and re-decompile via the CLI to materialize it." />
  return <EmptyBody label="No decompiled body for this function." />
}

function EmptyBody({ label }: { label: string }) {
  return <p className="text-xs italic text-zinc-600">{label}</p>
}
