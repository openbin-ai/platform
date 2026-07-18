import { useEffect, useState } from 'react'
import { useApi } from '@shared/api/client'

/**
 * Live model discovery for a saved BYOK credential. Queries
 * GET /api/credentials/{id}/models (backend fetches from the provider + caches),
 * so the picker never hardcodes a model list. Returns an empty list while
 * loading, when nothing is configured, or on failure — callers treat empty as
 * "let the user type one / fall back to the backend default".
 */
export function useCredentialModels(credentialId: string | null | undefined) {
  const api = useApi()
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setModels([])
    setFailed(false)
    if (!credentialId) {
      setLoading(false)
      return
    }
    setLoading(true)
    ;(async () => {
      try {
        const list = await api<string[]>(`/api/credentials/${credentialId}/models`)
        if (!cancelled) setModels(Array.isArray(list) ? list : [])
      } catch {
        if (!cancelled) setFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [api, credentialId])

  return { models, loading, failed }
}

const DEFAULT_CLASS =
  'w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 disabled:opacity-50'

/**
 * Model picker driven by the credential's live model list. An empty value means
 * "let the backend pick its default". When the list can't be enumerated (still
 * loading, none returned, or the provider's /models errored) it degrades to a
 * free-text input so a model can still be named — a flaky /models never blocks
 * the user.
 */
export function ModelSelect({
  credentialId,
  value,
  onChange,
  className,
  disabled,
}: {
  credentialId: string | null | undefined
  value: string
  onChange: (model: string) => void
  className?: string
  disabled?: boolean
}) {
  const { models, loading, failed } = useCredentialModels(credentialId)
  const cls = className ?? DEFAULT_CLASS

  if (models.length > 0) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cls}
      >
        <option value="">Default</option>
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    )
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || (!credentialId && !value)}
      placeholder={loading ? 'Loading models…' : failed ? 'model id (optional)' : 'Default'}
      className={cls}
      autoComplete="off"
    />
  )
}
