import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { API_BASE, ApiError, useApi } from '../api/client'
import { useAuth } from 'react-oidc-context'
import { AuthenticatedImg } from '../components/AuthenticatedImg'
import { GalleryPickerModal } from '../components/GalleryPickerModal'
import { STIX_MALWARE_TYPES } from '@shared/api/community'

type ReportSection = { id: string; title: string; content: string }
type ReportResponse = {
  id: string
  projectId: string
  title: string
  sections: ReportSection[]
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  // Community visibility — separate from publishedAt. Author chooses
  // malware_type + tags at publish-to-community time so the feed
  // categorization reflects intent at the moment of sharing.
  communityPublishedAt: string | null
  malwareType: string | null
  tags: string[]
}

type TemplateMode = 'MALWARE' | 'VULN_RESEARCH' | 'ANY'
type ReportTemplate = {
  id: string
  name: string
  description: string | null
  mode: TemplateMode
  sections: ReportSection[]
  createdAt: string
  updatedAt: string
}

const POPULATABLE = new Set([
  'static_findings', 'iocs',
  'vulnerabilities', 'attack_surface', 'network_security',
])
/**
 * Generate a section id unique within the existing list. Used when a user
 * clicks "Add section" — we never reuse a known canonical id (overview, iocs,
 * etc.) so the populate map and existing renderers can't collide.
 */
function nextSectionId(existing: ReportSection[]): string {
  const used = new Set(existing.map(s => s.id))
  let n = existing.filter(s => s.id.startsWith('custom_')).length + 1
  let id = `custom_${n}`
  while (used.has(id)) id = `custom_${++n}`
  return id
}

