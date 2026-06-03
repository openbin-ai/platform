import { useCallback, useEffect, useState } from 'react'
import { ApiError, useApi } from '../api/client'

type ReportSection = { id: string; title: string; content: string }
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

function nextSectionId(existing: ReportSection[]): string {
  const used = new Set(existing.map(s => s.id))
  let n = existing.filter(s => s.id.startsWith('custom_')).length + 1
  let id = `custom_${n}`
  while (used.has(id)) id = `custom_${++n}`
  return id
}

export function ReportTemplates() {
  const api = useApi()
  const [templates, setTemplates] = useState<ReportTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ReportTemplate | 'new' | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setTemplates(await api<ReportTemplate[]>('/api/report-templates'))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { void refresh() }, [refresh])

  async function handleDelete(t: ReportTemplate) {
    if (!confirm(`Delete template "${t.name}"?`)) return
    try {
      await api(`/api/report-templates/${t.id}`, { method: 'DELETE' })
      setTemplates(prev => prev.filter(x => x.id !== t.id))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (editing) {
    return (
      <TemplateEditor
        initial={editing === 'new' ? null : editing}
        onCancel={() => setEditing(null)}
        onSaved={() => { setEditing(null); void refresh() }}
      />
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Report templates</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Named, reusable section sets. Apply one to any project's report from the report
            editor. Templates are user-scoped — only you can see or apply yours.
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="shrink-0 rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500"
        >
          + New template
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-900/60 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-zinc-500">Loading…</p>
      ) : templates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 p-8 text-center">
          <p className="text-zinc-300">No templates yet.</p>
          <p className="mt-1 text-sm text-zinc-500">
            Create one here, or save a project's current report from its report editor.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/40">
          {templates.map(t => (
            <li key={t.id} className="flex items-start gap-4 p-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-zinc-100">{t.name}</span>
                  <span className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] uppercase tracking-wide text-zinc-300">
                    {t.mode === 'ANY' ? 'any' : t.mode.replace('_', ' ').toLowerCase()}
                  </span>
                  <span className="text-xs text-zinc-500">{t.sections.length} sections</span>
                </div>
                {t.description && (
                  <p className="mt-1 text-sm text-zinc-400">{t.description}</p>
                )}
                <p className="mt-1 text-[11px] text-zinc-500">
                  Updated {new Date(t.updatedAt).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => setEditing(t)}
                className="rounded border border-zinc-700 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(t)}
                className="rounded border border-red-900/60 px-3 py-1 text-sm text-red-300 hover:bg-red-950/40"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline editor — same shape for create + edit
// ---------------------------------------------------------------------------
function TemplateEditor({
  initial, onCancel, onSaved,
}: {
  initial: ReportTemplate | null
  onCancel: () => void
  onSaved: () => void
}) {
  const api = useApi()
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [mode, setMode] = useState<TemplateMode>(initial?.mode ?? 'ANY')
  const [sections, setSections] = useState<ReportSection[]>(initial?.sections ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addSection() {
    setSections(prev => [...prev, { id: nextSectionId(prev), title: 'New Section', content: '' }])
  }
  function deleteSection(id: string) {
    setSections(prev => prev.filter(s => s.id !== id))
  }
  function move(id: string, dir: -1 | 1) {
    setSections(prev => {
      const i = prev.findIndex(s => s.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = prev.slice()
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  function update(id: string, patch: Partial<ReportSection>) {
    setSections(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const body = { name: name.trim(), description: description.trim() || null, mode, sections }
      if (initial) {
        await api(`/api/report-templates/${initial.id}`, { method: 'PUT', body: JSON.stringify(body) })
      } else {
        await api('/api/report-templates', { method: 'POST', body: JSON.stringify(body) })
      }
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-zinc-100">
          {initial ? `Edit template — ${initial.name}` : 'New template'}
        </h1>
        <div className="flex gap-2">
          <button onClick={onCancel} className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="rounded bg-purple-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-900/60 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block text-xs text-zinc-400">
          Name
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Standard mobile-banking MAR"
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
          />
        </label>
        <label className="block text-xs text-zinc-400">
          Mode
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
        <label className="block text-xs text-zinc-400 md:col-span-2">
          Description (optional)
          <textarea
            value={description ?? ''}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
          />
        </label>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
            Sections ({sections.length})
          </h2>
        </div>
        {sections.length === 0 ? (
          <p className="rounded border border-dashed border-zinc-800 bg-zinc-900/40 px-4 py-6 text-center text-sm text-zinc-500">
            No sections yet. Add one below.
          </p>
        ) : (
          <ol className="space-y-3">
            {sections.map((s, idx) => (
              <li key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40">
                <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
                  <span className="text-xs text-zinc-500">{idx + 1}.</span>
                  <input
                    value={s.title}
                    onChange={e => update(s.id, { title: e.target.value })}
                    placeholder="Section title"
                    className="flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-zinc-100 hover:border-zinc-700 focus:border-purple-500 focus:outline-none"
                  />
                  <span className="font-mono text-[11px] text-zinc-500">id: {s.id}</span>
                  <button
                    onClick={() => move(s.id, -1)}
                    disabled={idx === 0}
                    title="Move up"
                    className="shrink-0 rounded border border-zinc-700 px-1.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
                  >↑</button>
                  <button
                    onClick={() => move(s.id, 1)}
                    disabled={idx === sections.length - 1}
                    title="Move down"
                    className="shrink-0 rounded border border-zinc-700 px-1.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
                  >↓</button>
                  <button
                    onClick={() => {
                      if (s.content.trim() && !confirm(`Delete section "${s.title}" and its starter content?`)) return
                      deleteSection(s.id)
                    }}
                    title="Delete section"
                    className="shrink-0 rounded border border-red-900/60 px-1.5 py-1 text-[11px] text-red-300 hover:bg-red-950/40"
                  >✕</button>
                </div>
                <textarea
                  value={s.content}
                  onChange={e => update(s.id, { content: e.target.value })}
                  rows={4}
                  placeholder="Optional starter content (Markdown). Leave empty for a blank slate when applied."
                  className="block w-full resize-y border-0 bg-transparent p-3 font-mono text-[13px] leading-6 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </li>
            ))}
          </ol>
        )}
        <button
          onClick={addSection}
          className="w-full rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
        >
          + Add section
        </button>
      </section>
    </div>
  )
}
