import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { useApi } from '../api/client'
import { Gravatar } from '@shared/components/Gravatar'
import type { CommunityReportSummary } from '@shared/api/community'
import iconUrl from '../assets/icon.png'
import type { Project } from './Projects'

// Post-login dashboard. Three live sections:
//   1. Recent projects — top 5 of /api/projects, sorted client-side
//      newest-first so a fresh upload appears immediately.
//   2. This month's usage — /api/usage/summary; links to full Usage page.
//   3. Community highlights — top 3 published APK reports for cross-promo.
// Each section degrades independently: if one endpoint is down the others
// still render. Loading states are inline skeleton lines, no spinner-of-doom.

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

const WORKFLOW_LABEL: Record<string, string> = {
  NEW: 'New',
  TRIAGING: 'Triaging',
  ANALYZING: 'Analyzing',
  DRAFTING_REPORT: 'Drafting',
  PUBLISHED: 'Published',
}

const WORKFLOW_PILL: Record<string, string> = {
  NEW: 'border-zinc-700 bg-zinc-900 text-zinc-300',
  TRIAGING: 'border-amber-700 bg-amber-950/40 text-amber-300',
  ANALYZING: 'border-blue-700 bg-blue-950/40 text-blue-300',
  DRAFTING_REPORT: 'border-purple-700 bg-purple-950/40 text-purple-300',
  PUBLISHED: 'border-emerald-700 bg-emerald-950/40 text-emerald-300',
}

export function Home() {
  const auth = useAuth()
  const displayName =
    (auth.user?.profile?.name as string | undefined) ??
    (auth.user?.profile?.preferred_username as string | undefined) ??
    (auth.user?.profile?.email as string | undefined) ??
    'researcher'
  const firstName = displayName.split(/[\s@]/)[0]

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-8">
      <BrandBanner firstName={firstName} />
      {/* Community is the platform's value prop, not a "see also" — promote it
          to a full-width hero immediately under the welcome banner. The
          smaller CommunityCard at the bottom of the grid that used to live
          here is gone; redundancy was hiding the signal. */}
      <CommunityHero />
      <RecentProjects />
      <UsageCard />
    </div>
  )
}

function BrandBanner({ firstName }: { firstName: string }) {
  return (
    <section className="relative overflow-hidden rounded-xl border border-purple-500/20 bg-gradient-to-br from-zinc-950 via-zinc-950 to-purple-950/20 p-6 sm:p-8">
      <div className="flex items-center gap-4">
        <img src={iconUrl} alt="" className="h-14 w-14 drop-shadow-[0_4px_20px_rgba(124,58,237,0.4)]" />
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50 sm:text-3xl">
            Welcome back, <span className="text-purple-300">{firstName}</span>
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            OpenAPK<span className="text-red-500">.AI</span> · agent-native Android reverse engineering
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
        <Link
          to="/projects"
          className="rounded-md bg-purple-600 px-4 py-2 font-medium text-white shadow-[0_4px_20px_rgba(124,58,237,0.4)] hover:bg-purple-500"
        >
          Upload APK →
        </Link>
        {/* Community is co-primary with Upload — amber-filled to match the
            cross-product OpenBin family accent and make it impossible to
            miss next to a purple primary. */}
        <Link
          to="/community"
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-4 py-2 font-medium text-black shadow-[0_4px_20px_rgba(251,191,36,0.4)] hover:bg-amber-400"
        >
          <span aria-hidden>★</span>
          Browse Community
        </Link>
        <Link
          to="/settings/api-keys"
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-4 py-2 text-zinc-200 hover:bg-zinc-800/60"
        >
          API keys
        </Link>
      </div>
    </section>
  )
}

