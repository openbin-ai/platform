import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../api/client'

type MethodRef = {
  className: string
  name: string
  signature: string
  file: string
  line: number
}

type ChildrenStats = {
  shown: number
  totalCandidates: number
  sdkCandidatesHidden: number
}

type CallChainNode = {
  method: MethodRef
  snippet: string
  narration: string
  children: CallChainNode[]
  childrenStats: ChildrenStats
}

type CallChain = {
  root: MethodRef
  rootBody: string
  rootNarration: string
  callers: CallChainNode[]
  callees: CallChainNode[]
  callersStats: ChildrenStats
  calleesStats: ChildrenStats
}

type ReportSection = { id: string; title: string; content: string }
type ReportResponse = { title: string; sections: ReportSection[] }

export type CallChainStart = { file: string; line: number; nonce: number }

const DEFAULT_DEPTH = 3

/**
 * Right-panel tab for the call-chain workflow.
 *
 * - Receives a {@link CallChainStart} prop from the parent (set when the user
 *   clicks "Build call chain" in the Symbols panel). The {@code nonce} field
 *   lets the parent re-trigger a build for the same file:line by bumping it.
 * - Walks upward (callers) and downward (callees) from the seed method, with
 *   bounded depth. Live-grepped against the cached symbol index.
 * - Narration is opt-in: one LLM call summarises every method in the chain.
 * - Add to report: appends a new Markdown section to the project's report.
 *   Reuses the existing PUT /report endpoint.
 */
