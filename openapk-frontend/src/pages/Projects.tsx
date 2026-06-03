import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE, ApiError, useApi } from '../api/client'
import { useAuth } from 'react-oidc-context'

/**
 * Upload progress state for the dropzone. {@code null} means no upload in
 * flight; otherwise shows the live transfer. Tracked via XHR because
 * {@code fetch} has no upload-progress event.
 */
type UploadProgress = { sent: number; total: number; filename: string } | null

type DecompileStatus = 'UPLOADED' | 'DECOMPILING' | 'READY' | 'FAILED'
type WorkflowStatus = 'NEW' | 'TRIAGING' | 'ANALYZING' | 'DRAFTING_REPORT' | 'PUBLISHED'

export type Project = {
  id: string
  name: string
  originalFilename: string
  sizeBytes: number
  sha256: string
  status: DecompileStatus
  workflowStatus: WorkflowStatus
  errorMessage: string | null
  packageName: string | null
  createdAt: string
  decompiledAt: string | null
  decompilePhase: string | null
  decompileStartedAt: string | null
}

type ReportSummary = {
  id: string
  projectId: string
  title: string
  updatedAt: string
  publishedAt: string | null
}

type Tab = 'projects' | 'reports'

const WORKFLOW_LABEL: Record<WorkflowStatus, string> = {
  NEW: 'New',
  TRIAGING: 'Triaging',
  ANALYZING: 'Analyzing',
  DRAFTING_REPORT: 'Drafting report',
  PUBLISHED: 'Published',
}

const WORKFLOW_PILL: Record<WorkflowStatus, string> = {
  NEW: 'bg-zinc-800 text-zinc-300',
  TRIAGING: 'bg-sky-950/60 text-sky-300',
  ANALYZING: 'bg-amber-950/60 text-amber-300',
  DRAFTING_REPORT: 'bg-violet-950/60 text-violet-300',
  PUBLISHED: 'bg-emerald-950/60 text-emerald-300',
}

