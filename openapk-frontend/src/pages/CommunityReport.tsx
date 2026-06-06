import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import ReactMarkdown from 'react-markdown'
import { API_BASE, useApi } from '@shared/api/client'
import type { CommunityReportDetail } from '@shared/api/community'
import { Gravatar } from '@shared/components/Gravatar'
import { UpvoteButton } from '@shared/components/UpvoteButton'
import { FollowButton } from '@shared/components/FollowButton'
import iconUrl from '../assets/icon.png'

// Anonymous, read-only view of a single community report. Same shape as
// the auth'd Report editor's read mode but with zero edit affordances and
// minimal chrome - designed to be share-link-friendly.
//
// Mounted at /community/reports/:id outside RequireAuth. The shared API
// client tolerates anonymous calls (no Bearer header when auth.user is
// undefined), so the same hook works whether or not the visitor is logged in.
export function CommunityReport() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const auth = useAuth()
  const api = useApi()
  const [report, setReport] = useState<CommunityReportDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAbuse, setShowAbuse] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setError(null)
    api<CommunityReportDetail>(`/api/community/reports/${id}`)
      .then((r) => { if (!cancelled) setReport(r) })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to load report')
      })
    return () => { cancelled = true }
  }, [api, id])

  // BIN reports live on openbin.ai; if a user lands here with a BIN id,
  // bounce them to the right surface. We can't cross-domain client-side
  // in dev, but the link is still useful to share.
  useEffect(() => {
    if (report && report.kind === 'BIN') {
      // Soft redirect - leave the link visible so the user sees what
      // happened rather than getting silently teleported.
    }
  }, [report])

  if (error) {
    return (
      <ErrorShell title="Report unavailable" auth={auth}>
        <p className="text-sm text-zinc-400">
          This report either doesn't exist, has been removed, or was never published.
        </p>
        <Link to="/community" className="mt-4 inline-block text-sm text-purple-400 hover:underline">
          ← Back to community
        </Link>
      </ErrorShell>
    )
  }

  if (!report) {
    return (
      <ErrorShell title="" auth={auth}>
        <p className="text-sm text-zinc-500">Loading…</p>
      </ErrorShell>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-x-hidden bg-zinc-950 text-zinc-200">
      <PublicHeader auth={auth} />
      <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <button
          onClick={() => navigate(-1)}
          className="mb-4 text-xs text-zinc-500 hover:text-zinc-300"
        >
          ← Back
        </button>

        <article className="min-w-0">
          <header className="mb-6 border-b border-zinc-800 pb-4">
            <div className="flex items-start justify-between gap-3">
              <h1 className="wrap-break-word text-xl font-semibold text-zinc-100 sm:text-2xl">{report.title}</h1>
              <UpvoteButton
                reportId={report.reportId}
                initialCount={report.voteCount}
                initialVoted={report.votedByMe}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <Link to={`/u/${report.authorId}`} className="shrink-0">
                <Gravatar emailMd5={report.authorEmailMd5} size={32} />
              </Link>
              <div className="min-w-0 flex-1">
                <Link to={`/u/${report.authorId}`} className="block truncate text-sm text-zinc-200 hover:underline">
                  {report.authorDisplayName}
                </Link>
                <div className="text-xs text-zinc-500">
                  Published {new Date(report.communityPublishedAt).toLocaleString()}
                </div>
              </div>
              {/* Follow shows for authed viewers viewing someone else's report;
                  the backend's amFollowingAuthor is always false otherwise. */}
              {auth.isAuthenticated && report.authorId && (
                <FollowButton userId={report.authorId} initialFollowing={report.amFollowingAuthor} />
              )}
              <button
                onClick={() => setShowAbuse(true)}
                className="shrink-0 text-xs text-zinc-500 hover:text-red-400"
                title="Report this submission to moderators"
              >
                Report abuse
              </button>
            </div>
            <ProjectMeta report={report} />
            {(report.malwareType || report.tags.length > 0) && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {report.malwareType && (
                  <span className="rounded-full border border-amber-700 bg-amber-950/40 px-2.5 py-0.5 text-[11px] uppercase tracking-wide text-amber-300">
                    {report.malwareType}
                  </span>
                )}
                {report.tags.map((t) => (
                  <Link
                    key={t}
                    to={`/community?tag=${encodeURIComponent(t)}`}
                    className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2.5 py-0.5 text-[11px] text-zinc-300 hover:border-purple-700 hover:text-purple-200"
                  >
                    #{t}
                  </Link>
                ))}
              </div>
            )}
          </header>

          {report.sections.map((s) => (
            <section key={s.id} className="mb-8 min-w-0">
              <h2 className="mb-3 wrap-break-word text-lg font-medium text-zinc-100">{s.title}</h2>
              <div className="markdown-mobile prose prose-invert prose-sm max-w-none prose-zinc prose-headings:wrap-break-word prose-headings:text-zinc-200 prose-a:wrap-break-word prose-a:text-purple-400 prose-code:whitespace-pre-wrap prose-code:wrap-break-word prose-code:text-zinc-200 prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:overflow-x-auto prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-img:max-w-full prose-img:h-auto">
                {s.content && s.content.trim() ? (
                  <ReactMarkdown components={{ img: PublicImg }}>{s.content}</ReactMarkdown>
                ) : (
                  <p className="text-xs italic text-zinc-600">(empty)</p>
                )}
              </div>
            </section>
          ))}
        </article>
      </main>
      <PublicFooter />
      {showAbuse && (
        <AbuseModal
          reportId={report.reportId}
          api={api}
          onClose={() => setShowAbuse(false)}
        />
      )}
    </div>
  )
}

