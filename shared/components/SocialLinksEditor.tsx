import { useCallback, useEffect, useState } from 'react'
import { useApi } from '@shared/api/client'

/**
 * Bio + social links on the caller's public profile.
 *
 * Handles go in bare — the field strips a pasted "@" and the backend rejects
 * anything URL-shaped, because the rendered link is BUILT from the handle
 * (`https://github.com/${handle}`). A handle that could carry its own scheme
 * would be a hole; a handle that can only be a handle can't be.
 *
 * The two free-form URL fields can't work that way, so they're validated as
 * http(s) on the server and re-checked before rendering an href.
 */
type ProfileFields = {
  bio?: string | null
  websiteUrl?: string | null
  githubUser?: string | null
  xUser?: string | null
  mastodonUrl?: string | null
  linkedinUrl?: string | null
}

export function SocialLinksEditor({
  kind,
  accent = 'purple',
}: {
  /** Product surface — the profile endpoint is per-kind. */
  kind: 'BIN' | 'APK'
  accent?: 'purple' | 'amber'
}) {
  const api = useApi()
  const [fields, setFields] = useState<ProfileFields | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const me = await api<{ userId: string }>('/api/users/me')
        const profile = await api<ProfileFields>(`/api/community/users/${me.userId}/profile/${kind}`)
        setFields({
          bio: profile.bio ?? '',
          websiteUrl: profile.websiteUrl ?? '',
          githubUser: profile.githubUser ?? '',
          xUser: profile.xUser ?? '',
          mastodonUrl: profile.mastodonUrl ?? '',
          linkedinUrl: profile.linkedinUrl ?? '',
        })
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load profile')
      }
    })()
  }, [api, kind])

  useEffect(() => {
    if (savedAt == null) return
    const t = setTimeout(() => setSavedAt(null), 2500)
    return () => clearTimeout(t)
  }, [savedAt])

  const save = useCallback(async () => {
    if (!fields) return
    setSaving(true)
    setErr(null)
    try {
      await api(`/api/social/profile/${kind}`, {
        method: 'PUT',
        body: JSON.stringify(fields),
      })
      setSavedAt(Date.now())
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [api, fields, kind])

  if (!fields) return null

  const set = (k: keyof ProfileFields) => (v: string) => setFields({ ...fields, [k]: v })
  const btn = accent === 'amber'
    ? 'border-amber-600 bg-amber-950/40 text-amber-200 hover:bg-amber-900/40'
    : 'border-purple-600 bg-purple-950/40 text-purple-200 hover:bg-purple-900/40'
  const focus = accent === 'amber' ? 'focus:border-amber-500' : 'focus:border-purple-500'

  return (
    <section className="mt-6 rounded border border-zinc-800 bg-zinc-900/40 p-4">
      <h2 className="text-sm font-medium text-zinc-200">Bio &amp; links</h2>
      <p className="mt-0.5 text-xs text-zinc-500">
        Shown on your profile and beside the byline on your reports and posts.
      </p>

      <label className="mt-3 block text-xs text-zinc-400">Bio</label>
      <textarea
        value={fields.bio ?? ''}
        onChange={(e) => set('bio')(e.target.value)}
        rows={2}
        maxLength={600}
        placeholder="Reverse engineer. Mostly Android and ELF."
        className={`mt-1 w-full resize-y rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none ${focus}`}
      />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="GitHub" prefix="github.com/" value={fields.githubUser ?? ''}
               onChange={(v) => set('githubUser')(v.replace(/^@+/, ''))}
               placeholder="octocat" focus={focus} />
        <Field label="X" prefix="x.com/" value={fields.xUser ?? ''}
               onChange={(v) => set('xUser')(v.replace(/^@+/, ''))}
               placeholder="jack" focus={focus} />
        <Field label="Website" value={fields.websiteUrl ?? ''}
               onChange={set('websiteUrl')} placeholder="https://example.com" focus={focus} />
        <Field label="Mastodon" value={fields.mastodonUrl ?? ''}
               onChange={set('mastodonUrl')} placeholder="https://infosec.exchange/@you" focus={focus} />
        <Field label="LinkedIn" value={fields.linkedinUrl ?? ''}
               onChange={set('linkedinUrl')} placeholder="https://linkedin.com/in/you" focus={focus} />
      </div>

      <div className="mt-3 flex items-center justify-end gap-3">
        {savedAt && <span className="text-xs text-emerald-400">Saved</span>}
        {err && <span className="text-xs text-red-400">{err}</span>}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className={`rounded border px-4 py-1.5 text-sm disabled:opacity-40 ${btn}`}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  )
}

function Field({
  label, prefix, value, onChange, placeholder, focus,
}: {
  label: string
  prefix?: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  focus: string
}) {
  return (
    <div>
      <label className="block text-xs text-zinc-400">{label}</label>
      <div className="mt-1 flex items-center rounded border border-zinc-800 bg-zinc-950">
        {prefix && <span className="pl-2 text-xs text-zinc-600">{prefix}</span>}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full bg-transparent px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none ${focus}`}
        />
      </div>
    </div>
  )
}
