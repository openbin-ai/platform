import { useCallback, useEffect, useState } from 'react'
import { useApi } from '@shared/api/client'
import { dmSettingsPath, type DmPolicy, type DmSettings } from '@shared/api/dm'

/**
 * "Who can message me" — the DM gate, on the settings page of both apps.
 * One radio group, saved on change. Mirrors EmailPreferences' styling so
 * it reads as a sibling section.
 */
type Accent = 'purple' | 'amber'

const OPTIONS: { value: DmPolicy; label: string; sub: string }[] = [
  { value: 'EVERYONE', label: 'Everyone', sub: 'Any signed-in researcher can start a conversation with you.' },
  { value: 'FOLLOWING', label: 'Only people I follow', sub: 'Your follows are your allowlist. Anyone else sees no Message button and gets refused.' },
  { value: 'NOBODY', label: 'Nobody', sub: 'Direct messages off. Existing threads become read-only for the other side; you can still reply.' },
]

export function DmPrivacySettings({ accent = 'purple' }: { accent?: Accent }) {
  const api = useApi()
  const [policy, setPolicy] = useState<DmPolicy | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api<DmSettings>(dmSettingsPath())
      .then((r) => { if (!cancelled) setPolicy(r.policy) })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load') })
    return () => { cancelled = true }
  }, [api])

  const choose = useCallback(async (next: DmPolicy) => {
    setErr(null)
    const prev = policy
    setPolicy(next)
    try {
      const r = await api<DmSettings>(dmSettingsPath(), { method: 'PUT', body: JSON.stringify({ policy: next }) })
      setPolicy(r.policy)
      setSavedAt(Date.now())
    } catch (e) {
      setPolicy(prev)
      setErr(e instanceof Error ? e.message : 'Update failed')
    }
  }, [api, policy])

  useEffect(() => {
    if (savedAt == null) return
    const t = setTimeout(() => setSavedAt(null), 1500)
    return () => clearTimeout(t)
  }, [savedAt])

  const accentRadio = accent === 'amber' ? 'text-amber-500 focus:ring-amber-500' : 'text-purple-600 focus:ring-purple-600'

  return (
    <section className="mt-6 rounded border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">Who can message you</h2>
        {savedAt && <span className="text-xs text-emerald-400">Saved</span>}
      </div>
      <p className="mb-4 text-xs text-zinc-500">
        Controls who can open a direct message with you. Applies on both OpenBin and OpenAPK.
      </p>
      {policy === null && !err && <p className="text-xs text-zinc-500">Loading…</p>}
      {policy && (
        <div className="space-y-1">
          {OPTIONS.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-start gap-3 rounded px-2 py-2 hover:bg-zinc-900/60">
              <input
                type="radio"
                name="dm-policy"
                value={o.value}
                checked={policy === o.value}
                onChange={() => void choose(o.value)}
                className={`mt-0.5 h-4 w-4 border-zinc-600 bg-zinc-800 ${accentRadio}`}
              />
              <span className="min-w-0">
                <span className="block text-sm text-zinc-200">{o.label}</span>
                <span className="block text-xs text-zinc-500">{o.sub}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </section>
  )
}