// Markdown image renderer for the public community view. Prepends the API
// base URL when the markdown stored a relative `/api/community/...` ref so
// the <img> hits api.openapk.ai instead of the current origin. Anonymous —
// no auth header — and relies on the backend 302'ing to a presigned S3 URL
// (or streaming bytes on the fs backend).
function PublicImg({ src, alt }: { src?: string; alt?: string }) {
  if (typeof src !== 'string' || !src) return null
  const absolute = src.startsWith('/api/') ? `${API_BASE}${src}` : src
  return (
    <img
      src={absolute}
      alt={alt ?? ''}
      loading="lazy"
      className="my-2 h-auto max-w-full rounded border border-zinc-800"
    />
  )
}

function ProjectMeta({ report }: { report: CommunityReportDetail }) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-500 sm:grid-cols-3">
      <Meta label="Project" value={report.projectName} />
      <Meta label="Filename" value={report.originalFilename} mono />
      {report.packageName && <Meta label="Package" value={report.packageName} mono />}
      <Meta label="SHA-256" value={report.sha256.slice(0, 24) + '…'} mono title={report.sha256} />
      {report.executableFormat && <Meta label="Format" value={report.executableFormat} />}
      {report.arch && <Meta label="Arch" value={report.arch} />}
    </dl>
  )
}

function Meta({ label, value, mono, title }: { label: string; value: string; mono?: boolean; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</dt>
      <dd className={`truncate ${mono ? 'font-mono text-zinc-300' : 'text-zinc-300'}`} title={title}>{value}</dd>
    </div>
  )
}

function AbuseModal({
  reportId,
  api,
  onClose,
}: {
  reportId: string
  api: ReturnType<typeof useApi>
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = useCallback(async () => {
    if (!reason.trim()) { setErr('Please describe the issue.'); return }
    setBusy(true)
    setErr(null)
    try {
      await api(`/api/community/reports/${reportId}/abuse`, {
        method: 'POST',
        body: JSON.stringify({
          reason: reason.trim(),
          reporterEmail: email.trim() || null,
        }),
      })
      setDone(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to submit')
    } finally {
      setBusy(false)
    }
  }, [api, email, reason, reportId])

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded border border-zinc-800 bg-zinc-950 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-base font-medium text-zinc-100">Report this submission</h3>
        <p className="mb-4 text-xs text-zinc-500">
          Tell us what's wrong with this report. We review every flag manually.
        </p>
        {done ? (
          <>
            <p className="rounded border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
              Thanks - we've received your report.
            </p>
            <div className="mt-4 flex justify-end">
              <button onClick={onClose} className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-800">Close</button>
            </div>
          </>
        ) : (
          <>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What's wrong with this submission?"
              rows={4}
              maxLength={2000}
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-purple-600 focus:outline-none"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Your email (optional, for follow-up)"
              maxLength={200}
              className="mt-2 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-purple-600 focus:outline-none"
            />
            {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy}
                className="rounded border border-red-700 bg-red-950/60 px-3 py-1 text-xs text-red-200 hover:bg-red-900/60 disabled:opacity-50"
              >
                {busy ? 'Sending…' : 'Submit'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function PublicHeader({ auth }: { auth: ReturnType<typeof useAuth> }) {
  return (
    <header className="border-b border-zinc-800 bg-zinc-950">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link to="/" className="flex items-center gap-2 text-zinc-100 hover:opacity-80">
          <img src={iconUrl} alt="OpenAPK" className="h-7 w-7" />
          <span className="text-sm font-semibold tracking-wide">
            OPENAPK<span className="text-red-500">.AI</span>
          </span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link to="/community" className="text-purple-300">Community</Link>
          {auth.isAuthenticated ? (
            <Link to="/projects" className="text-zinc-300 hover:text-zinc-100">My projects →</Link>
          ) : (
            <button
              onClick={() => void auth.signinRedirect()}
              className="rounded border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-zinc-800"
            >
              Sign in
            </button>
          )}
        </nav>
      </div>
    </header>
  )
}

function PublicFooter() {
  return (
    <footer className="border-t border-zinc-900 px-6 py-4 text-center text-[11px] text-zinc-600">
      Community submissions reflect the views of their authors only. <Link to="/terms" className="hover:underline">Terms</Link>.
    </footer>
  )
}

function ErrorShell({
  title,
  children,
  auth,
}: {
  title: string
  children: React.ReactNode
  auth: ReturnType<typeof useAuth>
}) {
  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      <PublicHeader auth={auth} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
        {title && <h1 className="mb-3 text-xl font-semibold text-zinc-100">{title}</h1>}
        {children}
      </main>
      <PublicFooter />
    </div>
  )
}
