import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useApi } from '@shared/api/client'
import type { BundleDetail, BundleFile } from '../api/bundles'

/**
 * Bundle overview page (/bundles/:id) — the repo-style home for a multi-binary
 * sample. Lists every member binary with its metadata; clicking a row opens
 * that binary's ProjectView. Rename is inline; delete is destructive (removes
 * every member) behind a count-naming confirm.
 *
 * Bundles are CLI-created (openbin decompile ./dir / --bundle); the web app
 * lists, opens, renames, and deletes them but never creates them — hence the
 * "add a binary" hint shows the CLI command rather than an upload button.
 */
export function BundlePage() {
  const { id = '' } = useParams<{ id: string }>()
  const api = useApi()
  const navigate = useNavigate()

  const [bundle, setBundle] = useState<BundleDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const b = await api<BundleDetail>(`/api/bundles/${id}`)
      setBundle(b)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [api, id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Poll while any member is still decompiling so the overview flips to READY
  // without a manual refresh (a fresh sweep lands members one at a time).
  useEffect(() => {
    if (!bundle) return
    const anyPending = bundle.files.some(
      (f) => f.status === 'UPLOADED' || f.status === 'DECOMPILING' || f.status === 'INGEST_PENDING',
    )
    if (!anyPending) return
    const t = setInterval(() => { void refresh() }, 2000)
    return () => clearInterval(t)
  }, [bundle, refresh])

  async function saveName() {
    const trimmed = draftName.trim()
    setEditing(false)
    if (!bundle || !trimmed || trimmed === bundle.name) return
    try {
      const updated = await api<{ name: string }>(`/api/bundles/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: trimmed }),
      })
      setBundle((prev) => (prev ? { ...prev, name: updated.name } : prev))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function deleteBundle() {
    if (!bundle) return
    const n = bundle.files.length
    const msg =
      n === 0
        ? `Delete the empty bundle "${bundle.name}"?`
        : `Delete bundle "${bundle.name}"? This permanently deletes all ${n} binar${n === 1 ? 'y' : 'ies'} inside it and their analyses. This cannot be undone.`
    if (!confirm(msg)) return
    setBusy(true)
    try {
      await api(`/api/bundles/${id}`, { method: 'DELETE' })
      navigate('/projects')
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  if (loading) return <div className="px-6 py-8 text-sm text-zinc-500">Loading bundle…</div>

  if (error && !bundle) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="rounded border border-red-900/60 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
        <Link to="/projects" className="mt-4 inline-block text-sm text-amber-300 hover:underline">
          ← Back to projects
        </Link>
      </div>
    )
  }
  if (!bundle) return null

  const installHint = `openbin decompile --bundle "${bundle.name}" <file>`

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <Link to="/projects" className="text-xs text-zinc-500 hover:text-zinc-300">
        ← Projects
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden>🗂</span>
            {editing ? (
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveName()
                  else if (e.key === 'Escape') setEditing(false)
                }}
                className="min-w-0 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xl font-semibold text-zinc-100"
              />
            ) : (
              <h1 className="truncate text-2xl font-semibold text-zinc-100">{bundle.name}</h1>
            )}
            {!editing && (
              <button
                onClick={() => { setDraftName(bundle.name); setEditing(true) }}
                title="Rename bundle"
                className="text-sm text-zinc-500 hover:text-zinc-200"
              >
                ✎
              </button>
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {bundle.files.length} binar{bundle.files.length === 1 ? 'y' : 'ies'}
            {' · added '}{new Date(bundle.createdAt).toLocaleDateString()}
          </p>
        </div>
        <button
          onClick={deleteBundle}
          disabled={busy}
          className="shrink-0 rounded border border-red-900/60 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-40"
        >
          {busy ? 'Deleting…' : 'Delete bundle'}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-900/60 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Files */}
      {bundle.files.length === 0 ? (
        <p className="text-zinc-500">This bundle has no binaries yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/40">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-[11px] uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-2 font-medium">File</th>
                <th className="px-4 py-2 font-medium">Format</th>
                <th className="px-4 py-2 font-medium">Arch</th>
                <th className="px-4 py-2 font-medium">Size</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {bundle.files.map((f) => (
                <FileRow key={f.id} file={f} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add-a-binary hint (CLI-only in v1) */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Add a binary to this bundle
        </p>
        <pre className="mt-2 overflow-x-auto rounded border border-zinc-800 bg-black/40 p-3 font-mono text-[12px] text-amber-200">
{installHint}
        </pre>
        <p className="mt-2 text-xs text-zinc-500">
          Or sweep a whole folder: <span className="font-mono text-zinc-400">openbin decompile ./sample-dir</span>
        </p>
      </div>
    </div>
  )
}

function FileRow({ file }: { file: BundleFile }) {
  const ready = file.status === 'READY'
  return (
    <tr className="text-zinc-300">
      <td className="px-4 py-2.5">
        {ready ? (
          <Link
            to={`/projects/${file.id}`}
            className="font-medium text-zinc-100 hover:text-amber-300"
          >
            {file.name}
          </Link>
        ) : (
          <span className="font-medium text-zinc-400">{file.name}</span>
        )}
        {file.publicReadAt && (
          <span className="ml-2 rounded bg-emerald-950/60 px-1.5 py-0.5 text-[10px] uppercase text-emerald-300">
            public
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-zinc-400">{file.executableFormat ?? '—'}</td>
      <td className="px-4 py-2.5 text-zinc-400">{file.arch ?? '—'}</td>
      <td className="px-4 py-2.5 text-zinc-400">{formatBytes(file.sizeBytes)}</td>
      <td className="px-4 py-2.5">
        <StatusPill status={file.status} />
      </td>
      <td className="px-4 py-2.5 text-right">
        {ready && (
          <Link to={`/projects/${file.id}`} className="text-zinc-500 hover:text-amber-300" title="Open">
            →
          </Link>
        )}
      </td>
    </tr>
  )
}

function StatusPill({ status }: { status: BundleFile['status'] }) {
  const map: Record<BundleFile['status'], [string, string]> = {
    READY: ['ready', 'bg-emerald-950/60 text-emerald-300'],
    DECOMPILING: ['analyzing…', 'bg-amber-950/60 text-amber-300'],
    INGEST_PENDING: ['uploading…', 'bg-amber-950/60 text-amber-300'],
    UPLOADED: ['queued', 'bg-zinc-800 text-zinc-300'],
    FAILED: ['failed', 'bg-red-950/60 text-red-300'],
  }
  const [label, cls] = map[status]
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>{label}</span>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
