import { useCallback, useEffect, useState } from 'react'
import { ApiError, useApi } from '../api/client'
import { buildCyberChefUrl, type CyberChefOp } from './cyberchef'

type CryptoHit = { file: string; line: number; snippet: string }
type Decryptor = {
  script: string
  explanation: string
  className: string
  entryMethods: string[]
  ciphertexts: string[]
  cyberchefRecipe: CyberChefOp[] | null
  model: string
  inputTokens: number
  outputTokens: number
}

/**
 * Right-panel tab for the "auto-recreate crypto" workflow.
 *
 * - Lists Cipher/MessageDigest/SecretKeySpec/etc. hits from the cached static
 *   digest (server returns 409 if no digest yet — user must run Analysis first).
 * - Per-hit "Generate decryptor" → POSTs to the AI, returns a Python script +
 *   explanation, expands inline. Scripts are NOT persisted; copy them out if you
 *   want to keep them.
 * - "Open file" jumps to the source location via onOpenFile, forwarding the
 *   hit's line so HighlightedCode scrolls to + flashes the exact call site.
 */
export function Crypto({
  projectId, credentialId, model, onOpenFile,
}: {
  projectId: string
  credentialId: string | null
  model: string
  onOpenFile: (path: string, line?: number) => void
}) {
  const api = useApi()
  const [hits, setHits] = useState<CryptoHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [rescanning, setRescanning] = useState(false)
  const [scripts, setScripts] = useState<Record<string, Decryptor>>({})
  const [includeSdks, setIncludeSdks] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const q = includeSdks ? '?includeSdks=true' : ''
      setHits(await api<CryptoHit[]>(`/api/projects/${projectId}/crypto/hits${q}`))
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError('No static digest yet — run an analysis from the Analysis tab first.')
        setHits([])
      } else {
        setError((e as Error).message)
      }
    }
  }, [api, projectId, includeSdks])

  useEffect(() => { void load() }, [load])

  const key = (h: CryptoHit) => `${h.file}:${h.line}`

  async function generate(h: CryptoHit) {
    if (!credentialId) {
      setError('Pick a credential in the AI panel above first.')
      return
    }
    const k = key(h)
    setBusyKey(k)
    setError(null)
    try {
      const r = await api<Decryptor>(`/api/projects/${projectId}/crypto/generate`, {
        method: 'POST',
        body: JSON.stringify({ file: h.file, line: h.line, credentialId, model: model || undefined }),
      })
      setScripts(prev => ({ ...prev, [k]: r }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyKey(null)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // ignore — user can select manually
    }
  }

  async function rescan() {
    setRescanning(true)
    setError(null)
    try {
      await api(`/api/projects/${projectId}/digest/rescan`, { method: 'POST' })
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRescanning(false)
    }
  }

  if (hits === null) return <p className="p-3 text-xs text-zinc-500">Loading…</p>

  const empty = hits.length === 0
  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          {empty ? 'Crypto hits' : `Crypto hits (${hits.length})`}
        </h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-[10px] text-zinc-400" title="Include hits from androidx, kotlin, com.google.*, okhttp, etc.">
            <input
              type="checkbox"
              checked={includeSdks}
              onChange={e => setIncludeSdks(e.target.checked)}
              className="h-3 w-3"
            />
            include SDKs
          </label>
          <button
            onClick={() => void rescan()}
            disabled={rescanning}
            title="Re-run the static signature scan with the latest patterns"
            className="text-[10px] text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
          >
            {rescanning ? 'Rescanning…' : '↻ Rescan'}
          </button>
        </div>
      </div>
      {error && (
        <div className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">{error}</div>
      )}
      {empty && (
        <p className="pt-2 text-xs text-zinc-500">
          No hits yet. If you just patched detection, click <strong>Rescan</strong>. Otherwise run an analysis first so the digest is cached.
        </p>
      )}
      <ul className="space-y-2">
        {hits.map(h => {
          const k = key(h)
          const script = scripts[k]
          return (
            <li key={k} className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <button
                    onClick={() => onOpenFile(h.file, h.line)}
                    className="block w-full truncate text-left font-mono text-[11px] text-purple-300 hover:underline"
                    title={`${h.file}:${h.line}`}
                  >
                    {h.file}<span className="text-zinc-500">:{h.line}</span>
                  </button>
                  <pre className="mt-1 overflow-hidden whitespace-pre-wrap wrap-break-word text-[11px] text-zinc-300">
                    {h.snippet}
                  </pre>
                </div>
                <button
                  onClick={() => void generate(h)}
                  disabled={busyKey === k || !credentialId}
                  className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
                  title={!credentialId ? 'Pick a credential above' : 'Generate a Python decryptor'}
                >
                  {busyKey === k ? '…' : script ? '↻' : '✨ Generate'}
                </button>
              </div>

              {script && (
                <div className="mt-2 space-y-2 border-t border-zinc-800 pt-2">
                  <p className="text-[11px] text-zinc-300">{script.explanation}</p>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
                    <span>
                      class <span className="font-mono text-zinc-300">{script.className}</span>
                    </span>
                    {script.entryMethods.length > 0 && (
                      <span>
                        methods <span className="font-mono text-zinc-300">{script.entryMethods.join(', ')}</span>
                      </span>
                    )}
                    <span className={script.ciphertexts.length > 0 ? 'text-emerald-400' : 'text-amber-400'}>
                      {script.ciphertexts.length === 0
                        ? 'no ciphertexts harvested'
                        : `${script.ciphertexts.length} ciphertext${script.ciphertexts.length === 1 ? '' : 's'} harvested`}
                    </span>
                    {script.cyberchefRecipe && script.cyberchefRecipe.length > 0 && (
                      <span className="text-sky-400">
                        · CyberChef recipe ({script.cyberchefRecipe.length} op{script.cyberchefRecipe.length === 1 ? '' : 's'})
                      </span>
                    )}
                  </div>
                  {script.ciphertexts.length > 0 && (
                    <details className="rounded border border-zinc-800 bg-zinc-950/60">
                      <summary className="flex cursor-pointer items-center gap-2 px-2 py-1 text-[10px] text-zinc-400">
                        <span className="flex-1">Harvested ciphertexts (preview)</span>
                        {script.cyberchefRecipe && script.cyberchefRecipe.length > 0 && (
                          <a
                            href={buildCyberChefUrl(script.cyberchefRecipe, script.ciphertexts[0])}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800"
                            title="Open the first ciphertext in CyberChef with the AI-generated recipe pre-loaded"
                          >
                            ↗ CyberChef (first)
                          </a>
                        )}
                      </summary>
                      <ul className="max-h-32 overflow-auto px-2 pb-2 font-mono text-[10px] text-zinc-300">
                        {script.ciphertexts.slice(0, 50).map(c => (
                          <li key={c} className="flex items-center gap-1 truncate">
                            <span className="min-w-0 flex-1 truncate" title={c}>{c}</span>
                            {script.cyberchefRecipe && script.cyberchefRecipe.length > 0 && (
                              <a
                                href={buildCyberChefUrl(script.cyberchefRecipe, c)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 text-[10px] text-purple-300 hover:text-purple-200"
                                title="Open in CyberChef"
                              >
                                ↗
                              </a>
                            )}
                          </li>
                        ))}
                        {script.ciphertexts.length > 50 && (
                          <li className="text-zinc-500">…+{script.ciphertexts.length - 50} more in the script</li>
                        )}
                      </ul>
                    </details>
                  )}
                  <div className="relative">
                    <pre className="max-h-64 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11px] leading-5 text-zinc-100">
                      {script.script}
                    </pre>
                    <button
                      onClick={() => void copy(script.script)}
                      className="absolute right-1 top-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800"
                    >
                      Copy
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-600">
                    {script.model} · in {script.inputTokens.toLocaleString()} · out {script.outputTokens.toLocaleString()}
                  </p>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
