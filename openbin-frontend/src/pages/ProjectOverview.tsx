import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, useApi } from '@shared/api/client'
import { canEdit, isOwner, isOnline, relativeActive, type ProjectMember, type ProjectRole } from '@shared/api/collaborators'
import { ProjectVisibilityToggle } from '@shared/components/ProjectVisibilityToggle'
import { ShareProjectModal } from '@shared/components/ShareProjectModal'
import { ForkButton } from '@shared/components/ForkButton'
import { ProjectChatPanel } from '@shared/components/dm/ProjectChatPanel'
import { AddSampleModal, SAMPLES_CHANGED_EVENT } from '../components/AddSampleModal'
import type { ProjectSample } from '../api/samples'

// Project overview: the project-level page (name, description, access,
// status, members, samples). The workspace at /projects/:id stays the
// per-sample code view; this page is where you pick a sample and change
// project settings. Every write here goes through endpoints that already
// exist (PATCH /projects/{id}, /public, /collaborators, /samples).

type DecompileStatus = 'UPLOADED' | 'DECOMPILING' | 'READY' | 'FAILED' | 'INGEST_PENDING'
type WorkflowStatus = 'NEW' | 'TRIAGING' | 'ANALYZING' | 'DRAFTING_REPORT' | 'PUBLISHED'

type Project = {
  id: string
  kind: 'APK' | 'BIN' | 'SCRIPT'
  name: string
  description: string | null
  originalFilename: string
  sizeBytes: number
  sha256: string
  status: DecompileStatus
  workflowStatus: WorkflowStatus
  errorMessage: string | null
  arch: string | null
  executableFormat: string | null
  createdAt: string
  decompiledAt: string | null
  role: ProjectRole | null
  publicReadAt: string | null
  forkedFromId: string | null
  forkCount: number
  bundleId: string | null
}

const WORKFLOW_LABEL: Record<WorkflowStatus, string> = {
  NEW: 'New',
  TRIAGING: 'Triaging',
  ANALYZING: 'Analyzing',
  DRAFTING_REPORT: 'Drafting report',
  PUBLISHED: 'Published',
}

const STATUS_LABEL: Record<DecompileStatus, string> = {
  UPLOADED: 'Queued',
  DECOMPILING: 'Decompiling',
  READY: 'Ready',
  FAILED: 'Failed',
  INGEST_PENDING: 'Waiting for the CLI upload',
}

const KIND_LABEL = { APK: 'Android APK', BIN: 'Native binary', SCRIPT: 'Script package' } as const

