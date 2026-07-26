import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { API_BASE, useApi } from '@shared/api/client'
import { HighlightsPanel } from '@shared/components/HighlightsPanel'
import { ForkButton } from '@shared/components/ForkButton'
import { AuthenticatedImg } from '../components/AuthenticatedImg'
import { PublicCodeView } from '../components/PublicCodeView'

// Anonymous read-only view of a project the owner made public
// (projects.public_read_at). Reads the /api/public/projects/{id}/** surface —
// works signed-out because that surface is permitAll and useApi() only
// attaches a token when one exists. Shows metadata + report + highlights;
// the interactive code browser stays in the authenticated ProjectView.

type PublicSummary = {
  id: string
  kind: 'APK' | 'BIN'
  name: string
  originalFilename: string
  sha256: string
  executableFormat: string | null
  arch: string | null
  packageName: string | null
  publicReadAt: string | null
  forkedFromId: string | null
  forkCount: number
}

type ReportSection = { id: string; title: string; content: string }
type PublicReport = { title: string; sections: ReportSection[]; malwareType: string | null; tags: string[] }

export function PublicProject() {
  const { id } = useParams<{ id: string }>()
  const api = useApi()
  const [summary, setSummary] = useState<PublicSummary | null>(null)
  const [report, setReport] = useState<PublicReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setError(null)
    api<PublicSummary>(`/api/public/projects/${id}`)
      .then((s) => { if (!cancelled) setSummary(s) })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load project') })
    // Report is best-effort — a public project may have no report yet.
    api<PublicReport>(`/api/public/projects/${id}/report`)
      .then((r) => { if (!cancelled) setReport(r) })
      .catch(() => { /* leave null */ })
    return () => { cancelled = true }
  }, [api, id])

  if (error) {
    return (
      <Shell title="Project unavailable">
        <p className="text-sm text-zinc-400">
          This project either doesn't exist, is private, or was made private.
        </p>
        <Link to="/community" className="mt-4 inline-block text-sm text-amber-400 hover:underline">
          ← Browse the community
        </Link>
      </Shell>
    )
  }
  if (!summary || !id) {
    return <Shell title=""><p className="text-sm text-zinc-500">Loading…</p></Shell>
  }

  const publicMediaSrc = (src?: string) => {
    if (typeof src !== 'string' || !src) return src
    // Report content stores authenticated /api/projects/{id}/media/... URLs;
    // rewrite to the anonymous public media path.
    return src.replace(`/api/projects/${id}/media/`, `/api/public/projects/${id}/media/`)
  }

  return (
    <div className="flex min-h-full flex-col overflow-x-hidden bg-zinc-950 text-zinc-200">
      <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-6 border-b border-zinc-800 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-400">
              {summary.kind}
            </span>
            <span className="rounded border border-emerald-700/60 bg-emerald-950/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-emerald-300">
              public · read-only
            </span>
            {summary.forkedFromId && (
              <Link
                to={`/public/projects/${summary.forkedFromId}`}
                className="rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-amber-300"
                title="View the project this was forked from"
              >
                🍴 forked from source
              </Link>
            )}
            {summary.forkCount > 0 && (
              <span className="text-[10px] text-zinc-500">{summary.forkCount} fork{summary.forkCount === 1 ? '' : 's'}</span>
            )}
          </div>
          <div className="mt-2 flex items-start justify-between gap-3">
            <h1 className="wrap-break-word text-xl font-semibold text-zinc-100 sm:text-2xl">
              {report?.title || summary.name}
            </h1>
            <ForkButton projectId={summary.id} accent="amber" />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-500 sm:grid-cols-3">
            <Meta label="Project" value={summary.name} />
            <Meta label="Filename" value={summary.originalFilename} mono />
            {summary.executableFormat && <Meta label="Format" value={summary.executableFormat} />}
            {summary.arch && <Meta label="Arch" value={summary.arch} />}
            <Meta label="SHA-256" value={summary.sha256.slice(0, 24) + '…'} mono title={summary.sha256} />
            {summary.packageName && <Meta label="Package" value={summary.packageName} mono />}
          </dl>
          {report && (report.malwareType || report.tags.length > 0) && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {report.malwareType && (
                <span className="rounded-full border border-red-700 bg-red-950/40 px-2.5 py-0.5 text-[11px] uppercase tracking-wide text-red-300">
                  {report.malwareType}
                </span>
              )}
              {report.tags.map((t) => (
                <span key={t} className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2.5 py-0.5 text-[11px] text-zinc-300">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </header>

        <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
          <article className="min-w-0">
            {report && report.sections.length > 0 ? (
              report.sections.map((s) => (
                <section key={s.id} className="mb-8 min-w-0">
                  <h2 className="mb-3 wrap-break-word text-lg font-medium text-zinc-100">{s.title}</h2>
                  <div className="prose prose-invert prose-sm max-w-none prose-zinc prose-headings:text-zinc-200 prose-a:text-amber-400 prose-code:text-zinc-200 prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:overflow-x-auto prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-img:max-w-full prose-img:h-auto">
                    {s.content && s.content.trim() ? (
                      <ReactMarkdown components={{ img: ({ src, alt }) => <PublicImg src={publicMediaSrc(src)} alt={alt} /> }}>
                        {s.content}
                      </ReactMarkdown>
                    ) : (
                      <p className="text-xs italic text-zinc-600">(empty)</p>
                    )}
                  </div>
                </section>
              ))
            ) : (
              <p className="text-sm text-zinc-500">No report has been written for this project yet.</p>
            )}
          </article>

          <aside className="min-w-0">
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-400">Highlights</h2>
            <div className="rounded border border-zinc-800 bg-zinc-900/30">
              <HighlightsPanel
                projectId={id}
                canEdit={false}
                Img={AuthenticatedImg}
                pathBase={`/api/public/projects/${id}`}
              />
            </div>
          </aside>
        </div>

        {/* Code — read-only, sign-in-gated (PublicCodeView shows a teaser
            for anonymous visitors). BIN only; APK public code is a later
            slice (no public source-tree surface on the backend yet). */}
        {summary.kind === 'BIN' && (
          <section className="mt-10 min-w-0">
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-400">Code</h2>
            <PublicCodeView projectId={id} />
          </section>
        )}
      </main>
      <p className="px-6 pb-4 text-center text-[11px] text-zinc-600">
        Public projects reflect the views of their authors only.
      </p>
    </div>
  )
}

function PublicImg({ src, alt }: { src?: string; alt?: string }) {
  if (typeof src !== 'string' || !src) return null
  const absolute = src.startsWith('/api/') ? `${API_BASE}${src}` : src
  return <img src={absolute} alt={alt ?? ''} loading="lazy" className="my-2 h-auto max-w-full rounded border border-zinc-800" />
}

function Meta({ label, value, mono, title }: { label: string; value: string; mono?: boolean; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</dt>
      <dd className={`truncate ${mono ? 'font-mono text-zinc-300' : 'text-zinc-300'}`} title={title}>{value}</dd>
    </div>
  )
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-zinc-950 text-zinc-200">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
        {title && <h1 className="mb-3 text-xl font-semibold text-zinc-100">{title}</h1>}
        {children}
      </main>
    </div>
  )
}