export function Projects() {
  const api = useApi()
  const auth = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [upload, setUpload] = useState<UploadProgress>(null)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<Tab>('projects')

  const refresh = useCallback(async () => {
    try {
      setProjects(await api<Project[]>('/api/projects'))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { void refresh() }, [refresh])

  // Poll while any project is still being decompiled. Faster cadence (1s)
  // than the default refresh so phase changes feel snappy in the UI.
  useEffect(() => {
    const anyPending = projects.some(p => p.status === 'UPLOADED' || p.status === 'DECOMPILING')
    if (!anyPending) return
    const id = setInterval(() => { void refresh() }, 1000)
    return () => clearInterval(id)
  }, [projects, refresh])

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]
    if (!file.name.toLowerCase().endsWith('.apk')) {
      setError(`Not an APK: ${file.name}`)
      return
    }
    setError(null)
    setUpload({ sent: 0, total: file.size, filename: file.name })
    try {
      // XHR gives us upload-progress events that fetch() doesn't. Used only
      // here; rest of the app stays on the api/client.ts fetch helper.
      await uploadWithProgress(
        `${API_BASE}/api/projects`,
        file,
        auth.user?.access_token,
        (sent) => setUpload({ sent, total: file.size, filename: file.name }),
      )
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUpload(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete project "${name}"? This removes decompiled files from disk.`)) return
    try {
      await api(`/api/projects/${id}`, { method: 'DELETE' })
      setProjects(prev => prev.filter(p => p.id !== id))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function patchProject(id: string, body: Partial<{ name: string; workflowStatus: WorkflowStatus }>) {
    try {
      const updated = await api<Project>(`/api/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      setProjects(prev => prev.map(p => p.id === id ? updated : p))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">Projects</h1>
        <p className="mt-1 text-zinc-400">Drop an APK to decompile it with JADX. Max 200 MB.</p>
      </div>

      {error && (
        <div className="rounded border border-red-900/60 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex gap-1 border-b border-zinc-800">
        <TabBtn active={tab === 'projects'} onClick={() => setTab('projects')}>
          Projects ({projects.length})
        </TabBtn>
        <TabBtn active={tab === 'reports'} onClick={() => setTab('reports')}>
          Reports
        </TabBtn>
      </div>

      {tab === 'projects' ? (
        <ProjectsTab
          projects={projects}
          loading={loading}
          upload={upload}
          dragActive={dragActive}
          setDragActive={setDragActive}
          fileInputRef={fileInputRef}
          onFiles={handleFiles}
          onDelete={handleDelete}
          onPatch={patchProject}
        />
      ) : (
        <ReportsTab projects={projects} loading={loading} onError={setError} />
      )}
    </div>
  )
}

// =========================================================================
// Projects tab
// =========================================================================

function ProjectsTab({
  projects, loading, upload, dragActive, setDragActive, fileInputRef,
  onFiles, onDelete, onPatch,
}: {
  projects: Project[]
  loading: boolean
  upload: UploadProgress
  dragActive: boolean
  setDragActive: (b: boolean) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFiles: (f: FileList | null) => void
  onDelete: (id: string, name: string) => void
  onPatch: (id: string, body: Partial<{ name: string; workflowStatus: WorkflowStatus }>) => void
}) {
  const uploading = upload !== null
  // Clamp pct to [0, 99] while bytes are still streaming — 100% is reserved
  // for the moment the server has fully acknowledged the request, after which
  // setUpload(null) flips us back to the idle dropzone.
  const pct = upload && upload.total > 0
    ? Math.min(99, Math.floor((upload.sent / upload.total) * 100))
    : 0
  return (
    <div className="space-y-6">
      <div
        onDragEnter={e => { e.preventDefault(); if (!uploading) setDragActive(true) }}
        onDragOver={e => { e.preventDefault(); if (!uploading) setDragActive(true) }}
        onDragLeave={e => { e.preventDefault(); setDragActive(false) }}
        onDrop={e => {
          e.preventDefault()
          setDragActive(false)
          if (!uploading) onFiles(e.dataTransfer.files)
        }}
        onClick={() => { if (!uploading) fileInputRef.current?.click() }}
        className={`relative flex h-40 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed transition-colors ${
          uploading
            ? 'cursor-progress border-purple-500/70 bg-purple-950/20'
            : dragActive
              ? 'cursor-pointer border-purple-500 bg-purple-950/30'
              : 'cursor-pointer border-zinc-700 bg-zinc-900/40 hover:border-zinc-500'
        }`}
      >
        {uploading && upload ? (
          <div className="z-10 w-full max-w-xl px-6 text-center">
            <p className="truncate font-mono text-sm text-zinc-100">{upload.filename}</p>
            <p className="mt-1 text-xs text-zinc-400">
              Uploading {pct}% · {formatBytes(upload.sent)} / {formatBytes(upload.total)}
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded bg-zinc-800/80">
              <div
                className="h-full bg-linear-to-r from-purple-600 to-purple-400 transition-[width] duration-150 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 text-[10px] uppercase tracking-wider text-zinc-500">
              Decompile starts automatically when transfer completes
            </p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-zinc-200">Drop an APK here or click to browse</p>
            <p className="mt-1 text-xs text-zinc-500">.apk files only · up to 200 MB</p>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".apk"
          className="hidden"
          onChange={e => onFiles(e.target.files)}
        />
      </div>

      {loading ? (
        <p className="text-zinc-500">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="text-zinc-500">No projects yet. Upload one above.</p>
      ) : (
        <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/40">
          {projects.map(p => (
            <ProjectRow key={p.id} project={p} onDelete={onDelete} onPatch={onPatch} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ProjectRow({
  project, onDelete, onPatch,
}: {
  project: Project
  onDelete: (id: string, name: string) => void
  onPatch: (id: string, body: Partial<{ name: string; workflowStatus: WorkflowStatus }>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(project.name)

  function saveName() {
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== project.name) onPatch(project.id, { name: trimmed })
    setEditing(false)
  }

  const linkActive = project.status === 'READY'
  // Don't offer PUBLISHED — that's set by the publish endpoint, not via PATCH.
  const statusChoices: WorkflowStatus[] = ['NEW', 'TRIAGING', 'ANALYZING', 'DRAFTING_REPORT']
  const lockedAtPublished = project.workflowStatus === 'PUBLISHED'

  return (
    <li className="flex items-center gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {editing ? (
            <input
              autoFocus
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              onBlur={saveName}
              onKeyDown={e => {
                if (e.key === 'Enter') saveName()
                else if (e.key === 'Escape') { setDraftName(project.name); setEditing(false) }
              }}
              className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-zinc-100"
            />
          ) : (
            <Link
              to={`/projects/${project.id}`}
              className={`truncate font-medium ${linkActive ? 'text-zinc-100 hover:text-purple-300' : 'text-zinc-400'}`}
              onClick={e => { if (!linkActive) e.preventDefault() }}
            >
              {project.name}
            </Link>
          )}
          {!editing && (
            <button
              onClick={() => { setDraftName(project.name); setEditing(true) }}
              title="Rename"
              className="text-xs text-zinc-500 hover:text-zinc-200"
            >
              ✎
            </button>
          )}
          <WorkflowPill status={project.workflowStatus} />
          <DecompilePill status={project.status} />
        </div>
        <div className="mt-1 text-xs text-zinc-500">
          {project.name !== project.originalFilename && (
            <span className="font-mono">{project.originalFilename} · </span>
          )}
          {formatBytes(project.sizeBytes)} · sha256 {project.sha256.substring(0, 12)}… · added {new Date(project.createdAt).toLocaleString()}
          {project.packageName && <> · <span className="font-mono">{project.packageName}</span></>}
        </div>
        {project.errorMessage && (
          <div className="mt-1 text-xs text-red-400">Error: {project.errorMessage}</div>
        )}
        {(project.status === 'UPLOADED' || project.status === 'DECOMPILING') && (
          <DecompileProgress
            phase={project.decompilePhase}
            startedAt={project.decompileStartedAt}
          />
        )}
      </div>

      <select
        value={lockedAtPublished ? 'PUBLISHED' : project.workflowStatus}
        onChange={e => onPatch(project.id, { workflowStatus: e.target.value as WorkflowStatus })}
        disabled={lockedAtPublished}
        title={lockedAtPublished ? 'Unpublish the report first' : 'Set workflow status'}
        className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 disabled:opacity-50"
      >
        {lockedAtPublished && <option value="PUBLISHED">Published (locked)</option>}
        {!lockedAtPublished && statusChoices.map(s => (
          <option key={s} value={s}>{WORKFLOW_LABEL[s]}</option>
        ))}
      </select>

      <button
        className="rounded border border-red-900/60 px-3 py-1 text-sm text-red-300 hover:bg-red-950/40"
        onClick={() => onDelete(project.id, project.name)}
      >
        Delete
      </button>
    </li>
  )
}

// =========================================================================
// Reports tab
// =========================================================================

function ReportsTab({
  projects, loading, onError,
}: {
  projects: Project[]
  loading: boolean
  onError: (msg: string | null) => void
}) {
  const api = useApi()
  const auth = useAuth()
  const [reports, setReports] = useState<Record<string, ReportSummary | 'missing' | 'loading'>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  // Fetch the report for each project (one round-trip per project for now —
  // small numbers in dev; can batch on the backend later if it gets slow).
  useEffect(() => {
    let cancelled = false
    const initial: Record<string, 'loading'> = {}
    for (const p of projects) initial[p.id] = 'loading'
    setReports(initial)
    void Promise.all(projects.map(async p => {
      try {
        const r = await api<ReportSummary>(`/api/projects/${p.id}/report`)
        if (!cancelled) setReports(prev => ({ ...prev, [p.id]: r }))
      } catch (e) {
        if (cancelled) return
        if (e instanceof ApiError && e.status === 404) {
          setReports(prev => ({ ...prev, [p.id]: 'missing' }))
        } else {
          setReports(prev => ({ ...prev, [p.id]: 'missing' }))
        }
      }
    }))
    return () => { cancelled = true }
  }, [api, projects])

  async function publish(projectId: string) {
    setBusyId(projectId)
    onError(null)
    try {
      const updated = await api<ReportSummary>(`/api/projects/${projectId}/report/publish`, { method: 'POST' })
      setReports(prev => ({ ...prev, [projectId]: updated }))
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function unpublish(projectId: string) {
    if (!confirm('Unpublish this report? Sections will become editable again.')) return
    setBusyId(projectId)
    onError(null)
    try {
      const updated = await api<ReportSummary>(`/api/projects/${projectId}/report/unpublish`, { method: 'POST' })
      setReports(prev => ({ ...prev, [projectId]: updated }))
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function download(projectId: string, name: string) {
    const token = auth.user?.access_token
    const resp = await fetch(`${API_BASE}/api/projects/${projectId}/report/export.md`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!resp.ok) {
      onError(`Download failed: ${resp.status} ${resp.statusText}`)
      return
    }
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slugify(name)}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  if (loading) return <p className="text-zinc-500">Loading…</p>
  if (projects.length === 0) {
    return <p className="text-zinc-500">No projects yet. Add one in the Projects tab.</p>
  }

  return (
    <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/40">
      {projects.map(p => {
        const r = reports[p.id]
        const published = r && typeof r !== 'string' && r.publishedAt
        return (
          <li key={p.id} className="flex items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Link to={`/projects/${p.id}/report`} target="_blank" rel="noopener noreferrer"
                      className="truncate font-medium text-zinc-100 hover:text-purple-300">
                  {p.name}
                </Link>
                <WorkflowPill status={p.workflowStatus} />
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {r === 'loading' ? 'Loading report…' :
                 r === 'missing' || !r ? 'No report yet.' :
                 published ? <>Published {new Date(r.publishedAt!).toLocaleString()}</> :
                 <>Draft · last saved {new Date(r.updatedAt).toLocaleString()}</>}
              </div>
            </div>
            <button
              onClick={() => download(p.id, p.name)}
              disabled={!r || r === 'loading'}
              className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
            >
              Download .md
            </button>
            <a
              href={`/projects/${p.id}/report/print`}
              target="_blank"
              rel="noopener noreferrer"
              className={`rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-800 ${
                !r || r === 'loading' ? 'pointer-events-none opacity-40' : ''
              }`}
              title="Open print view in a new tab — Save as PDF from the browser print dialog"
            >
              🖨 PDF
            </a>
            {published ? (
              <button
                onClick={() => unpublish(p.id)}
                disabled={busyId === p.id}
                className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
              >
                {busyId === p.id ? 'Unpublishing…' : 'Unpublish'}
              </button>
            ) : (
              <button
                onClick={() => publish(p.id)}
                disabled={busyId === p.id || !r || r === 'loading' || r === 'missing'}
                className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-40"
              >
                {busyId === p.id ? 'Publishing…' : 'Publish'}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// =========================================================================
// Shared bits
// =========================================================================

function TabBtn({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`border-b-2 px-4 py-2 text-sm transition-colors ${
        active ? 'border-purple-400 text-zinc-100' : 'border-transparent text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  )
}

function WorkflowPill({ status }: { status: WorkflowStatus }) {
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${WORKFLOW_PILL[status]}`}>
      {WORKFLOW_LABEL[status]}
    </span>
  )
}

function DecompilePill({ status }: { status: DecompileStatus }) {
  // Only surface non-READY pipeline states; READY is the boring default.
  if (status === 'READY') return null
  const styles: Record<DecompileStatus, string> = {
    UPLOADED: 'bg-zinc-800 text-zinc-300',
    DECOMPILING: 'bg-amber-950/60 text-amber-300',
    READY: 'bg-emerald-950/60 text-emerald-300',
    FAILED: 'bg-red-950/60 text-red-300',
  }
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${styles[status]}`}>
      {status === 'DECOMPILING' ? 'decompiling…' : status.toLowerCase()}
    </span>
  )
}

// Pipeline phases in display order. Each entry maps the backend's enum-ish
// string to a short human label rendered under in-flight projects.
const DECOMPILE_PHASES: Array<{ key: string; label: string }> = [
  { key: 'OPENING_APK', label: 'Opening APK' },
  { key: 'DECOMPILING', label: 'Decompiling sources' },
  { key: 'BUILDING_TREE', label: 'Caching file tree' },
  { key: 'INDEXING_USAGES', label: 'Indexing usages' },
]

/**
 * Compact "signs of life" indicator rendered under in-flight projects.
 * Shows an animated indeterminate bar, an elapsed-time counter that ticks
 * locally (no polling needed), and a breadcrumb-style row of pipeline
 * phases with ✓ done / → current / · pending markers.
 *
 * <p>Backend updates {@code decompilePhase} as it transitions through each
 * step; the polling loop in {@code Projects} picks the new value up within
 * ~1s. The elapsed timer ticks every second on its own so the user sees
 * motion even between polls.
 */
function DecompileProgress({ phase, startedAt }: { phase: string | null; startedAt: string | null }) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const elapsedSec = startedAt
    ? Math.max(0, Math.floor((nowMs - new Date(startedAt).getTime()) / 1000))
    : null
  const elapsedLabel = elapsedSec == null ? '' : formatElapsed(elapsedSec)

  // Resolve current phase index. STARTING (or null) maps to -1 so no step
  // is yet checked off; an unknown phase falls back to "0" (Opening APK).
  const currentIdx = (() => {
    if (!phase || phase === 'STARTING') return -1
    const i = DECOMPILE_PHASES.findIndex(p => p.key === phase)
    return i === -1 ? 0 : i
  })()
  const currentLabel = currentIdx === -1
    ? 'Queued — waiting for worker'
    : DECOMPILE_PHASES[currentIdx].label

  return (
    <div className="mt-2 space-y-1.5">
      <div className="h-1 overflow-hidden rounded bg-zinc-800/80">
        <div className="decompile-bar h-full w-1/3 bg-linear-to-r from-amber-500/40 via-amber-400 to-amber-500/40" />
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <div className="flex items-center gap-1.5 text-zinc-400">
          <span className="font-mono text-amber-300">{elapsedLabel}</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-200">{currentLabel}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          {DECOMPILE_PHASES.map((p, i) => {
            const done = currentIdx > i
            const active = currentIdx === i
            return (
              <span
                key={p.key}
                title={p.label}
                className={
                  done
                    ? 'text-emerald-400'
                    : active
                      ? 'text-amber-300'
                      : 'text-zinc-600'
                }
              >
                {done ? '✓' : active ? '→' : '·'} {p.label.split(' ')[0]}
              </span>
            )
          })}
        </div>
      </div>
      <style>{`
        @keyframes decompile-bar-slide {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        .decompile-bar {
          animation: decompile-bar-slide 1.4s linear infinite;
        }
      `}</style>
    </div>
  )
}

function formatElapsed(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * XHR-based multipart upload with progress events. Used only for the project
 * upload path; the rest of the app stays on the fetch-based api/client.ts.
 * fetch() can't report upload progress so this stays the cleanest path until
 * Streams API support is universal.
 */
function uploadWithProgress(
  url: string,
  file: File,
  token: string | undefined,
  onProgress: (sent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url, true)
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(file.size) // ensure 100% lands even if no final progress event
        resolve()
      } else {
        reject(new ApiError(xhr.status, `${xhr.status} ${xhr.statusText}: ${xhr.responseText}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.onabort = () => reject(new Error('Upload aborted'))
    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'report'
}
