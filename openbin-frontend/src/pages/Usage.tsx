import { useCallback, useEffect, useState } from 'react'
import { ApiError, useApi } from '@shared/api/client'

type UsageSummary = {
  todayTokens: number
  monthTokens: number
  dailyCap: number | null
  monthlyCap: number | null
  dailyResetsAt: string
  monthlyResetsAt: string
  totalCalls: number
  totalTokens: number
}

type AuditEntry = {
  id: string
  projectId: string | null
  provider: string
  model: string
  purpose: string
  inputTokens: number
  outputTokens: number
  success: boolean
  errorMessage: string | null
  createdAt: string
}

type AuditPage = {
  content: AuditEntry[]
  totalElements: number
  totalPages: number
  number: number
  size: number
}

const PAGE_SIZE = 50

export function Usage() {
  const api = useApi()
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [audit, setAudit] = useState<AuditPage | null>(null)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [s, a] = await Promise.all([
        api<UsageSummary>('/api/usage/summary'),
        api<AuditPage>(`/api/usage/audit?page=${page}&size=${PAGE_SIZE}`),
      ])
      setSummary(s)
      setAudit(a)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [api, page])

  useEffect(() => { void refresh() }, [refresh])

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">Usage</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Token spend across all your LLM calls. Caps are enforced server-side — leave blank
          for unlimited.
        </p>
      </div>

      {error && (
        <div className="rounded border border-red-900/60 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && !summary ? (
        <p className="text-zinc-500">Loading…</p>
      ) : summary ? (
        <>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <UsageCard
              label="Today"
              used={summary.todayTokens}
              cap={summary.dailyCap}
              resetsAt={summary.dailyResetsAt}
            />
            <UsageCard
              label="This month"
              used={summary.monthTokens}
              cap={summary.monthlyCap}
              resetsAt={summary.monthlyResetsAt}
            />
          </section>

          <LimitsForm summary={summary} onSaved={setSummary} />

          <section>
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
                Audit log
              </h2>
              <p className="text-xs text-zinc-500">
                {summary.totalCalls.toLocaleString()} total calls · {summary.totalTokens.toLocaleString()} total tokens
              </p>
            </div>
            <AuditTable audit={audit} />
            {audit && audit.totalPages > 1 && (
              <div className="mt-3 flex items-center justify-between text-xs text-zinc-400">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="rounded border border-zinc-700 px-3 py-1 hover:bg-zinc-800 disabled:opacity-30"
                >
                  ← Prev
                </button>
                <span>
                  Page {audit.number + 1} of {audit.totalPages}
                </span>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= audit.totalPages - 1}
                  className="rounded border border-zinc-700 px-3 py-1 hover:bg-zinc-800 disabled:opacity-30"
                >
                  Next →
                </button>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}

function UsageCard({ label, used, cap, resetsAt }: { label: string; used: number; cap: number | null; resetsAt: string }) {
  const pct = cap && cap > 0 ? Math.min(100, (used / cap) * 100) : null
  const barColor = pct == null
    ? 'bg-zinc-700'
    : pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">{label}</span>
        <span className="text-[11px] text-zinc-500">
          resets {new Date(resetsAt).toLocaleString()}
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-zinc-100">
        {used.toLocaleString()}
        <span className="text-sm font-normal text-zinc-500">
          {cap == null ? ' tokens · unlimited' : ` / ${cap.toLocaleString()} tokens`}
        </span>
      </p>
      {pct != null && (
        <div className="mt-3 h-2 w-full overflow-hidden rounded bg-zinc-800">
          <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

function LimitsForm({ summary, onSaved }: { summary: UsageSummary; onSaved: (s: UsageSummary) => void }) {
  const api = useApi()
  const [daily, setDaily] = useState<string>(summary.dailyCap?.toString() ?? '')
  const [monthly, setMonthly] = useState<string>(summary.monthlyCap?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const body = {
        dailyTokenCap: daily.trim() === '' ? null : Number(daily),
        monthlyTokenCap: monthly.trim() === '' ? null : Number(monthly),
      }
      if (body.dailyTokenCap != null && (!Number.isFinite(body.dailyTokenCap) || body.dailyTokenCap < 0)) {
        throw new Error('Daily cap must be a non-negative number or blank')
      }
      if (body.monthlyTokenCap != null && (!Number.isFinite(body.monthlyTokenCap) || body.monthlyTokenCap < 0)) {
        throw new Error('Monthly cap must be a non-negative number or blank')
      }
      const updated = await api<UsageSummary>('/api/usage/limits', { method: 'PUT', body: JSON.stringify(body) })
      onSaved(updated)
      setSavedAt(new Date().toLocaleTimeString())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
        Token caps
      </h2>
      <p className="mt-1 text-xs text-zinc-500">
        Combined input + output. Leave blank for no limit. 0 means no calls allowed (useful to pause yourself).
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block text-xs text-zinc-400">
          Daily cap
          <input
            type="number"
            min={0}
            value={daily}
            onChange={e => setDaily(e.target.value)}
            placeholder="unlimited"
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
          />
        </label>
        <label className="block text-xs text-zinc-400">
          Monthly cap
          <input
            type="number"
            min={0}
            value={monthly}
            onChange={e => setMonthly(e.target.value)}
            placeholder="unlimited"
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
          />
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-purple-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save caps'}
        </button>
        {savedAt && <span className="text-xs text-zinc-500">Saved {savedAt}</span>}
      </div>
    </section>
  )
}

function AuditTable({ audit }: { audit: AuditPage | null }) {
  if (!audit) return <p className="text-zinc-500 text-sm">Loading…</p>
  if (audit.content.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
        No LLM calls yet.
      </div>
    )
  }
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-800">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-zinc-900 text-zinc-400">
          <tr>
            <th className="px-3 py-2">When</th>
            <th className="px-3 py-2">Purpose</th>
            <th className="px-3 py-2">Provider · Model</th>
            <th className="px-3 py-2 text-right">In</th>
            <th className="px-3 py-2 text-right">Out</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800 bg-zinc-950/40 text-zinc-200">
          {audit.content.map(e => (
            <tr key={e.id}>
              <td className="whitespace-nowrap px-3 py-2 text-zinc-400">
                {new Date(e.createdAt).toLocaleString()}
              </td>
              <td className="px-3 py-2 font-mono text-zinc-300">{e.purpose}</td>
              <td className="px-3 py-2 text-zinc-300">
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                  {e.provider.toLowerCase()}
                </span>{' '}
                <span className="font-mono text-[11px] text-zinc-400">{e.model}</span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{e.inputTokens.toLocaleString()}</td>
              <td className="px-3 py-2 text-right tabular-nums">{e.outputTokens.toLocaleString()}</td>
              <td className="px-3 py-2">
                {e.success ? (
                  <span className="text-emerald-400">ok</span>
                ) : (
                  <span className="text-red-400" title={e.errorMessage ?? ''}>
                    failed
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
