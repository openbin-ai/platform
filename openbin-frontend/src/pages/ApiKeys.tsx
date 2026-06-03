import { useCallback, useEffect, useState } from 'react'
import { ApiError, useApi } from '@shared/api/client'

// Copied from openapk-frontend (with @shared imports) rather than extracted.
// Both apps hit the same backend; keys added here are immediately usable in
// the OpenAPK side too, since LlmCredential rows are user-scoped, not
// project-scoped. If a third app appears we'll move this into shared/.

type Provider = 'ANTHROPIC' | 'OPENAI' | 'BEDROCK'

type Credential = {
  id: string
  provider: Provider
  label: string
  createdAt: string
  lastUsedAt: string | null
  lastTestStatus: string | null
  lastTestMessage: string | null
  lastTestAt: string | null
}

type TestResult = { status: string; message: string }

const PROVIDER_LABELS: Record<Provider, string> = {
  ANTHROPIC: 'Anthropic',
  OPENAI: 'OpenAI',
  BEDROCK: 'AWS Bedrock',
}

export function ApiKeys() {
  const api = useApi()
  const [creds, setCreds] = useState<Credential[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setCreds(await api<Credential[]>('/api/credentials'))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { void refresh() }, [refresh])

  async function handleTest(id: string) {
    setBusyId(id)
    try {
      const result = await api<TestResult>(`/api/credentials/${id}/test`, { method: 'POST' })
      setCreds((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                lastTestStatus: result.status,
                lastTestMessage: result.message,
                lastTestAt: new Date().toISOString(),
              }
            : c,
        ),
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this credential?')) return
    setBusyId(id)
    try {
      await api(`/api/credentials/${id}`, { method: 'DELETE' })
      setCreds((prev) => prev.filter((c) => c.id !== id))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">API Keys</h1>
        <p className="mt-1 text-zinc-400">
          Bring your own keys for Anthropic, OpenAI, or AWS Bedrock. Keys are
          encrypted at rest with AES-256-GCM and shared with OpenAPK — the
          same key works in both products.
        </p>
      </div>

      {error && (
        <div className="rounded border border-red-900/60 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <AddCredentialForm onCreated={refresh} />

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-400">
          Stored credentials
        </h2>
        {loading ? (
          <p className="text-zinc-500">Loading…</p>
        ) : creds.length === 0 ? (
          <p className="text-zinc-500">No credentials yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/40">
            {creds.map((c) => (
              <li key={c.id} className="flex items-center gap-4 p-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-100">{c.label}</span>
                    <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                      {PROVIDER_LABELS[c.provider]}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    Added {new Date(c.createdAt).toLocaleString()}
                    {c.lastTestStatus && (
                      <>
                        {' · '}
                        <span
                          className={
                            c.lastTestStatus === 'ok'
                              ? 'text-emerald-400'
                              : c.lastTestStatus === 'error'
                                ? 'text-red-400'
                                : 'text-amber-400'
                          }
                        >
                          last test: {c.lastTestStatus}
                        </span>
                        {c.lastTestMessage && <> — {c.lastTestMessage}</>}
                      </>
                    )}
                  </div>
                </div>
                <button
                  className="rounded border border-zinc-700 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                  onClick={() => void handleTest(c.id)}
                  disabled={busyId === c.id}
                >
                  Test
                </button>
                <button
                  className="rounded border border-red-900/60 px-3 py-1 text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-50"
                  onClick={() => void handleDelete(c.id)}
                  disabled={busyId === c.id}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function AddCredentialForm({ onCreated }: { onCreated: () => void }) {
  const api = useApi()
  const [provider, setProvider] = useState<Provider>('ANTHROPIC')
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [accessKeyId, setAccessKeyId] = useState('')
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [sessionToken, setSessionToken] = useState('')
  const [region, setRegion] = useState('us-east-1')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const body: Record<string, string> = { provider, label }
      if (provider === 'BEDROCK') {
        Object.assign(body, { accessKeyId, secretAccessKey, region })
        if (sessionToken) body.sessionToken = sessionToken
      } else {
        body.apiKey = apiKey
      }
      await api('/api/credentials', { method: 'POST', body: JSON.stringify(body) })
      setLabel(''); setApiKey(''); setAccessKeyId(''); setSecretAccessKey(''); setSessionToken('')
      onCreated()
    } catch (e) {
      if (e instanceof ApiError) setError(e.message)
      else setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5"
    >
      <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-400">
        Add credential
      </h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Provider">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            <option value="ANTHROPIC">Anthropic</option>
            <option value="OPENAI">OpenAI</option>
            <option value="BEDROCK">AWS Bedrock</option>
          </select>
        </Field>
        <Field label="Label">
          <input
            type="text"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. personal-anthropic"
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
        </Field>

        {provider !== 'BEDROCK' ? (
          <Field label="API key" wide>
            <input
              type="password"
              required
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider === 'ANTHROPIC' ? 'sk-ant-…' : 'sk-…'}
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100"
              autoComplete="off"
            />
          </Field>
        ) : (
          <>
            <Field label="Access key ID">
              <input
                type="text"
                required
                value={accessKeyId}
                onChange={(e) => setAccessKeyId(e.target.value)}
                placeholder="AKIA…"
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100"
                autoComplete="off"
              />
            </Field>
            <Field label="Secret access key">
              <input
                type="password"
                required
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100"
                autoComplete="off"
              />
            </Field>
            <Field label="Region">
              <input
                type="text"
                required
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              />
            </Field>
            <Field label="Session token (optional)">
              <input
                type="password"
                value={sessionToken}
                onChange={(e) => setSessionToken(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100"
                autoComplete="off"
              />
            </Field>
          </>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      <div className="mt-4">
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Add credential'}
        </button>
      </div>
    </form>
  )
}

function Field({
  label,
  wide,
  children,
}: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <label className={`block ${wide ? 'md:col-span-2' : ''}`}>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  )
}
