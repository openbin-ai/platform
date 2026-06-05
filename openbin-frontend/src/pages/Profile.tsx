import { useCallback, useEffect, useState } from 'react'
import { useApi } from '@shared/api/client'
import { EmailPreferences } from '@shared/components/EmailPreferences'
import { Gravatar } from '@shared/components/Gravatar'

// Self-profile settings — identical behavior to openapk-frontend's
// Profile page. The shared API endpoint /api/users/me serves both apps.
// Branding stays amber instead of purple.
type Me = { displayName: string | null; email: string | null; emailMd5: string }

export function Profile() {
  const api = useApi()
  const [me, setMe] = useState<Me | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api<Me>('/api/users/me')
      .then((r) => {
        if (cancelled) return
        setMe(r)
        setDraft(r.displayName ?? '')
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load profile')
      })
    return () => { cancelled = true }
  }, [api])

  const save = useCallback(async () => {
    setSaving(true)
    setErr(null)
    try {
      const updated = await api<Me>('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: draft.trim() || null }),
      })
      setMe(updated)
      setDraft(updated.displayName ?? '')
      setSavedAt(Date.now())
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [api, draft])

  useEffect(() => {
    if (savedAt == null) return
    const t = setTimeout(() => setSavedAt(null), 2000)
    return () => clearTimeout(t)
  }, [savedAt])

  if (!me) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        {err ? <p className="text-sm text-red-400">{err}</p> : <p className="text-sm text-zinc-500">Loading…</p>}
      </div>
    )
  }

  const dirty = (draft.trim() || null) !== (me.displayName ?? null)
  const previewName = draft.trim()
    || me.email?.split('@')[0]
    || 'anonymous researcher'

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="mb-1 text-xl font-semibold text-zinc-100">Profile</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Your display name appears next to any reports you publish to the community.
      </p>

      <section className="mb-6 rounded border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="mb-3 text-sm font-medium text-zinc-200">How you appear publicly</h2>
        <div className="flex items-center gap-3 rounded border border-zinc-800 bg-zinc-950 p-3">
          <Gravatar emailMd5={me.emailMd5} size={40} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-zinc-100">{previewName}</div>
            <div className="text-xs text-zinc-500">
              Avatar from Gravatar — set one at <a href="https://gravatar.com" target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline">gravatar.com</a> using your sign-in email.
            </div>
          </div>
        </div>
      </section>

      <section className="rounded border border-zinc-800 bg-zinc-900/40 p-4">
        <label className="block text-sm font-medium text-zinc-200">Display name</label>
        <p className="mt-0.5 text-xs text-zinc-500">
          Leave blank to fall back to the name in your sign-in profile.
        </p>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={60}
          placeholder={me.email?.split('@')[0] ?? 'anonymous researcher'}
          className="mt-2 w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
        />
        <div className="mt-3 flex items-center justify-between">
          <div className="text-xs text-zinc-500">
            Email: <span className="text-zinc-400">{me.email ?? '(none)'}</span>
          </div>
          <div className="flex items-center gap-3">
            {savedAt && <span className="text-xs text-emerald-400">Saved</span>}
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="rounded border border-amber-600 bg-amber-950/40 px-4 py-1.5 text-sm text-amber-200 hover:bg-amber-900/40 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
      </section>

      <EmailPreferences accent="amber" />
    </div>
  )
}