export function ProjectOverview() {
  const { id = '' } = useParams<{ id: string }>()
  const api = useApi()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [members, setMembers] = useState<ProjectMember[] | null>(null)
  const [samples, setSamples] = useState<ProjectSample[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [addSampleOpen, setAddSampleOpen] = useState(false)

  const loadProject = useCallback(async () => {
    try {
      setProject(await api<Project>(`/api/projects/${id}`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message)
    }
  }, [api, id])

  const loadMembers = useCallback(async () => {
    try {
      setMembers(await api<ProjectMember[]>(`/api/projects/${id}/members`))
    } catch {
      setMembers([])
    }
  }, [api, id])

  const loadSamples = useCallback(async () => {
    try {
      setSamples(await api<ProjectSample[]>(`/api/projects/${id}/samples`))
    } catch {
      setSamples([])
    }
  }, [api, id])

  useEffect(() => {
    setProject(null); setMembers(null); setSamples(null); setError(null)
    void loadProject()
    void loadMembers()
  }, [loadProject, loadMembers])

  useEffect(() => {
    if (project?.kind !== 'BIN') return
    void loadSamples()
    const onChanged = () => void loadSamples()
    window.addEventListener(SAMPLES_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(SAMPLES_CHANGED_EVENT, onChanged)
  }, [project?.kind, loadSamples])

  async function patch(body: Partial<{ name: string; description: string; workflowStatus: WorkflowStatus }>) {
    setSaveError(null)
    try {
      const updated = await api<Project>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
      setProject(updated)
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : (e as Error).message)
    }
  }

  async function remove() {
    if (!project) return
    if (!confirm(`Delete project "${project.name}"? This removes the upload, decompile output, and analysis history.`)) return
    try {
      await api(`/api/projects/${id}`, { method: 'DELETE' })
      navigate('/projects', { replace: true })
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : (e as Error).message)
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="rounded border border-red-900/60 bg-red-950/40 px-4 py-2 text-sm text-red-300">{error}</div>
      </div>
    )
  }
  if (!project) {
    return <div className="px-6 py-8 text-sm text-zinc-500">Loading project…</div>
  }

  const editor = canEdit(project.role)
  const owner = isOwner(project.role)
  const ready = project.status === 'READY'
  const workspaceHref = `/projects/${project.id}`

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="text-xs text-zinc-500">
        <Link to="/projects" className="hover:text-zinc-300">Projects</Link>
        {project.bundleId && (
          <>
            {' / '}
            <Link to={`/bundles/${project.bundleId}`} className="hover:text-zinc-300">Bundle</Link>
          </>
        )}
      </div>

      <header className="mt-2 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <EditableName value={project.name} canEdit={editor} onSave={(name) => void patch({ name })} />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>{KIND_LABEL[project.kind]}</span>
            <span aria-hidden>·</span>
            <span className={ready ? 'text-emerald-300' : project.status === 'FAILED' ? 'text-red-300' : 'text-amber-300'}>
              {STATUS_LABEL[project.status]}
            </span>
            <span aria-hidden>·</span>
            <span>{project.publicReadAt ? 'Public' : 'Private'}</span>
            {project.role && (
              <>
                <span aria-hidden>·</span>
                <span className="font-mono uppercase tracking-wide">{project.role.toLowerCase()}</span>
              </>
            )}
            {project.forkedFromId && (
              <>
                <span aria-hidden>·</span>
                <Link to={`/projects/${project.forkedFromId}/overview`} className="hover:text-amber-300">forked</Link>
              </>
            )}
            {project.forkCount > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>{project.forkCount} fork{project.forkCount === 1 ? '' : 's'}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            to={workspaceHref}
            onClick={(e) => { if (!ready) e.preventDefault() }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${ready ? 'bg-amber-500 text-zinc-950 hover:bg-amber-400' : 'cursor-not-allowed bg-zinc-800 text-zinc-500'}`}
            title={ready ? 'Open the code workspace' : 'The workspace opens once the analysis is ready'}
          >
            Open workspace
          </Link>
          <Link to={`/projects/${project.id}/report`} className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800">
            Report
          </Link>
          <ForkButton projectId={project.id} accent="amber" compact onForked={(nid) => navigate(`/projects/${nid}/overview`)} />
        </div>
      </header>

      {project.errorMessage && (
        <div className="mt-4 rounded border border-red-900/60 bg-red-950/40 px-4 py-2 text-sm text-red-300">{project.errorMessage}</div>
      )}
      {saveError && (
        <div className="mt-4 rounded border border-red-900/60 bg-red-950/40 px-4 py-2 text-sm text-red-300">{saveError}</div>
      )}

      <section className="mt-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Description</h2>
        <EditableDescription value={project.description} canEdit={editor} onSave={(description) => void patch({ description })} />
      </section>

      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Status</h2>
          <label className="mt-3 block text-xs text-zinc-400">
            Workflow
            <select
              value={project.workflowStatus}
              disabled={!editor || project.workflowStatus === 'PUBLISHED'}
              onChange={(e) => void patch({ workflowStatus: e.target.value as WorkflowStatus })}
              title={project.workflowStatus === 'PUBLISHED' ? 'Unpublish the report first' : undefined}
              className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 disabled:opacity-50"
            >
              {project.workflowStatus === 'PUBLISHED' && <option value="PUBLISHED">Published (locked)</option>}
              {(['NEW', 'TRIAGING', 'ANALYZING', 'DRAFTING_REPORT'] as WorkflowStatus[]).map((s) => (
                <option key={s} value={s}>{WORKFLOW_LABEL[s]}</option>
              ))}
            </select>
          </label>
          <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-y-1.5 text-xs">
            <dt className="text-zinc-500">File</dt>
            <dd className="truncate font-mono text-zinc-300" title={project.originalFilename}>{project.originalFilename}</dd>
            <dt className="text-zinc-500">Size</dt>
            <dd className="text-zinc-300">{formatBytes(project.sizeBytes)}</dd>
            <dt className="text-zinc-500">SHA-256</dt>
            <dd className="truncate font-mono text-zinc-300" title={project.sha256}>{project.sha256}</dd>
            {project.kind === 'BIN' && (
              <>
                <dt className="text-zinc-500">Format</dt>
                <dd className="text-zinc-300">{[project.executableFormat, project.arch].filter(Boolean).join(' · ') || 'unknown'}</dd>
              </>
            )}
            <dt className="text-zinc-500">Added</dt>
            <dd className="text-zinc-300">{new Date(project.createdAt).toLocaleString()}</dd>
            {project.decompiledAt && (
              <>
                <dt className="text-zinc-500">Analyzed</dt>
                <dd className="text-zinc-300">{new Date(project.decompiledAt).toLocaleString()}</dd>
              </>
            )}
          </dl>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Access</h2>
            {owner && (
              <button
                onClick={() => setShareOpen(true)}
                className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                Share…
              </button>
            )}
          </div>
          {owner && (
            <div className="mt-3">
              <ProjectVisibilityToggle projectId={project.id} initialPublicReadAt={project.publicReadAt} accent="amber" />
            </div>
          )}
          <ul className="mt-3 divide-y divide-zinc-800/80">
            {members === null && <li className="py-2 text-xs text-zinc-500">Loading members…</li>}
            {members?.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 py-2">
                <span
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                  style={{ background: colorFor(m.userId) }}
                >
                  {initials(m)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-zinc-100">
                    {m.displayName || m.email}
                    {m.isSelf && <span className="text-zinc-500"> (you)</span>}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {m.role.charAt(0) + m.role.slice(1).toLowerCase()}
                    {m.lastActiveAt && (
                      <>
                        {' · '}
                        <span className={isOnline(m.lastActiveAt) ? 'text-emerald-300' : ''}>{relativeActive(m.lastActiveAt)}</span>
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Samples</h2>
          {project.kind === 'BIN' && editor && (
            <button
              onClick={() => setAddSampleOpen(true)}
              className="rounded border border-amber-700/60 bg-amber-950/30 px-2 py-1 text-xs font-medium text-amber-200 hover:bg-amber-900/40"
            >
              ＋ Add sample
            </button>
          )}
        </div>
        <ul className="mt-3 divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950/60">
          <SampleRow
            href={workspaceHref}
            active={ready}
            label={project.originalFilename}
            tag="primary"
            meta={[project.executableFormat, project.arch, formatBytes(project.sizeBytes)].filter(Boolean).join(' · ')}
            status={STATUS_LABEL[project.status]}
            ok={ready}
          />
          {samples?.map((s) => (
            <SampleRow
              key={s.id}
              href={`${workspaceHref}?sample=${s.id}`}
              active={s.status === 'READY'}
              label={s.label}
              meta={[s.originalFilename, s.executableFormat, s.arch, formatBytes(s.sizeBytes)].filter(Boolean).join(' · ')}
              status={s.status === 'READY' ? 'Ready' : s.status === 'FAILED' ? 'Failed' : 'Waiting for the CLI upload'}
              ok={s.status === 'READY'}
            />
          ))}
        </ul>
        {project.kind === 'BIN' && samples !== null && samples.length === 0 && (
          <p className="mt-2 text-xs text-zinc-500">
            One sample so far. Add a dropper's payloads or firmware revisions to work on them side by side.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Team chat</h2>
        <div className="mt-3 h-96 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/60">
          <ProjectChatPanel projectId={project.id} accent="amber" />
        </div>
      </section>

      {owner && (
        <section className="mt-10 border-t border-zinc-800 pt-4">
          <button onClick={() => void remove()} className="rounded border border-red-900/60 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/40">
            Delete project
          </button>
        </section>
      )}

      {shareOpen && (
        <ShareProjectModal
          projectId={project.id}
          accent="amber"
          onClose={() => { setShareOpen(false); void loadMembers() }}
        />
      )}
      {addSampleOpen && (
        <AddSampleModal projectId={project.id} projectName={project.name} onClose={() => setAddSampleOpen(false)} />
      )}
    </div>
  )
}

function SampleRow({ href, active, label, tag, meta, status, ok }: {
  href: string; active: boolean; label: string; tag?: string; meta: string; status: string; ok: boolean
}) {
  return (
    <li>
      <Link
        to={href}
        onClick={(e) => { if (!active) e.preventDefault() }}
        className={`flex items-center gap-3 px-4 py-3 ${active ? 'hover:bg-zinc-900/60' : 'cursor-default'}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`truncate text-sm ${active ? 'text-zinc-100' : 'text-zinc-400'}`}>{label}</span>
            {tag && <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">{tag}</span>}
          </div>
          <div className="mt-0.5 truncate text-xs text-zinc-500">{meta}</div>
        </div>
        <span className={`shrink-0 text-xs ${ok ? 'text-emerald-300' : 'text-amber-300'}`}>{status}</span>
      </Link>
    </li>
  )
}

function EditableName({ value, canEdit, onSave }: { value: string; canEdit: boolean; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])
  function commit() {
    const t = draft.trim()
    if (t && t !== value) onSave(t)
    setEditing(false)
  }
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-2xl font-semibold text-zinc-100"
      />
    )
  }
  return (
    <h1 className="flex items-center gap-2 text-2xl font-semibold text-zinc-50">
      <span className="truncate">{value}</span>
      {canEdit && (
        <button onClick={() => setEditing(true)} title="Rename" className="text-sm text-zinc-500 hover:text-zinc-200">✎</button>
      )}
    </h1>
  )
}