export function CallChain({
  projectId,
  start,
  credentialId,
  model,
  onOpenFile,
}: {
  projectId: string
  start: CallChainStart | null
  credentialId: string | null
  model: string
  onOpenFile: (file: string, line: number) => void
}) {
  const api = useApi()
  const [chain, setChain] = useState<CallChain | null>(null)
  const [depth, setDepth] = useState(DEFAULT_DEPTH)
  const [includeSdks, setIncludeSdks] = useState(false)
  const [busy, setBusy] = useState<'build' | 'narrate' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedHint, setSavedHint] = useState<string | null>(null)

  const build = useCallback(async (file: string, line: number) => {
    setBusy('build')
    setError(null)
    setSavedHint(null)
    try {
      const r = await api<CallChain>(`/api/projects/${projectId}/callchains/build`, {
        method: 'POST',
        body: JSON.stringify({ file, line, depth, includeSdks }),
      })
      setChain(r)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }, [api, projectId, depth, includeSdks])

  // Auto-build whenever the parent pushes a new start (or bumps the nonce).
  useEffect(() => {
    if (start) void build(start.file, start.line)
  }, [start, build])

  async function narrate() {
    if (!chain) return
    if (!credentialId) {
      setError('Pick a credential in the panel header first.')
      return
    }
    setBusy('narrate')
    setError(null)
    try {
      const r = await api<CallChain>(`/api/projects/${projectId}/callchains/narrate`, {
        method: 'POST',
        body: JSON.stringify({ chain, credentialId, model: model || undefined }),
      })
      setChain(r)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function addToReport() {
    if (!chain) return
    setBusy('save')
    setError(null)
    setSavedHint(null)
    try {
      const current = await api<ReportResponse>(`/api/projects/${projectId}/report`)
      const md = renderChainMarkdown(chain)
      const newSection: ReportSection = {
        id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `chain-${Date.now()}`,
        title: `Call chain: ${chain.root.className}.${chain.root.name}`,
        content: md,
      }
      await api<ReportResponse>(`/api/projects/${projectId}/report`, {
        method: 'PUT',
        body: JSON.stringify({ title: current.title, sections: [...current.sections, newSection] }),
      })
      setSavedHint('Added a new section to the report.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!start && !chain) {
    return (
      <div className="space-y-2 p-3 text-xs text-zinc-500">
        <p>
          Open the <strong className="text-zinc-300">Symbols</strong> sidebar (Cmd/Ctrl-click an
          identifier or right-click for usages), then click <strong className="text-zinc-300">▶ Build call chain</strong> on
          a method definition to start.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Call chain</h3>
        <div className="flex items-center gap-2 text-[10px] text-zinc-400">
          <label className="flex items-center gap-1" title="How many levels in each direction">
            depth
            <input
              type="number"
              min={1}
              max={5}
              value={depth}
              onChange={e => setDepth(Math.min(5, Math.max(1, Number(e.target.value) || 1)))}
              className="w-10 rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-[10px] text-zinc-200"
            />
          </label>
          <label className="flex items-center gap-1" title="Include matches in androidx, kotlin, com.google.* etc.">
            <input type="checkbox" className="h-3 w-3" checked={includeSdks} onChange={e => setIncludeSdks(e.target.checked)} />
            SDKs
          </label>
          <button
            onClick={() => start && void build(start.file, start.line)}
            disabled={!start || busy !== null}
            title="Rebuild with current depth + SDKs settings"
            className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
          >
            {busy === 'build' ? '…' : '↻'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">{error}</div>
      )}
      {savedHint && (
        <div className="rounded border border-emerald-900/60 bg-emerald-950/40 px-2 py-1 text-[11px] text-emerald-300">{savedHint}</div>
      )}

      {chain && (
        <>
          <div className="rounded border border-purple-500/40 bg-zinc-950/60 p-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[9px] uppercase text-purple-300">ROOT</span>
              <button
                onClick={() => onOpenFile(chain.root.file, chain.root.line)}
                className="truncate text-left font-mono text-xs text-zinc-200 hover:underline"
                title={`${chain.root.file}:${chain.root.line}`}
              >
                {chain.root.className}.<span className="text-purple-300">{chain.root.name}</span>
                <span className="text-zinc-500">{chain.root.signature}</span>
              </button>
            </div>
            {chain.rootNarration && (
              <p className="mt-1 text-[11px] italic text-zinc-300">{chain.rootNarration}</p>
            )}
            {chain.rootBody && (
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-black/40 p-1 font-mono text-[10px] leading-4 text-zinc-300">
                {chain.rootBody}
              </pre>
            )}
          </div>

          <ChainSection title={`Callers (${countNodes(chain.callers)})`} hint="Who invokes this method" nodes={chain.callers} stats={chain.callersStats} onOpenFile={onOpenFile} />
          <ChainSection title={`Callees (${countNodes(chain.callees)})`} hint="What this method invokes" nodes={chain.callees} stats={chain.calleesStats} onOpenFile={onOpenFile} />

          <div className="flex items-center gap-2">
            <button
              onClick={() => void narrate()}
              disabled={busy !== null || !credentialId}
              title={!credentialId ? 'Pick a credential first' : 'Send the chain to the LLM for per-step narration'}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
            >
              {busy === 'narrate' ? '… narrating' : '✨ Narrate with AI'}
            </button>
            <button
              onClick={() => void addToReport()}
              disabled={busy !== null}
              title="Append a new section to the project report with this chain"
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
            >
              {busy === 'save' ? '… saving' : '＋ Add to report'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function ChainSection({
  title, hint, nodes, stats, onOpenFile,
}: {
  title: string
  hint: string
  nodes: CallChainNode[]
  stats: ChildrenStats
  onOpenFile: (f: string, l: number) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <h4 className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">{title}</h4>
        <span className="text-[10px] text-zinc-600">{hint}</span>
      </div>
      <TruncationHint stats={stats} />
      {nodes.length === 0 ? (
        <p className="text-[11px] text-zinc-500">None at this depth.</p>
      ) : (
        <ul className="space-y-1">
          {nodes.map(n => <NodeView key={`${n.method.file}:${n.method.line}`} node={n} depth={0} onOpenFile={onOpenFile} />)}
        </ul>
      )}
    </div>
  )
}

/**
 * "8 of 30,000 shown · 29,992 SDK hidden" — the honest signal that the call
 * walker had to make a choice. Renders nothing when there's no truncation
 * AND no SDK callers got dropped.
 */
function TruncationHint({ stats }: { stats: ChildrenStats | undefined }) {
  if (!stats) return null
  const truncated = stats.shown < stats.totalCandidates
  const sdkHidden = stats.sdkCandidatesHidden > 0
  if (!truncated && !sdkHidden) return null
  return (
    <p
      className="text-[10px] text-amber-400/80"
      title={
        truncated
          ? `Showing ${stats.shown} of ${stats.totalCandidates} candidates. The walker capped fan-out to avoid noise on hot methods.`
          : `${stats.sdkCandidatesHidden} SDK / framework callers hidden in favor of project code.`
      }
    >
      {truncated && (
        <>showing <span className="font-mono">{stats.shown.toLocaleString()}</span> of{' '}
        <span className="font-mono">{stats.totalCandidates.toLocaleString()}</span></>
      )}
      {truncated && sdkHidden && ' · '}
      {sdkHidden && (
        <><span className="font-mono">{stats.sdkCandidatesHidden.toLocaleString()}</span> SDK hidden</>
      )}
    </p>
  )
}

function NodeView({
  node, depth, onOpenFile,
}: {
  node: CallChainNode
  depth: number
  onOpenFile: (f: string, l: number) => void
}) {
  const [open, setOpen] = useState(depth < 1)
  const hasChildren = node.children.length > 0
  return (
    <li className="rounded border-l border-zinc-800 pl-2" style={{ marginLeft: depth * 6 }}>
      <div className="flex items-baseline gap-1">
        {hasChildren ? (
          <button onClick={() => setOpen(o => !o)} className="w-3 text-zinc-500 hover:text-zinc-200">
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-3 text-zinc-700">·</span>
        )}
        <button
          onClick={() => onOpenFile(node.method.file, node.method.line)}
          className="truncate text-left font-mono text-[11px] text-zinc-200 hover:underline"
          title={`${node.method.file}:${node.method.line}`}
        >
          {node.method.className}.<span className="text-purple-300">{node.method.name}</span>
          <span className="text-zinc-500">{node.method.signature}</span>
        </button>
      </div>
      {node.snippet && (
        <pre className="ml-3 truncate font-mono text-[10px] text-zinc-500" title={node.snippet}>{node.snippet}</pre>
      )}
      {node.narration && (
        <p className="ml-3 text-[11px] italic text-zinc-300">{node.narration}</p>
      )}
      {open && hasChildren && (
        <>
          <div className="ml-3"><TruncationHint stats={node.childrenStats} /></div>
          <ul className="mt-1 space-y-1">
            {node.children.map(c => (
              <NodeView key={`${c.method.file}:${c.method.line}`} node={c} depth={depth + 1} onOpenFile={onOpenFile} />
            ))}
          </ul>
        </>
      )}
      {/* When the node is collapsed but truncation/SDK-hiding happened at
          this level, still surface the count so the user knows there's more
          here before they bother expanding. */}
      {!open && hasChildren && node.childrenStats &&
        (node.childrenStats.shown < node.childrenStats.totalCandidates ||
         node.childrenStats.sdkCandidatesHidden > 0) && (
        <div className="ml-3"><TruncationHint stats={node.childrenStats} /></div>
      )}
    </li>
  )
}

function countNodes(nodes: CallChainNode[]): number {
  let n = 0
  for (const node of nodes) {
    n++
    n += countNodes(node.children)
  }
  return n
}

function renderChainMarkdown(chain: CallChain): string {
  const lines: string[] = []
  lines.push(`**Root** — \`${chain.root.className}.${chain.root.name}${chain.root.signature}\` ([${chain.root.file}:${chain.root.line}](#))`)
  if (chain.rootNarration) lines.push('', `> ${chain.rootNarration}`)
  if (chain.rootBody) {
    lines.push('', '```java', chain.rootBody, '```')
  }
  if (chain.callers.length > 0) {
    lines.push('', '### Callers (who invokes this)', '')
    lines.push(...renderNodes(chain.callers, 0))
  }
  if (chain.callees.length > 0) {
    lines.push('', '### Callees (what this invokes)', '')
    lines.push(...renderNodes(chain.callees, 0))
  }
  return lines.join('\n')
}

function renderNodes(nodes: CallChainNode[], depth: number): string[] {
  const out: string[] = []
  const indent = '  '.repeat(depth)
  for (const n of nodes) {
    out.push(`${indent}- **\`${n.method.className}.${n.method.name}\`** — ${n.method.file}:${n.method.line}`)
    if (n.snippet) out.push(`${indent}  - \`${n.snippet}\``)
    if (n.narration) out.push(`${indent}  - _${n.narration}_`)
    if (n.children.length > 0) out.push(...renderNodes(n.children, depth + 1))
  }
  return out
}
