import { useCallback, useEffect, useState } from 'react'
import { useApi, ApiError, API_BASE } from '@shared/api/client'

// State returned by GET /api/me/tos. The frontend gate flips on the
// `accepted === false` case and renders the modal until POST /accept
// flips it back. Field names mirror TosService.AcceptanceState (Java).
type TosState = {
  currentVersion: string
  acceptedVersion: string | null
  acceptedAt: string | null
  // Derived backend-side: acceptedVersion === currentVersion.
  accepted: boolean
}

/**
 * Wraps any subtree that requires an accepted TOS. The hook runs once on
 * mount, hits `GET /api/me/tos`, and either renders `children` (already
 * accepted) or a blocking acceptance modal (not accepted yet).
 *
 * <p>Three failure modes are handled:
 * <ul>
 *   <li>Network/server error on the status fetch → renders an inline
 *       error with a retry button. We don't fall through to children
 *       because we'd then 412 on every subsequent API call.</li>
 *   <li>The backend returns 412 on a downstream API call (TOS version
 *       bumped after we initially accepted, or another tab accepted on
 *       our behalf) → callers can manually trigger a re-fetch via the
 *       global event {@code tos:reset}. Implementation kept simple for
 *       v1; full app-wide ApiError interceptor can come later.</li>
 *   <li>The user dismisses the modal somehow → impossible; the modal is
 *       a true blocker (no close button, fixed inset-0 backdrop).</li>
 * </ul>
 *
 * <p>{@code accent} customizes the "Accept" button color per frontend
 * (purple for openbin, amber for openapk). Defaults to neutral indigo.
 */
export function TosGate({
  children,
  accent = 'indigo',
}: {
  children: React.ReactNode
  accent?: 'indigo' | 'purple' | 'amber'
}) {
  const api = useApi()
  const [state, setState] = useState<TosState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const s = await api<TosState>('/api/me/tos')
      setState(s)
    } catch (e) {
      if (e instanceof ApiError) {
        setError(`Could not load TOS status (HTTP ${e.status}). Try refreshing.`)
      } else {
        setError((e as Error).message)
      }
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { void reload() }, [reload])

  // Listen for `tos:reset` events fired elsewhere in the app when an API
  // call comes back with 412 — re-fetches state so the modal re-appears
  // without a page reload.
  useEffect(() => {
    const handler = () => void reload()
    window.addEventListener('tos:reset', handler)
    return () => window.removeEventListener('tos:reset', handler)
  }, [reload])

  if (loading && !state) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-sm text-zinc-500">
        Loading…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 p-6">
        <div className="max-w-md rounded border border-red-800 bg-red-950/40 p-4 text-sm text-red-200">
          <div className="font-semibold">Couldn't reach the platform.</div>
          <div className="mt-1 text-red-300">{error}</div>
          <button
            onClick={() => void reload()}
            className="mt-3 rounded border border-red-700 px-3 py-1 text-xs hover:bg-red-900/40"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (state && !state.accepted) {
    return <TosModal state={state} onAccepted={() => void reload()} accent={accent} />
  }

  return <>{children}</>
}

const ACCENT_CLASSES: Record<'indigo' | 'purple' | 'amber', { btn: string; ring: string }> = {
  indigo: { btn: 'bg-indigo-500 hover:bg-indigo-400 text-white', ring: 'ring-indigo-700/40' },
  purple: { btn: 'bg-purple-500 hover:bg-purple-400 text-white', ring: 'ring-purple-700/40' },
  amber: { btn: 'bg-amber-500 hover:bg-amber-400 text-zinc-950', ring: 'ring-amber-700/40' },
}

function TosModal({
  state,
  onAccepted,
  accent,
}: {
  state: TosState
  onAccepted: () => void
  accent: 'indigo' | 'purple' | 'amber'
}) {
  const api = useApi()
  const [body, setBody] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [scrolledToEnd, setScrolledToEnd] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch the markdown text from the backend (NOT signed — the endpoint
  // is public so users in a pre-acceptance state can read it). Plain
  // `<pre>` rendering keeps this dependency-free; if we ever want
  // proper markdown rendering we can bring in a tiny renderer later.
  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/tos.md`)
      .then((r) => r.text())
      .then((t) => { if (!cancelled) setBody(t) })
      .catch((e) => { if (!cancelled) setBody(`(Could not load TOS text: ${(e as Error).message})`) })
    return () => { cancelled = true }
  }, [])

  // Track scroll-to-end so we can require the user to scroll through
  // the whole TOS before the Accept button enables. Standard pattern
  // for compliance gates; protects against blind-click acceptance.
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) {
      setScrolledToEnd(true)
    }
  }, [])

  const accept = useCallback(async () => {
    setPosting(true)
    setError(null)
    try {
      await api('/api/me/tos/accept', { method: 'POST' })
      onAccepted()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPosting(false)
    }
  }, [api, onAccepted])

  const ac = ACCENT_CLASSES[accent]

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-zinc-950/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tos-title"
    >
      <div className={`flex h-full max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl ring-1 ${ac.ring}`}>
        <div className="border-b border-zinc-800 p-4">
          <h2 id="tos-title" className="text-lg font-semibold text-zinc-100">
            Terms of Service
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Version <span className="font-mono text-zinc-400">{state.currentVersion}</span>
            {state.acceptedVersion && state.acceptedVersion !== state.currentVersion && (
              <span className="ml-2 text-amber-400">
                (Terms have been updated since your last acceptance.)
              </span>
            )}
          </p>
        </div>
        <div
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-y-auto bg-zinc-950 p-5 text-[13px] leading-relaxed text-zinc-300"
        >
          {body === null ? (
            <div className="text-zinc-600">Loading TOS…</div>
          ) : (
            <pre className="whitespace-pre-wrap font-sans">{body}</pre>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-900 p-4">
          <div className="min-w-0 flex-1 text-[11px] text-zinc-500">
            {!scrolledToEnd ? (
              <span>Scroll to the bottom to enable acceptance.</span>
            ) : error ? (
              <span className="text-red-400">{error}</span>
            ) : (
              <span>By clicking Accept you agree to the Terms above.</span>
            )}
          </div>
          <button
            type="button"
            disabled={!scrolledToEnd || posting}
            onClick={() => void accept()}
            className={`shrink-0 rounded px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${ac.btn}`}
          >
            {posting ? 'Accepting…' : 'I Accept'}
          </button>
        </div>
      </div>
    </div>
  )
}
