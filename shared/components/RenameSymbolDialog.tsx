import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ApiError, useApi } from '@shared/api/client'

/**
 * Rename a symbol by hand — no LLM, no credential, no suggest/review
 * round trip. The analyst reading the code usually already knows what
 * `uVar1` is; making them spend a model call to be told is the wrong
 * default.
 *
 * Posts to `POST /api/projects/{id}/renames/manual`, which upserts the row
 * already APPLIED. `scopeRef` is REQUIRED when `scope` is `variable`:
 * decompilers reuse names like `uVar1` in nearly every function, so a
 * variable rename is stored against its owning function and applied only
 * there. SCRIPT symbols pass the file path instead. Omitting it makes the
 * rename project-wide, which is what function/class/method names want.
 */
export function RenameSymbolDialog({
  projectId,
  original,
  scope,
  scopeRef,
  title,
  hint,
  onClose,
  onRenamed,
}: {
  projectId: string
  original: string
  /**
   * Pick 'variable' ONLY for a decompiled-function local: the backend
   * treats that scope specially and stores scopeRef as "function:<name>".
   * Script/file-scoped identifiers use 'symbol', which stores scopeRef
   * verbatim.
   */
  scope: 'variable' | 'symbol' | 'function' | 'class' | 'method' | 'field'
  /**
   * Container this rename is scoped to: the owning function for BIN
   * variables (required), or the file path for SCRIPT symbols. Omit for
   * project-wide renames.
   */
  scopeRef?: string
  title?: string
  hint?: string
  onClose: () => void
  onRenamed: (newName: string) => void | Promise<void>
}) {
  const api = useApi()
  const [draft, setDraft] = useState(original)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === original) { onClose(); return }
    // Cheap client-side guard so an obviously-invalid identifier doesn't
    // cost a round trip. The backend stores whatever it's given (renames
    // are display-layer only), so this is UX, not enforcement.
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed)) {
      setError('Use a valid identifier: letters, digits, _ or $, not starting with a digit.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api(`/api/projects/${projectId}/renames/manual`, {
        method: 'POST',
        body: JSON.stringify({
          original,
          suggested: trimmed,
          scope,
          ...(scopeRef ? { scopeRef } : {}),
        }),
      })
      await onRenamed(trimmed)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message)
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-start justify-center p-4 pt-[20vh]"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <form
        onSubmit={(e) => { e.preventDefault(); void save() }}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border border-zinc-700 p-4 shadow-2xl"
        style={{ backgroundColor: '#18181b' }}
      >
        <h2 className="text-sm font-semibold text-zinc-100">
          {title ?? `Rename ${scope}`}
        </h2>
        <p className="mt-1 truncate font-mono text-[11px] text-zinc-500" title={original}>
          {original}
          {scopeRef && <span className="text-zinc-600"> · in {scopeRef}</span>}
        </p>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setError(null) }}
          disabled={busy}
          spellCheck={false}
          className="mt-3 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-[13px] text-zinc-100 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
        />
        <p className="mt-1.5 text-[11px] text-zinc-500">
          {hint ?? (scopeRef
            ? `Applies inside ${scopeRef} only — the same name elsewhere is untouched.`
            : 'Applies everywhere this symbol appears.')}
        </p>
        {error && <p className="mt-2 font-mono text-[11px] text-red-400">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded px-3 py-1 text-[12px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !draft.trim() || draft.trim() === original}
            className="rounded bg-purple-600 px-3 py-1 text-[12px] font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Renaming…' : 'Rename'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