function RecentProjects() {
  const api = useApi()
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api<Project[]>('/api/projects')
      .then((rows) => {
        if (cancelled) return
        const sorted = [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        setProjects(sorted.slice(0, 5))
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => { cancelled = true }
  }, [api])

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Recent projects</h2>
        <Link to="/projects" className="text-xs text-purple-300 hover:underline">All projects →</Link>
      </header>

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      {!error && projects === null && <SkeletonRows count={3} />}
      {!error && projects !== null && projects.length === 0 && (
        <p className="mt-4 text-sm text-zinc-400">
          No projects yet.{' '}
          <Link to="/projects" className="text-purple-300 hover:underline">Upload your first APK</Link>.
        </p>
      )}
      {projects !== null && projects.length > 0 && (
        <ul className="mt-4 divide-y divide-zinc-800">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                to={`/projects/${p.id}`}
                className="flex items-center justify-between gap-3 py-3 transition hover:bg-zinc-900/60"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-zinc-100">{p.name}</div>
                  <div className="mt-0.5 truncate font-mono text-xs text-zinc-500">
                    {p.packageName ?? p.originalFilename}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-zinc-500">{formatRelative(p.createdAt)}</span>
                  <span
                    className={`shrink-0 rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                      WORKFLOW_PILL[p.workflowStatus] ?? WORKFLOW_PILL.NEW
                    }`}
                  >
                    {WORKFLOW_LABEL[p.workflowStatus] ?? p.workflowStatus}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function UsageCard() {
  const api = useApi()
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api<UsageSummary>('/api/usage/summary')
      .then((s) => { if (!cancelled) setSummary(s) })
      .catch((e: Error) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [api])

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">This month</h2>
        <Link to="/settings/usage" className="text-xs text-purple-300 hover:underline">Details →</Link>
      </header>

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      {!error && summary === null && <SkeletonRows count={2} />}
      {summary && (
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Tokens</dt>
            <dd className="mt-1 font-mono text-lg text-zinc-100">
              {formatNumber(summary.monthTokens)}
              {summary.monthlyCap !== null && (
                <span className="ml-1 text-xs text-zinc-500">/ {formatNumber(summary.monthlyCap)}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Today</dt>
            <dd className="mt-1 font-mono text-lg text-zinc-100">
              {formatNumber(summary.todayTokens)}
              {summary.dailyCap !== null && (
                <span className="ml-1 text-xs text-zinc-500">/ {formatNumber(summary.dailyCap)}</span>
              )}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Total LLM calls</dt>
            <dd className="mt-1 font-mono text-base text-zinc-300">{formatNumber(summary.totalCalls)}</dd>
          </div>
          {summary.monthlyCap !== null && summary.monthlyCap > 0 && (
            <div className="col-span-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full bg-purple-500"
                  style={{
                    width: `${Math.min(100, (summary.monthTokens / summary.monthlyCap) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
        </dl>
      )}
    </section>
  )
}

/**
 * Headline community section on the dashboard. Bigger, more visually
 * prominent than the per-project cards because collaborative security
 * research IS the platform's value prop — this is the front door to it.
 * Gradient amber accent (matching the cross-product OpenBin family color)
 * differentiates it from the purple OpenAPK-product chrome around it.
 */
function CommunityHero() {
  const api = useApi()
  const [reports, setReports] = useState<CommunityReportSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api<CommunityReportSummary[]>('/api/community/apk/reports?size=3')
      .then((rows) => { if (!cancelled) setReports(rows.slice(0, 3)) })
      .catch((e: Error) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [api])

  return (
    <section className="overflow-hidden rounded-xl border border-amber-500/30 bg-linear-to-br from-amber-950/30 via-zinc-950 to-zinc-950 p-6 shadow-[0_8px_40px_rgba(251,191,36,0.08)] sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-lg text-amber-400">★</span>
            <h2 className="text-xl font-semibold text-zinc-50 sm:text-2xl">
              Community research
            </h2>
            <span className="rounded border border-amber-600/60 bg-amber-900/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-300">
              public
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-zinc-300 sm:text-base">
            Collaborative security research from the OpenBin community. Browse
            published APK reports, learn from other researchers' triage, and
            publish your own findings.
          </p>
        </div>
        <Link
          to="/community"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-black shadow-[0_4px_20px_rgba(251,191,36,0.4)] transition hover:bg-amber-400"
        >
          Browse all reports →
        </Link>
      </div>

      {error && <p className="mt-5 text-sm text-red-400">{error}</p>}
      {!error && reports === null && <SkeletonRows count={3} />}
      {!error && reports !== null && reports.length === 0 && (
        <div className="mt-5 rounded-md border border-zinc-800 bg-zinc-950/40 px-4 py-6 text-center">
          <p className="text-sm text-zinc-300">
            No community reports yet —{' '}
            <Link to="/projects" className="font-medium text-amber-300 underline-offset-4 hover:underline">
              be the first to publish
            </Link>
            .
          </p>
        </div>
      )}
      {reports !== null && reports.length > 0 && (
        <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {reports.map((r) => (
            <li key={r.reportId}>
              <Link
                to={`/community/reports/${r.reportId}`}
                className="block h-full rounded-md border border-zinc-800 bg-zinc-950/60 p-3 transition hover:border-amber-500/40 hover:bg-zinc-900/60"
              >
                <div className="flex items-start gap-2.5">
                  <Gravatar emailMd5={r.authorEmailMd5} size={28} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-sm font-medium text-zinc-100">{r.title}</div>
                    <div className="mt-1 truncate text-xs text-zinc-500">
                      {r.authorDisplayName} · {formatRelative(r.communityPublishedAt)}
                    </div>
                    {r.malwareType && (
                      <div className="mt-1.5 inline-block rounded border border-purple-700/60 bg-purple-950/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-purple-300">
                        {r.malwareType}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <ul className="mt-4 space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="h-8 animate-pulse rounded bg-zinc-800/60" />
      ))}
    </ul>
  )
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

// Loosely-relative timestamps for the dashboard. Anything older than a week
// falls back to a calendar date — the dashboard surfaces *recent* activity,
// so "32 days ago" is less useful than "May 12".
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.max(0, now - then)
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
