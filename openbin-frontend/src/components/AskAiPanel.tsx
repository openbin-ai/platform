import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useApi } from '@shared/api/client'
import { useStreamingApi } from '@shared/api/streaming'
import { SCRIPT_PATHS } from '@shared/api/scripts'
import { ModelSelect } from '@shared/components/ModelSelect'

type Credential = { id: string; provider: string; label: string }
type ChatTurn = {
  role: 'user' | 'assistant'
  content: string
  meta?: { model: string; in: number; out: number }
}

const ASK_MAX_FILE_BYTES = 60 * 1024  // matches backend ASK_MAX_FILE_BYTES

function threadsKey(projectId: string) {
  return `openbin.script.ask.${projectId}`
}

/**
 * Per-file Ask AI panel for SCRIPT projects. Threads persist to
 * localStorage keyed by (projectId, filePath, sourceMode) so flipping
 * between Original/Deobfuscated keeps separate conversations — they're
 * literally different source.
 *
 * The file content is sent inline with each request (already in memory
 * from the bundle extraction); no per-turn S3 round-trip on the backend.
 */
export function AskAiPanel({
  projectId,
  filePath,
  fileBytes,
  sourceMode,
}: {
  projectId: string
  filePath: string | null
  fileBytes: Uint8Array | undefined
  sourceMode: 'original' | 'deobfuscated'
}) {
  const api = useApi()
  const streamingApi = useStreamingApi()

  const [credentials, setCredentials] = useState<Credential[] | null>(null)
  const [credentialId, setCredentialId] = useState<string>('')
  const [model, setModel] = useState<string>('')
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [question, setQuestion] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tailRef = useRef<HTMLDivElement | null>(null)

  // Threads map: key = `${filePath}::${sourceMode}` → ChatTurn[]
  const threadsRef = useRef<Map<string, ChatTurn[]>>(loadThreads(projectId))

  useEffect(() => {
    threadsRef.current = loadThreads(projectId)
  }, [projectId])

  // Swap the visible thread whenever file or source-mode changes.
  useEffect(() => {
    setError(null)
    if (!filePath) {
      setTurns([])
      return
    }
    const k = `${filePath}::${sourceMode}`
    setTurns(threadsRef.current.get(k) ?? [])
  }, [filePath, sourceMode, projectId])

  // Mirror visible thread → threads map → localStorage.
  useEffect(() => {
    if (!filePath || turns.length === 0) return
    const k = `${filePath}::${sourceMode}`
    threadsRef.current.set(k, turns)
    saveThreads(projectId, threadsRef.current)
  }, [turns, filePath, sourceMode, projectId])

  // Load credentials once per mount.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const creds = await api<Credential[]>('/api/credentials')
        if (cancelled) return
        setCredentials(creds)
        if (creds.length > 0) setCredentialId((prev) => prev || creds[0].id)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    })()
    return () => { cancelled = true }
  }, [api])

  const clearThread = useCallback(() => {
    if (!filePath) return
    const k = `${filePath}::${sourceMode}`
    threadsRef.current.delete(k)
    saveThreads(projectId, threadsRef.current)
    setTurns([])
    setError(null)
  }, [filePath, sourceMode, projectId])

  const send = useCallback(async () => {
    if (!filePath) return
    if (!credentialId) { setError('Pick an LLM credential first.'); return }
    const trimmed = question.trim()
    if (!trimmed) return
    if (!fileBytes) { setError('File not loaded yet.'); return }

    let content = new TextDecoder('utf-8').decode(fileBytes)
    let truncated = false
    if (content.length > ASK_MAX_FILE_BYTES) {
      content = content.slice(0, ASK_MAX_FILE_BYTES)
      truncated = true
    }

    setError(null)
    setStreaming(true)

    // Blank turns are dropped: the backend @NotBlank-rejects them with a
    // bodyless 400, and an empty assistant placeholder can get persisted if
    // a stream dies before its first chunk.
    // The 50k slice matches the backend's @Size cap on AskRequest.PriorTurn.
    const priorTurns = turns
      .filter((t) => t.content.trim() !== '')
      .map((t) => ({ role: t.role, content: t.content.slice(0, 50000) }))
    const userTurn: ChatTurn = {
      role: 'user',
      content: truncated ? `${trimmed}\n\n(note: file truncated to first 60 KB)` : trimmed,
    }
    const assistantTurn: ChatTurn = { role: 'assistant', content: '' }
    setTurns((prev) => [...prev, userTurn, assistantTurn])
    setQuestion('')

    await streamingApi(
      SCRIPT_PATHS.askStream(projectId),
      {
        filePath,
        fileContent: content,
        deobfuscated: sourceMode === 'deobfuscated',
        question: trimmed,
        credentialId,
        model: model || undefined,
        priorTurns,
      },
      {
        onChunk: (text) => {
          setTurns((prev) => {
            if (prev.length === 0) return prev
            const next = prev.slice()
            const last = next[next.length - 1]
            next[next.length - 1] = { ...last, content: last.content + text }
            return next
          })
          requestAnimationFrame(() => {
            tailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
          })
        },
        onDone: (info) => {
          setTurns((prev) => {
            if (prev.length === 0) return prev
            const next = prev.slice()
            const last = next[next.length - 1]
            next[next.length - 1] = { ...last, meta: { model: info.model, in: info.inputTokens, out: info.outputTokens } }
            return next
          })
          setStreaming(false)
        },
        onError: (message) => {
          setError(message)
          setStreaming(false)
          // Drop the empty placeholder so the next turn doesn't replay it.
          setTurns((prev) => {
            if (prev.length === 0 || prev[prev.length - 1].role !== 'assistant') return prev
            if (prev[prev.length - 1].content !== '') return prev
            return prev.slice(0, -1)
          })
        },
      },
    )
  }, [filePath, credentialId, model, question, fileBytes, turns, projectId, sourceMode, streamingApi])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-2 py-1.5 text-xs">
        {credentials === null ? (
          <span className="text-zinc-500">Loading credentials…</span>
        ) : credentials.length === 0 ? (
          <a href="/settings/api-keys" className="text-purple-300 hover:underline">
            Add an LLM API key →
          </a>
        ) : (
          <select
            value={credentialId}
            onChange={(e) => setCredentialId(e.target.value)}
            className="min-w-0 flex-1 truncate rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100"
          >
            {credentials.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.provider})
              </option>
            ))}
          </select>
        )}
        {credentialId && (
          <ModelSelect
            credentialId={credentialId}
            value={model}
            onChange={setModel}
            className="min-w-0 flex-1 truncate rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100"
          />
        )}
        {turns.length > 0 && (
          <button
            onClick={clearThread}
            disabled={streaming}
            className="rounded border border-zinc-700 px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
            title="Clear conversation"
          >
            ⟲
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3 text-sm">
        {!filePath && (
          <p className="text-zinc-500">Pick a file on the left to ask about it.</p>
        )}
        {filePath && turns.length === 0 && (
          <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3 text-zinc-400">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Currently asking about</div>
            <div className="mt-1 truncate font-mono text-xs text-purple-200">
              {filePath} {sourceMode === 'deobfuscated' && <span className="ml-1 text-[10px] text-purple-400">(deobfuscated)</span>}
            </div>
            <p className="mt-2 text-xs">
              Try: <em>“What does this file do?”</em> · <em>“Where is the data exfiltrated to?”</em>
            </p>
          </div>
        )}
        {turns.map((t, i) => (
          <div
            key={i}
            className={
              t.role === 'user'
                ? 'rounded border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-zinc-100'
                : 'rounded border border-purple-900/40 bg-purple-950/20 px-3 py-2 text-zinc-100'
            }
          >
            <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-zinc-500">
              <span>{t.role === 'user' ? 'You' : 'AI'}</span>
              {t.meta && (
                <span className="font-mono normal-case">
                  {t.meta.model} · {t.meta.in}+{t.meta.out} tok
                </span>
              )}
            </div>
            {t.role === 'assistant' ? (
              <div className="prose prose-sm prose-invert max-w-none prose-pre:bg-black/40 prose-pre:text-[11px]">
                <ReactMarkdown>{t.content || ' '}</ReactMarkdown>
              </div>
            ) : (
              <div className="whitespace-pre-wrap">{t.content}</div>
            )}
          </div>
        ))}
        <div ref={tailRef} />
      </div>

      {error && (
        <div className="mx-2 mb-2 rounded border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-end gap-2 border-t border-zinc-800 px-2 py-2">
        <textarea
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !streaming) {
              e.preventDefault()
              void send()
            }
          }}
          disabled={!filePath || streaming}
          placeholder={filePath ? 'Ask about this file… (Enter to send, Shift+Enter for newline)' : 'Pick a file first'}
          className="min-h-0 flex-1 resize-none rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-purple-600/60 focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={() => void send()}
          disabled={!filePath || streaming || !question.trim()}
          className="rounded bg-purple-500 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-400 disabled:opacity-40"
        >
          {streaming ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}

// ---- localStorage helpers ----

function loadThreads(projectId: string): Map<string, ChatTurn[]> {
  if (typeof window === 'undefined') return new Map()
  try {
    const raw = window.localStorage.getItem(threadsKey(projectId))
    if (!raw) return new Map()
    const obj = JSON.parse(raw) as Record<string, ChatTurn[]>
    return new Map(Object.entries(obj))
  } catch {
    return new Map()
  }
}

function saveThreads(projectId: string, threads: Map<string, ChatTurn[]>) {
  if (typeof window === 'undefined') return
  try {
    const obj: Record<string, ChatTurn[]> = {}
    for (const [k, v] of threads) obj[k] = v
    window.localStorage.setItem(threadsKey(projectId), JSON.stringify(obj))
  } catch {
    // localStorage quota or disabled — silently skip.
  }
}