function EditableDescription({ value, canEdit, onSave }: { value: string | null; canEdit: boolean; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { if (!editing) setDraft(value ?? '') }, [value, editing])
  function commit() {
    if (draft.trim() !== (value ?? '')) onSave(draft)
    setEditing(false)
  }
  if (editing) {
    return (
      <div className="mt-2">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) } }}
          rows={4}
          maxLength={4000}
          placeholder="What is this sample, where did it come from, what are you trying to find out?"
          className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
        />
        <div className="mt-2 flex gap-2">
          <button onClick={commit} className="rounded bg-amber-500 px-3 py-1 text-xs font-medium text-zinc-950 hover:bg-amber-400">Save</button>
          <button onClick={() => { setDraft(value ?? ''); setEditing(false) }} className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800">Cancel</button>
        </div>
      </div>
    )
  }
  return (
    <div className="mt-2 flex items-start gap-2">
      {value ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{value}</p>
      ) : (
        <p className="text-sm text-zinc-500">{canEdit ? 'No description yet.' : 'No description.'}</p>
      )}
      {canEdit && (
        <button onClick={() => setEditing(true)} title="Edit description" className="shrink-0 text-sm text-zinc-500 hover:text-zinc-200">✎</button>
      )}
    </div>
  )
}

function initials(m: ProjectMember): string {
  const src = (m.displayName || m.email || '?').trim()
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  const a = parts[0]?.[0] ?? '?'
  const b = parts.length > 1 ? parts[1]?.[0] ?? '' : ''
  return (a + b).toUpperCase()
}

// Stable per-user hue so the same person gets the same color everywhere.
function colorFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 45% 40%)`
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