// ---------------------------------------------------------------------------
// Full-page route wrapper
// ---------------------------------------------------------------------------
export function Report() {
  const { id } = useParams<{ id: string }>()
  if (!id) return <p className="p-8">Missing project id.</p>
  return (
    <div data-capture-hide className="mx-auto max-w-4xl space-y-4 px-6 py-8">
      <Link to={`/projects/${id}`} className="text-sm text-zinc-400 hover:text-zinc-200">
        ← back to code
      </Link>
      <ReportEditor projectId={id} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reusable editor (used by full-page route + right-panel tab)
// ---------------------------------------------------------------------------
export function ReportEditor({
  projectId,
  compact = false,
  toolbarExtra,
}: {
  projectId: string
  /** Compact = embedded in narrow side panel; smaller title, denser toolbar. */
  compact?: boolean
  /** Optional content rendered at the end of the toolbar (e.g. "Open in full tab"). */
  toolbarExtra?: ReactNode
}) {
  const api = useApi()
  const auth = useAuth()

  const [title, setTitle] = useState('Malware Analysis Report')
  const [sections, setSections] = useState<ReportSection[]>([])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [populatingId, setPopulatingId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [publishedAt, setPublishedAt] = useState<string | null>(null)
  const [publishBusy, setPublishBusy] = useState(false)
  const [reportId, setReportId] = useState<string | null>(null)
  const [communityPublishedAt, setCommunityPublishedAt] = useState<string | null>(null)
  const [malwareType, setMalwareType] = useState<string | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [communityModalOpen, setCommunityModalOpen] = useState(false)
  const [communityBusy, setCommunityBusy] = useState(false)
  const locked = !!publishedAt
  const inCommunity = !!communityPublishedAt

  function applyResponse(r: ReportResponse) {
    setReportId(r.id)
    setTitle(r.title)
    setSections(r.sections)
    setLastSavedAt(r.updatedAt)
    setPublishedAt(r.publishedAt)
    setCommunityPublishedAt(r.communityPublishedAt)
    setMalwareType(r.malwareType)
    setTags(r.tags ?? [])
    setDirty(false)
  }

  // Stash `api` in a ref so a token refresh (which rebuilds the api
  // callback every ~5min) doesn't re-trigger the effect below. The old
  // [api, projectId] deps caused the editor to silently refetch and
  // clobber unsaved edits whenever OIDC quietly renewed the token.
  const apiRef = useRef(api)
  useEffect(() => { apiRef.current = api })

  useEffect(() => {
    let cancelled = false
    apiRef.current<ReportResponse>(`/api/projects/${projectId}/report`)
      .then(r => { if (!cancelled) applyResponse(r) })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId])

  // Browser-level safety net: if the user closes the tab / navigates
  // away while dirty, prompt them rather than silently dropping work.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const updateSection = useCallback((sectionId: string, content: string) => {
    setSections(prev => prev.map(s => s.id === sectionId ? { ...s, content } : s))
    setDirty(true)
  }, [])

  const renameSection = useCallback((sectionId: string, title: string) => {
    setSections(prev => prev.map(s => s.id === sectionId ? { ...s, title } : s))
    setDirty(true)
  }, [])

  const addSection = useCallback(() => {
    setSections(prev => {
      const id = nextSectionId(prev)
      return [...prev, { id, title: 'New Section', content: '' }]
    })
    setDirty(true)
  }, [])

  const deleteSection = useCallback((sectionId: string) => {
    setSections(prev => prev.filter(s => s.id !== sectionId))
    setDirty(true)
  }, [])

  const moveSection = useCallback((sectionId: string, dir: -1 | 1) => {
    setSections(prev => {
      const i = prev.findIndex(s => s.id === sectionId)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = prev.slice()
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
    setDirty(true)
  }, [])

  // -------- template apply / save-as ---------------------------------------
  const [applyOpen, setApplyOpen] = useState(false)
  const [saveAsOpen, setSaveAsOpen] = useState(false)

  async function publish() {
    setPublishBusy(true)
    setError(null)
    try {
      applyResponse(await api<ReportResponse>(`/api/projects/${projectId}/report/publish`, { method: 'POST' }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPublishBusy(false)
    }
  }

  async function publishToCommunity(payload: { malwareType: string | null; tags: string[] }) {
    setCommunityBusy(true)
    setError(null)
    try {
      applyResponse(await api<ReportResponse>(
        `/api/projects/${projectId}/report/community/publish`,
        { method: 'POST', body: JSON.stringify(payload) },
      ))
      setCommunityModalOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCommunityBusy(false)
    }
  }

  async function unpublishFromCommunity() {
    if (!confirm('Remove this report from the community feed? The locked report stays — only its public visibility is revoked.')) return
    setCommunityBusy(true)
    setError(null)
    try {
      applyResponse(await api<ReportResponse>(
        `/api/projects/${projectId}/report/community/unpublish`,
        { method: 'POST' },
      ))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCommunityBusy(false)
    }
  }

  async function unpublish() {
    if (!confirm('Unpublish this report? Sections will become editable again.')) return
    setPublishBusy(true)
    setError(null)
    try {
      applyResponse(await api<ReportResponse>(`/api/projects/${projectId}/report/unpublish`, { method: 'POST' }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPublishBusy(false)
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      applyResponse(await api<ReportResponse>(`/api/projects/${projectId}/report`, {
        method: 'PUT',
        body: JSON.stringify({ title, sections }),
      }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function populate(sectionId: string) {
    setPopulatingId(sectionId)
    setError(null)
    try {
      applyResponse(await api<ReportResponse>(`/api/projects/${projectId}/report/populate`, {
        method: 'POST',
        body: JSON.stringify({ sectionId }),
      }))
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(e.message.includes('published')
          ? 'Report is published. Unpublish first to edit.'
          : 'No analysis result cached. Run an analysis from the Analysis tab first, then come back.')
      } else {
        setError((e as Error).message)
      }
    } finally {
      setPopulatingId(null)
    }
  }

  async function download() {
    const token = auth.user?.access_token
    const resp = await fetch(`${API_BASE}/api/projects/${projectId}/report/export.md`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!resp.ok) {
      setError(`Download failed: ${resp.status} ${resp.statusText}`)
      return
    }
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `openapk-report-${projectId}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const titleCls = compact
    ? 'flex-1 min-w-40 rounded border border-transparent bg-transparent px-2 py-1 text-base font-semibold text-zinc-100 hover:border-zinc-700 focus:border-purple-500 focus:outline-none'
    : 'flex-1 min-w-50 rounded border border-transparent bg-transparent px-2 py-1 text-2xl font-semibold text-zinc-100 hover:border-zinc-700 focus:border-purple-500 focus:outline-none'

  const btnPrimary = compact
    ? 'rounded bg-purple-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50'
    : 'rounded bg-purple-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50'

  const btnSecondary = compact
    ? 'rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800'
    : 'rounded border border-zinc-700 px-4 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800'

  return (
    <div className={compact ? 'space-y-3' : 'space-y-6'}>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={title}
            onChange={e => { setTitle(e.target.value); setDirty(true) }}
            disabled={locked}
            className={`${titleCls} disabled:opacity-70`}
          />
          {toolbarExtra}
        </div>
        <div className={`mt-2 flex flex-wrap items-center gap-2 ${compact ? 'text-[11px]' : 'text-xs'} text-zinc-500`}>
          <span className="flex-1">
            {locked
              ? <>Published {publishedAt ? new Date(publishedAt).toLocaleString() : ''}</>
              : dirty ? 'Unsaved changes' : lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}` : ''}
          </span>
          {!locked && (
            <button onClick={save} disabled={saving || !dirty} className={btnPrimary}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          {!locked && (
            <>
              <button
                onClick={() => setApplyOpen(true)}
                className={btnSecondary}
                title="Replace this report's sections with a saved template"
              >
                Apply template…
              </button>
              <button
                onClick={() => setSaveAsOpen(true)}
                disabled={sections.length === 0}
                className={btnSecondary}
                title="Save the current sections as a reusable template"
              >
                Save as template…
              </button>
            </>
          )}
          <button onClick={download} className={btnSecondary}>
            Download .md
          </button>
          <a
            href={`/projects/${projectId}/report/print`}
            target="_blank"
            rel="noopener noreferrer"
            className={btnSecondary}
            title="Open the print-friendly view in a new tab — use the browser's Save as PDF from there"
          >
            🖨 PDF
          </a>
          {locked ? (
            <button
              onClick={unpublish}
              disabled={publishBusy}
              className={compact
                ? 'rounded border border-amber-600 bg-amber-700/30 px-2.5 py-1 text-xs font-medium text-amber-100 hover:bg-amber-700/50 disabled:opacity-50'
                : 'rounded border border-amber-600 bg-amber-700/30 px-4 py-1.5 text-sm font-medium text-amber-100 hover:bg-amber-700/50 disabled:opacity-50'}
            >
              {publishBusy ? 'Unpublishing…' : 'Unpublish'}
            </button>
          ) : (
            <button
              onClick={publish}
              disabled={publishBusy || dirty}
              title={dirty ? 'Save first, then publish' : 'Mark report as final'}
              className={compact
                ? 'rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50'
                : 'rounded bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50'}
            >
              {publishBusy ? 'Publishing…' : 'Publish'}
            </button>
          )}
          {/* Community publish is only meaningful AFTER the report is
              finalized (locked). Hide entirely while drafting so the
              author can't share a half-written report by mistake. */}
          {locked && !inCommunity && (
            <button
              onClick={() => setCommunityModalOpen(true)}
              disabled={communityBusy}
              title="Share this report in the public Community feed"
              className={compact
                ? 'rounded border border-purple-600 bg-purple-900/40 px-2.5 py-1 text-xs font-medium text-purple-100 hover:bg-purple-900/60 disabled:opacity-50'
                : 'rounded border border-purple-600 bg-purple-900/40 px-4 py-1.5 text-sm font-medium text-purple-100 hover:bg-purple-900/60 disabled:opacity-50'}
            >
              🌐 Share with community
            </button>
          )}
          {inCommunity && (
            <button
              onClick={unpublishFromCommunity}
              disabled={communityBusy}
              title="Remove this report from the public Community feed"
              className={compact
                ? 'rounded border border-zinc-600 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50'
                : 'rounded border border-zinc-600 bg-zinc-800 px-4 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50'}
            >
              {communityBusy ? 'Removing…' : 'Remove from community'}
            </button>
          )}
        </div>
        {locked && !inCommunity && (
          <div className="mt-2 rounded border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
            🔒 This report is published and read-only. Click <strong>Unpublish</strong> to reopen for edits, or <strong>Share with community</strong> to publish it publicly.
          </div>
        )}
        {inCommunity && reportId && (
          <div className="mt-2 rounded border border-purple-900/60 bg-purple-950/30 px-3 py-2 text-xs text-purple-200">
            🌐 Live in the <Link to={`/community/reports/${reportId}`} className="underline">Community feed</Link>
            {malwareType && <> · <span className="font-medium">{malwareType}</span></>}
            {tags.length > 0 && <> · {tags.map(t => `#${t}`).join(' ')}</>}
            {' '}· Anyone with the link can view it.
          </div>
        )}
      </div>

      {error && (
        <div className="rounded border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : (
        <div className={compact ? 'space-y-3' : 'space-y-4'}>
          {sections.map((section, idx) => (
            <SectionCard
              key={section.id}
              projectId={projectId}
              section={section}
              compact={compact}
              locked={locked}
              collapsed={!!collapsed[section.id]}
              onToggle={() => setCollapsed(c => ({ ...c, [section.id]: !c[section.id] }))}
              onChange={content => updateSection(section.id, content)}
              onRename={title => renameSection(section.id, title)}
              onDelete={() => deleteSection(section.id)}
              onMoveUp={idx > 0 ? () => moveSection(section.id, -1) : null}
              onMoveDown={idx < sections.length - 1 ? () => moveSection(section.id, 1) : null}
              onPopulate={POPULATABLE.has(section.id) ? () => populate(section.id) : null}
              populating={populatingId === section.id}
            />
          ))}
          {!locked && (
            <button
              onClick={addSection}
              className="w-full rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            >
              + Add section
            </button>
          )}
        </div>
      )}

      {applyOpen && (
        <ApplyTemplateModal
          projectId={projectId}
          dirty={dirty}
          onClose={() => setApplyOpen(false)}
          onApplied={r => { applyResponse(r); setApplyOpen(false) }}
        />
      )}
      {saveAsOpen && (
        <SaveAsTemplateModal
          projectId={projectId}
          dirty={dirty}
          onClose={() => setSaveAsOpen(false)}
        />
      )}
      {communityModalOpen && (
        <CommunityPublishModal
          initialMalwareType={malwareType}
          initialTags={tags}
          busy={communityBusy}
          onClose={() => setCommunityModalOpen(false)}
          onSubmit={publishToCommunity}
        />
      )}
    </div>
  )
}

// Modal for "Share with community". Author picks STIX malware-type +
// up to 8 tags before the report becomes anonymously readable. We
// snapshot these values at publish-time on the backend, so changes here
// require re-running publishToCommunity (which we do every time the
// modal's submit fires — even on re-share, the new values overwrite).
function CommunityPublishModal({
  initialMalwareType,
  initialTags,
  busy,
  onClose,
  onSubmit,
}: {
  initialMalwareType: string | null
  initialTags: string[]
  busy: boolean
  onClose: () => void
  onSubmit: (p: { malwareType: string | null; tags: string[] }) => void
}) {
  const [malwareType, setMalwareType] = useState(initialMalwareType ?? '')
  const [tags, setTags] = useState<string[]>(initialTags)
  const [tagDraft, setTagDraft] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function addTagFromDraft() {
    const t = tagDraft.trim().toLowerCase()
    if (!t) return
    if (t.length > 32) { setErr('Tags must be 32 characters or fewer.'); return }
    if (tags.includes(t)) { setTagDraft(''); return }
    if (tags.length >= 8) { setErr('Maximum 8 tags.'); return }
    setTags([...tags, t])
    setTagDraft('')
    setErr(null)
  }

  function submit() {
    onSubmit({
      malwareType: malwareType || null,
      tags,
    })
  }

  return (
    <ModalShell title="Share with community" onClose={onClose}>
      <p className="mb-4 text-xs text-zinc-500">
        Your report will be visible to anyone on the internet, including signed-out visitors.
        Make sure you've reviewed our <Link to="/terms" target="_blank" className="text-purple-400 hover:underline">community terms</Link>.
      </p>

      <label className="block text-sm font-medium text-zinc-200">Malware type</label>
      <p className="mt-0.5 text-xs text-zinc-500">
        STIX 2.1 vocabulary — pick the closest fit, or leave as <em>unspecified</em>.
      </p>
      <select
        value={malwareType}
        onChange={(e) => setMalwareType(e.target.value)}
        className="mt-1.5 w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-purple-600 focus:outline-none"
      >
        <option value="">(unspecified)</option>
        {STIX_MALWARE_TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      <label className="mt-4 block text-sm font-medium text-zinc-200">Tags</label>
      <p className="mt-0.5 text-xs text-zinc-500">
        Up to 8, 32 chars each. Help others find your report by topic — <em>android-banking</em>, <em>obfuscated</em>, <em>c2-discovery</em>.
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="text"
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTagFromDraft() } }}
          placeholder="add a tag"
          maxLength={32}
          className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-purple-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={addTagFromDraft}
          className="rounded border border-zinc-700 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800"
        >
          Add
        </button>
      </div>
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTags(tags.filter((x) => x !== t))}
              className="inline-flex items-center gap-1 rounded-full border border-purple-700 bg-purple-950/40 px-2.5 py-0.5 text-[11px] text-purple-200 hover:bg-purple-900/40"
              title="Click to remove"
            >
              #{t}
              <span className="text-purple-400">×</span>
            </button>
          ))}
        </div>
      )}

      {err && <p className="mt-3 text-xs text-red-400">{err}</p>}

      <div className="mt-6 flex items-center justify-end gap-2 border-t border-zinc-800 pt-4">
        <button
          onClick={onClose}
          className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="rounded border border-purple-700 bg-purple-900/40 px-4 py-1.5 text-sm text-purple-100 hover:bg-purple-800/60 disabled:opacity-50"
        >
          {busy ? 'Publishing…' : '🌐 Publish to community'}
        </button>
      </div>
    </ModalShell>
  )
}

function SectionCard({
  projectId, section, compact, locked, collapsed, onToggle, onChange, onRename, onDelete, onMoveUp, onMoveDown, onPopulate, populating,
}: {
  projectId: string
  section: ReportSection
  compact: boolean
  locked: boolean
  collapsed: boolean
  onToggle: () => void
  onChange: (content: string) => void
  onRename: (title: string) => void
  onDelete: () => void
  onMoveUp: (() => void) | null
  onMoveDown: (() => void) | null
  onPopulate: (() => void) | null
  populating: boolean
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)

  function insertAtCursor(text: string) {
    const ta = taRef.current
    if (!ta) {
      onChange(section.content + text)
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const next = section.content.slice(0, start) + text + section.content.slice(end)
    onChange(next)
    queueMicrotask(() => {
      ta.focus()
      const pos = start + text.length
      ta.setSelectionRange(pos, pos)
    })
  }

  // Find unique image URLs in the section content for the thumbnail strip.
  const imageUrls = Array.from(new Set(
    [...section.content.matchAll(/!\[[^\]]*]\(([^)\s]+)\)/g)].map(m => m[1]),
  ))

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <button
          onClick={onToggle}
          className="shrink-0 text-zinc-500 hover:text-zinc-300"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        {editingTitle && !locked ? (
          <input
            autoFocus
            defaultValue={section.title}
            onBlur={e => { onRename(e.target.value || section.title); setEditingTitle(false) }}
            onKeyDown={e => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setEditingTitle(false)
            }}
            className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 focus:border-purple-500 focus:outline-none"
          />
        ) : (
          <button
            onClick={() => !locked && setEditingTitle(true)}
            className="flex-1 truncate text-left text-sm font-medium text-zinc-200 hover:text-zinc-50"
            title={locked ? section.title : 'Click to rename'}
          >
            {section.title}
          </button>
        )}
        {!collapsed && !locked && (
          <>
            <button
              onClick={() => setPickerOpen(true)}
              title="Insert a screenshot from the Gallery"
              className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800"
            >
              🖼 Insert
            </button>
            <button
              onClick={() => setPreview(p => !p)}
              title={preview ? 'Edit markdown' : 'Preview rendered'}
              className={`shrink-0 rounded border px-2 py-1 text-[11px] ${
                preview
                  ? 'border-purple-600 bg-purple-700/30 text-purple-100'
                  : 'border-zinc-700 text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              {preview ? '✎ Edit' : '👁 Preview'}
            </button>
          </>
        )}
        {onPopulate && !collapsed && !locked && (
          <button
            onClick={onPopulate}
            disabled={populating}
            className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
            title="Replace this section's content with formatted output from the latest analysis"
          >
            {populating ? 'Pulling…' : 'Pull from analysis'}
          </button>
        )}
        {!locked && (
          <>
            <button
              onClick={onMoveUp ?? undefined}
              disabled={!onMoveUp}
              title="Move up"
              className="shrink-0 rounded border border-zinc-700 px-1.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
            >
              ↑
            </button>
            <button
              onClick={onMoveDown ?? undefined}
              disabled={!onMoveDown}
              title="Move down"
              className="shrink-0 rounded border border-zinc-700 px-1.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
            >
              ↓
            </button>
            <button
              onClick={() => {
                if (section.content.trim() && !confirm(`Delete section "${section.title}" and its content?`)) return
                onDelete()
              }}
              title="Delete section"
              className="shrink-0 rounded border border-red-900/60 px-1.5 py-1 text-[11px] text-red-300 hover:bg-red-950/40"
            >
              ✕
            </button>
          </>
        )}
      </div>

      {!collapsed && (
        (preview || locked) ? (
          <div className="markdown-answer p-3 text-sm text-zinc-200">
            <ReactMarkdown
              components={{
                img: ({ src, alt }) => (
                  <AuthenticatedImg
                    src={typeof src === 'string' ? src : ''}
                    alt={alt}
                    className="my-2 max-w-full rounded border border-zinc-800"
                  />
                ),
              }}
            >
              {section.content || '_(empty)_'}
            </ReactMarkdown>
          </div>
        ) : (
          <>
            <textarea
              ref={taRef}
              value={section.content}
              onChange={e => onChange(e.target.value)}
              placeholder="Markdown content…"
              rows={Math.max(compact ? 4 : 6, section.content.split('\n').length + 1)}
              className="block w-full resize-y border-0 bg-transparent p-3 font-mono text-[13px] leading-6 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
            {imageUrls.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-zinc-800 p-2">
                {imageUrls.map(u => (
                  <AuthenticatedImg
                    key={u}
                    src={u}
                    className="h-16 w-auto rounded border border-zinc-800"
                  />
                ))}
              </div>
            )}
          </>
        )
      )}

      {pickerOpen && (
        <GalleryPickerModal
          projectId={projectId}
          onClose={() => setPickerOpen(false)}
          onPick={url => {
            insertAtCursor(`\n\n![screenshot](${url})\n\n`)
            setPickerOpen(false)
          }}
        />
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Apply-template modal — pick from the user's saved templates
// ---------------------------------------------------------------------------
function ApplyTemplateModal({
  projectId, dirty, onClose, onApplied,
}: {
  projectId: string
  dirty: boolean
  onClose: () => void
  onApplied: (r: ReportResponse) => void
}) {
  const api = useApi()
  const [templates, setTemplates] = useState<ReportTemplate[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [replaceTitle, setReplaceTitle] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api<ReportTemplate[]>('/api/report-templates')
      .then(r => { if (!cancelled) { setTemplates(r); if (r.length > 0) setSelectedId(r[0].id) } })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
    return () => { cancelled = true }
  }, [api])

  async function handleApply() {
    if (!selectedId) return
    setApplying(true)
    setError(null)
    try {
      const updated = await api<ReportResponse>(`/api/projects/${projectId}/report/apply-template`, {
        method: 'POST',
        body: JSON.stringify({ templateId: selectedId, replaceTitle }),
      })
      onApplied(updated)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message)
    } finally {
      setApplying(false)
    }
  }

  const selected = templates?.find(t => t.id === selectedId) ?? null

  return (
    <ModalShell title="Apply template" onClose={onClose}>
      {templates === null ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : templates.length === 0 ? (
        <p className="text-zinc-400 text-sm">
          No templates yet. Save the current report as a template first, or visit{' '}
          <Link to="/settings/report-templates" className="text-purple-300 underline">Templates</Link>{' '}
          to create one.
        </p>
      ) : (
        <>
          {dirty && (
            <p className="rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
              You have unsaved changes — applying a template will overwrite them.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
            <ul className="max-h-72 overflow-y-auto rounded border border-zinc-800 bg-zinc-950/40">
              {templates.map(t => (
                <li key={t.id}>
                  <button
                    onClick={() => setSelectedId(t.id)}
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm ${
                      t.id === selectedId
                        ? 'bg-purple-900/30 text-purple-100'
                        : 'text-zinc-200 hover:bg-zinc-900'
                    }`}
                  >
                    <span className="font-medium">{t.name}</span>
                    <span className="text-[11px] uppercase tracking-wide text-zinc-500">
                      {t.mode === 'ANY' ? 'any mode' : t.mode.replace('_', ' ').toLowerCase()}
                      {' · '}{t.sections.length} sections
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="space-y-2 text-sm">
              {selected ? (
                <>
                  {selected.description && (
                    <p className="text-zinc-400">{selected.description}</p>
                  )}
                  <p className="text-xs text-zinc-500">Sections in template:</p>
                  <ol className="list-decimal pl-5 text-xs text-zinc-300">
                    {selected.sections.map(s => <li key={s.id}>{s.title}</li>)}
                  </ol>
                </>
              ) : (
                <p className="text-zinc-500 text-sm">Pick a template to preview its sections.</p>
              )}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={replaceTitle}
              onChange={e => setReplaceTitle(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-950"
            />
            Also replace report title with the template name
          </label>
        </>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800">
          Cancel
        </button>
        <button
          onClick={handleApply}
          disabled={applying || !selectedId}
          className="rounded bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
        >
          {applying ? 'Applying…' : 'Apply'}
        </button>
      </div>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Save-as-template modal — snapshot the current sections into a new template
// ---------------------------------------------------------------------------
function SaveAsTemplateModal({
  projectId, dirty, onClose,
}: {
  projectId: string
  dirty: boolean
  onClose: () => void
}) {
  const api = useApi()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [mode, setMode] = useState<TemplateMode>('ANY')
  const [blankContent, setBlankContent] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const r = await api<ReportTemplate>(`/api/projects/${projectId}/report/save-as-template`, {
        method: 'POST',
        body: JSON.stringify({ name, description, mode, blankContent }),
      })
      setSavedId(r.id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title="Save as template" onClose={onClose}>
      {savedId ? (
        <>
          <p className="text-sm text-emerald-300">
            Saved. Visit{' '}
            <Link to="/settings/report-templates" className="underline">Templates</Link>{' '}
            to edit, or apply it to any project.
          </p>
          <div className="flex justify-end">
            <button onClick={onClose} className="rounded bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-500">
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          {dirty && (
            <p className="rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
              Note: the template snapshots what's currently on the server. Save unsaved changes first if you want them included.
            </p>
          )}
          <label className="block text-xs text-zinc-400">
            Name
            <input
              autoFocus
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Standard mobile-banking MAR"
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
            />
          </label>
          <label className="block text-xs text-zinc-400">
            Description (optional)
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
            />
          </label>
          <label className="block text-xs text-zinc-400">
            Mode (UI hint for the template picker)
            <select
              value={mode}
              onChange={e => setMode(e.target.value as TemplateMode)}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
            >
              <option value="ANY">Any mode</option>
              <option value="MALWARE">Malware (MAR)</option>
              <option value="VULN_RESEARCH">Vulnerability research (VRR)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={blankContent}
              onChange={e => setBlankContent(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-950"
            />
            Clear section content (save only titles + section ids)
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="rounded bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  )
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl space-y-4 rounded-lg border border-zinc-800 bg-zinc-950 p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
