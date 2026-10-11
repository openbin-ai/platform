import { useCallback, useEffect, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { useApi } from '@shared/api/client'
import { setMeCache } from '@shared/api/me'
import { EmailPreferences } from '@shared/components/EmailPreferences'
import { DmPrivacySettings } from '@shared/components/dm/DmPrivacySettings'
import { Gravatar } from '@shared/components/Gravatar'

// Self-profile settings — currently just display_name (the public label
// shown next to community-published reports). Email comes from Keycloak
// and isn't editable here; it's shown read-only so the user knows which
// account they're configuring.
//
// The display name is the ONE thing community readers see attached to
// your published work; the rest of your profile is private.
type Me = { userId: string; displayName: string | null; email: string | null; emailMd5: string; creditPublicly: boolean }

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
      setMeCache(updated)
      setSavedAt(Date.now())
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [api, draft])

  // Toggle the public-credit opt-out. Sends the current display name too so
  // the PATCH (which resets a null/absent name) doesn't wipe it.
  const setCredit = useCallback(async (next: boolean) => {
    if (!me) return
    setErr(null)
    try {
      const updated = await api<Me>('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: me.displayName, creditPublicly: next }),
      })
      setMe(updated)
      setMeCache(updated)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    }
  }, [api, me])

  // Clear the "saved" toast after 2 seconds.
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
              Avatar from Gravatar — set one at <a href="https://gravatar.com" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">gravatar.com</a> using your sign-in email.
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
          className="mt-2 w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-purple-600 focus:outline-none"
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
              className="rounded border border-purple-700 bg-purple-950/60 px-4 py-1.5 text-sm text-purple-200 hover:bg-purple-900/60 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
      </section>

      <section className="mt-6 rounded border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-zinc-200">Public credit</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Credit me in the contributor byline of reports I help with. Turn off to stay
              off public bylines — your work still counts, you just won't be listed.
              Reports you own and publish always credit you as lead.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={me.creditPublicly}
            onClick={() => void setCredit(!me.creditPublicly)}
            className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${me.creditPublicly ? 'bg-purple-600' : 'bg-zinc-700'}`}
            title={me.creditPublicly ? 'Public credit on' : 'Public credit off'}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${me.creditPublicly ? 'left-5.5' : 'left-0.5'}`} />
          </button>
        </div>
      </section>

      <EmailPreferences accent="purple" />

      <DmPrivacySettings accent="purple" />

      <AccountDangerZone email={me.email} />
    </div>
  )
}

// Irreversible account deletion. Kept as a separate component so its own
// confirm/busy/error state doesn't tangle with the profile form above. The
// backend hard-deletes private data (projects + uploaded bytes, BYOK keys,
// audit log, usage) and anonymizes public contributions (published reports,
// blog posts) rather than deleting them. Styling is red regardless of brand
// accent — this is a danger zone in both apps.
function AccountDangerZone({ email }: { email: string | null }) {
  const api = useApi()
  const auth = useAuth()
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const typed = confirm.trim()
  const canDelete =
    typed.toUpperCase() === 'DELETE' ||
    (!!email && typed.toLowerCase() === email.toLowerCase())

  const remove = useCallback(async () => {
    setBusy(true)
    setErr(null)
    try {
      await api('/api/account', {
        method: 'DELETE',
        body: JSON.stringify({ confirm: typed }),
      })
      // Account is gone. Clear the local OIDC session and leave; the Keycloak
      // user may already be deleted, so removeUser (local-only) is the reliable
      // way out — signoutRedirect could hit a now-missing session.
      try {
        await auth.removeUser()
      } catch {
        /* ignore — we're navigating away regardless */
      }
      window.location.href = '/'
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Deletion failed')
      setBusy(false)
    }
  }, [api, auth, typed])

  return (
    <section className="mt-10 rounded border border-red-900/60 bg-red-950/20 p-4">
      <h2 className="text-sm font-medium text-red-300">Delete account</h2>
      <p className="mt-1 text-xs text-zinc-400">
        Permanently deletes your account and all private data — your projects and
        uploaded files, decompiled output, saved AI credentials, and usage history.
        Anything you published to the community (reports, blog posts) is kept but
        anonymized. <span className="text-red-300">This cannot be undone.</span>
      </p>
      <label className="mt-3 block text-xs text-zinc-400">
        Type <span className="font-mono text-zinc-200">DELETE</span>
        {email ? <> (or your email) </> : ' '}
        to confirm:
      </label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="text"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="DELETE"
          autoComplete="off"
          className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-red-600 focus:outline-none"
        />
        <button
          onClick={() => void remove()}
          disabled={!canDelete || busy}
          className="rounded border border-red-700 bg-red-900/40 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-800/50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Deleting…' : 'Delete my account'}
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </section>
  )
}
