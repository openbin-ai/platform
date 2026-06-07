import { useCallback, useEffect, useState } from 'react'
import { useApi } from '@shared/api/client'

// Shape mirrors EmailPrefsResponse on the backend. Adding a new toggle here
// also requires:
//   - new BOOLEAN column on the user_email_preferences table
//   - new field on UserEmailPrefs entity + DTOs
//   - new send path on EmailService + new NotificationService wrapper
type EmailPrefs = {
  notifyDecompileComplete: boolean
  notifyReportPublished: boolean
  notifyAbuseConfirmation: boolean
  notifyNewFollower: boolean
  notifyCommentOnMyReport: boolean
  notifyReplyToMyComment: boolean
  notifyCollaboratorInvite: boolean
}

type Accent = 'purple' | 'amber'

/**
 * Email preferences panel — used inside the Profile page on both openapk-
 * and openbin-frontend. Only the checkbox accent color differs between the
 * two apps; everything else (copy, layout, behavior) is identical so it
 * lives here in @shared/ to keep them in lockstep.
 *
 * Each toggle PATCHes only the field that changed (the request body is
 * { [key]: value }), and the UI is optimistic — we flip the local state
 * immediately and roll back if the PATCH fails. The "Saved" indicator
 * blinks for ~1.5s after a successful update.
 */
export function EmailPreferences({ accent = 'purple' }: { accent?: Accent }) {
  const api = useApi()
  const [prefs, setPrefs] = useState<EmailPrefs | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    api<EmailPrefs>('/api/me/email-preferences')
      .then((r) => {
        if (cancelled) return
        setPrefs(r)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setErr(e instanceof Error ? e.message : 'Failed to load preferences')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [api])

  const toggle = useCallback(async (key: keyof EmailPrefs, value: boolean) => {
    setErr(null)
    // Optimistic update; rollback if the PATCH fails so the UI never shows
    // a state that doesn't match what the backend will report on reload.
    setPrefs((p) => (p ? { ...p, [key]: value } : p))
    try {
      const updated = await api<EmailPrefs>('/api/me/email-preferences', {
        method: 'PATCH',
        body: JSON.stringify({ [key]: value }),
      })
      setPrefs(updated)
      setSavedAt(Date.now())
    } catch (e) {
      setPrefs((p) => (p ? { ...p, [key]: !value } : p))
      setErr(e instanceof Error ? e.message : 'Update failed')
    }
  }, [api])

  // Clear the "Saved" pill after a moment so it doesn't linger forever.
  useEffect(() => {
    if (savedAt == null) return
    const t = setTimeout(() => setSavedAt(null), 1500)
    return () => clearTimeout(t)
  }, [savedAt])

  // Tailwind purges class names it can't see in source, so the accent map
  // has to use literal class strings (no `text-${accent}-600` interpolation).
  const accentChecks =
    accent === 'amber'
      ? 'text-amber-500 focus:ring-amber-500'
      : 'text-purple-600 focus:ring-purple-600'

  return (
    <section className="mt-6 rounded border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">Email preferences</h2>
        {savedAt && <span className="text-xs text-emerald-400">Saved</span>}
      </div>
      <p className="mb-4 text-xs text-zinc-500">
        Transactional emails about your activity. Anti-abuse and security
        messages are always sent regardless of these toggles.
      </p>

      {loading && <p className="text-xs text-zinc-500">Loading…</p>}

      {prefs && (
        <div className="space-y-1">
          <EmailToggle
            label="When a decompile finishes"
            sub="A short note the moment your project flips to ready, with a link straight to it."
            checked={prefs.notifyDecompileComplete}
            onChange={(v) => toggle('notifyDecompileComplete', v)}
            accentChecks={accentChecks}
          />
          <EmailToggle
            label="When you publish a report to the community"
            sub="A confirmation with the public URL so you can share it."
            checked={prefs.notifyReportPublished}
            onChange={(v) => toggle('notifyReportPublished', v)}
            accentChecks={accentChecks}
          />
          <EmailToggle
            label="When you submit an abuse report"
            sub="Confirmation receipt — only sent if you supplied an email at report time."
            checked={prefs.notifyAbuseConfirmation}
            onChange={(v) => toggle('notifyAbuseConfirmation', v)}
            accentChecks={accentChecks}
          />
          <EmailToggle
            label="When someone follows you"
            sub="A short note with a link to their profile so you can follow back."
            checked={prefs.notifyNewFollower}
            onChange={(v) => toggle('notifyNewFollower', v)}
            accentChecks={accentChecks}
          />
          <EmailToggle
            label="When someone comments on your report"
            sub="A heads-up so you can join the discussion on your published research."
            checked={prefs.notifyCommentOnMyReport}
            onChange={(v) => toggle('notifyCommentOnMyReport', v)}
            accentChecks={accentChecks}
          />
          <EmailToggle
            label="When someone replies to your comment"
            sub="Only fires when the reply is directly to one of your own comments."
            checked={prefs.notifyReplyToMyComment}
            onChange={(v) => toggle('notifyReplyToMyComment', v)}
            accentChecks={accentChecks}
          />
          <EmailToggle
            label="When someone invites you to a project"
            sub="A project owner added you as a viewer or editor on their project."
            checked={prefs.notifyCollaboratorInvite}
            onChange={(v) => toggle('notifyCollaboratorInvite', v)}
            accentChecks={accentChecks}
          />
        </div>
      )}

      {err && <p className="mt-3 text-xs text-red-400">{err}</p>}
    </section>
  )
}

function EmailToggle({
  label,
  sub,
  checked,
  onChange,
  accentChecks,
}: {
  label: string
  sub: string
  checked: boolean
  onChange: (v: boolean) => void
  accentChecks: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded px-2 py-2 hover:bg-zinc-950/40">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={`mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950 ${accentChecks}`}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-zinc-100">{label}</div>
        <div className="text-xs text-zinc-500">{sub}</div>
      </div>
    </label>
  )
}
