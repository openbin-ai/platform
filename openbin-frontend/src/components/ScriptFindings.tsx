import { useMemo, useState } from 'react'
import type { ScriptFinding, ScriptFindingsResponse, Severity } from '@shared/api/scripts'
import { SEVERITY_ORDER } from '@shared/api/scripts'

const SEVERITY_STYLES: Record<Severity, { pill: string; border: string; dot: string }> = {
  CRITICAL: {
    pill: 'bg-red-950/60 text-red-200 border-red-800/60',
    border: 'border-red-900/50',
    dot: 'bg-red-400',
  },
  HIGH: {
    pill: 'bg-amber-950/60 text-amber-200 border-amber-800/60',
    border: 'border-amber-900/50',
    dot: 'bg-amber-400',
  },
  MEDIUM: {
    pill: 'bg-yellow-950/60 text-yellow-200 border-yellow-800/60',
    border: 'border-yellow-900/50',
    dot: 'bg-yellow-400',
  },
  INFO: {
    pill: 'bg-zinc-800/70 text-zinc-300 border-zinc-700',
    border: 'border-zinc-800',
    dot: 'bg-zinc-400',
  },
}

export function ScriptFindings({
  data,
  onJump,
}: {
  data: ScriptFindingsResponse
  /** Optional callback fired when a finding row is clicked. The parent can
   * use this to scroll a code viewer to the finding's file:line. */
  onJump?: (f: ScriptFinding) => void
}) {
  const grouped = useMemo(() => {
    const out: Record<Severity, ScriptFinding[]> = {
      CRITICAL: [], HIGH: [], MEDIUM: [], INFO: [],
    }
    for (const f of data.findings) {
      out[f.severity]?.push(f)
    }
    return out
  }, [data.findings])

  const pkg = data.summary?.package
  const counts = data.summary?.countsBySeverity || {}

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-mono text-sm text-zinc-100">
            {pkg?.name ? `${pkg.name}${pkg.version ? `@${pkg.version}` : ''}` : 'unnamed package'}
          </h2>
          <span className="text-xs text-zinc-500">
            {data.summary?.fileCount ?? 0} files · analyzed in {((data.durationMs || 0) / 1000).toFixed(1)}s
          </span>
        </div>
        {pkg?.description && (
          <p className="mt-1 text-xs text-zinc-400">{pkg.description}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {SEVERITY_ORDER.map((s) => {
            const n = counts[s] ?? 0
            if (n === 0) return null
            return (
              <span
                key={s}
                className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs ${SEVERITY_STYLES[s].pill}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_STYLES[s].dot}`} />
                {s} {n}
              </span>
            )
          })}
          {pkg?.hasInstallHook && (
            <span className="inline-flex items-center gap-1.5 rounded border border-amber-800/60 bg-amber-950/60 px-2 py-0.5 text-xs text-amber-200">
              ⚑ postinstall hook
            </span>
          )}
          {data.summary?.deobfuscatedFileCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded border border-purple-800/60 bg-purple-950/60 px-2 py-0.5 text-xs text-purple-200">
              ⚙ {data.summary.deobfuscatedFileCount} deobfuscated
            </span>
          )}
        </div>
      </div>

      {data.findings.length === 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-400">
          No findings — the analyzer didn't flag any of the eight rule categories.
        </div>
      )}

      {SEVERITY_ORDER.map((s) => {
        const list = grouped[s]
        if (!list || list.length === 0) return null
        return (
          <SeverityGroup key={s} severity={s} findings={list} onJump={onJump} />
        )
      })}
    </div>
  )
}

function SeverityGroup({
  severity,
  findings,
  onJump,
}: {
  severity: Severity
  findings: ScriptFinding[]
  onJump?: (f: ScriptFinding) => void
}) {
  const [open, setOpen] = useState(severity === 'CRITICAL' || severity === 'HIGH')
  const style = SEVERITY_STYLES[severity]
  return (
    <div className={`rounded-lg border bg-zinc-900/40 ${style.border}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-zinc-900/60"
      >
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${style.dot}`} />
          <span className="text-sm font-semibold text-zinc-100">{severity}</span>
          <span className="text-xs text-zinc-500">{findings.length} finding{findings.length === 1 ? '' : 's'}</span>
        </span>
        <span className="text-xs text-zinc-500" aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul className="divide-y divide-zinc-800 border-t border-zinc-800">
          {findings.map((f) => <FindingRow key={f.id} f={f} onJump={onJump} />)}
        </ul>
      )}
    </div>
  )
}

function FindingRow({ f, onJump }: { f: ScriptFinding; onJump?: (f: ScriptFinding) => void }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <li className="px-4 py-3">
      <div className="flex w-full flex-col gap-1 text-left">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-xs text-purple-300">{f.rule}</span>
          {onJump && f.line > 0 ? (
            <button
              type="button"
              onClick={() => onJump(f)}
              className="font-mono text-[11px] text-zinc-400 underline-offset-2 hover:text-purple-300 hover:underline"
              title="Jump to this line in the source viewer"
            >
              {f.file}:{f.line}
            </button>
          ) : (
            <span className="font-mono text-[11px] text-zinc-500">
              {f.file}{f.line > 0 ? `:${f.line}` : ''}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-left text-sm text-zinc-200 hover:text-zinc-100"
        >
          {f.message}
        </button>
        {f.snippet && (
          <pre className="overflow-x-auto rounded border border-zinc-800 bg-black/40 px-2 py-1 font-mono text-[11px] text-zinc-300">
            {f.snippet}
          </pre>
        )}
      </div>
      {expanded && (
        <div className="mt-2 space-y-2 border-t border-zinc-800 pt-2 text-xs text-zinc-400">
          {f.remediation && (
            <div>
              <span className="font-semibold text-zinc-300">What to do: </span>
              {f.remediation}
            </div>
          )}
          {Object.keys(f.evidence || {}).length > 0 && (
            <div>
              <span className="font-semibold text-zinc-300">Evidence: </span>
              <code className="font-mono text-[11px] text-zinc-400">
                {JSON.stringify(f.evidence)}
              </code>
            </div>
          )}
          {f.deobfuscated && (
            <div className="text-purple-300">
              ⚙ Source was deobfuscated before this rule ran
            </div>
          )}
        </div>
      )}
    </li>
  )
}
