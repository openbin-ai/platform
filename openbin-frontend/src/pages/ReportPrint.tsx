import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { useApi } from '@shared/api/client'
import { AuthenticatedImg } from '../components/AuthenticatedImg'

type Section = { id: string; title: string; content: string }
type ReportResponse = {
  title: string
  sections: Section[]
  updatedAt: string
  publishedAt: string | null
}
type ProjectResponse = {
  name: string
  originalFilename: string
  packageName: string | null
  sha256: string
}

/**
 * Standalone, print-friendly render of a project's report. Rendered outside
 * the app Layout so the page has no chrome — what you see is what the printed
 * PDF will look like. User clicks the floating "Print" button or hits Cmd/Ctrl+P.
 */
export function ReportPrint() {
  const { id } = useParams<{ id: string }>()
  const api = useApi()
  const [project, setProject] = useState<ProjectResponse | null>(null)
  const [report, setReport] = useState<ReportResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    Promise.all([
      api<ProjectResponse>(`/api/projects/${id}`),
      api<ReportResponse>(`/api/projects/${id}/report`),
    ]).then(([p, r]) => {
      if (cancelled) return
      setProject(p)
      setReport(r)
      document.title = `${r.title} — ${p.name}`
    }).catch(e => { if (!cancelled) setError((e as Error).message) })
    return () => { cancelled = true }
  }, [api, id])

  if (!id) return <p className="p-8">Missing project id.</p>
  if (error) return <p className="p-8 text-red-600">Failed to load: {error}</p>
  if (!project || !report) return <p className="p-8 text-zinc-500">Loading…</p>

  return (
    <div className="report-print min-h-screen bg-white text-zinc-900">
      {/* Floating no-print toolbar */}
      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-3 shadow-sm">
        <span className="text-sm text-zinc-600">
          Preview — use the browser's print dialog and choose <strong>Save as PDF</strong>.
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => window.history.back()}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            ← Back
          </button>
          <button
            onClick={() => window.print()}
            className="rounded bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
          >
            🖨 Print / Save as PDF
          </button>
        </div>
      </div>

      <article className="mx-auto max-w-3xl px-8 py-10">
        <header className="mb-8 border-b border-zinc-200 pb-6">
          <h1 className="text-3xl font-semibold text-zinc-900">{report.title}</h1>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-zinc-700">
            <dt className="font-medium">Project</dt><dd>{project.name}</dd>
            {project.name !== project.originalFilename && (
              <>
                <dt className="font-medium">Original filename</dt>
                <dd className="font-mono">{project.originalFilename}</dd>
              </>
            )}
            {project.packageName && (
              <>
                <dt className="font-medium">Package</dt>
                <dd className="font-mono">{project.packageName}</dd>
              </>
            )}
            <dt className="font-medium">SHA-256</dt>
            <dd className="break-all font-mono text-xs">{project.sha256}</dd>
            {report.publishedAt && (
              <>
                <dt className="font-medium">Published</dt>
                <dd>{new Date(report.publishedAt).toLocaleString()}</dd>
              </>
            )}
            <dt className="font-medium">Generated</dt>
            <dd>{new Date().toLocaleString()}</dd>
          </dl>
        </header>

        {report.sections.map(s => (
          <section key={s.id} className="mb-8 break-inside-avoid">
            <h2 className="mb-3 text-xl font-semibold text-zinc-900">{s.title}</h2>
            <div className="report-print-md">
              <ReactMarkdown
                components={{
                  img: ({ src, alt }) => (
                    <AuthenticatedImg
                      src={typeof src === 'string' ? src : ''}
                      alt={alt}
                      className="my-3 max-w-full rounded border border-zinc-200"
                    />
                  ),
                }}
              >
                {s.content || '_(empty)_'}
              </ReactMarkdown>
            </div>
          </section>
        ))}
      </article>
    </div>
  )
}
