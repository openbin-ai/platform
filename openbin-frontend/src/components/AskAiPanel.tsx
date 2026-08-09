import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useApi } from '@shared/api/client'
import { useStreamingApi } from '@shared/api/streaming'
import { SCRIPT_PATHS } from '@shared/api/scripts'
import {
  SHARED_KEY, UNTITLED, sessionMessageCount, useAskSessions,
  type ChatTurn, type SessionMode,
} from '@shared/api/askSessions'
import { ModelSelect } from '@shared/components/ModelSelect'
import { estimateCost } from '../lib/llmCost'

type Credential = { id: string; provider: string; label: string }

const ASK_MAX_FILE_BYTES = 60 * 1024  // matches backend ASK_MAX_FILE_BYTES
const PRIOR_TURN_MAX = 50000          // matches AskRequest.PriorTurn @Size

/**
 * Ask AI panel for SCRIPT projects, with the same named multi-session
 * model the BIN view uses.
 *
 * Two conversation modes:
 *   per-unit — a thread per (file, source view). Original and Deobfuscated
 *     stay separate conversations because they are literally different
 *     source; answers about one don't apply to the other.
 *   shared — one thread spanning every file you open, so the model keeps
 *     context across a package walkthrough. Each turn records which file it
 *     was asked about.
 *
 * File content is sent inline from the already-extracted bundle, so the
 * backend never does a per-turn S3 round-trip.
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
  sourceMode: 'original' | 'deobfuscated' | 'ondemand'
}) {
  const api = useApi()
  const streamingApi = useStreamingApi()
  const {
    sessions, active, activeId,
    setActiveId, updateActive, newSession, deleteSession, renameSession, setMode,
  } = useAskSessions('openbin.script', projectId)

  const [credentials, setCredentials] = useState<Credential[] | null>(null)
  const [credentialId, setCredentialId] = useState<string>('')
  const [model, setModel] = useState<string>('')
  const [question, setQuestion] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const tailRef = useRef<HTMLDivElement | null>(null)

  // The unit a per-unit thread is keyed by. Source mode is part of it so
  // Original vs Deobfuscated never share a conversation.
  const unitKey = filePath ? `${filePath}::${sourceMode}` : ''
  const threadKey = active?.mode === 'shared' ? SHARED_KEY : unitKey
  const turns: ChatTurn[] = active && threadKey ? (active.threads[threadKey] ?? []) : []

  useEffect(() => { setError(null) }, [filePath, sourceMode])

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

  const setTurns = useCallback((fn: (prev: ChatTurn[]) => ChatTurn[]) => {
    updateActive((s) => ({
      ...s,
      threads: { ...s.threads, [threadKey]: fn(s.threads[threadKey] ?? []) },
    }))
  }, [updateActive, threadKey])

  const clearThread = useCallback(() => {
    if (!threadKey || turns.length === 0) return
    if (!confirm('Clear this conversation? The session and its other threads stay.')) return
    updateActive((s) => {
      const next = { ...s.threads }
      delete next[threadKey]
      return { ...s, threads: next }
    })
    setError(null)
  }, [threadKey, turns.length, updateActive])

  const copyTurn = useCallback((content: string) => {
    navigator.clipboard?.writeText(content).catch(() => {
      // Clipboard is blocked on insecure origins / without permission —
      // fall back to a selectable prompt rather than failing silently.
      window.prompt('Copy the answer:', content)
    })
  }, [])

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
    const priorTurns = turns
      .filter((t) => t.content.trim() !== '')
      .map((t) => ({ role: t.role, content: t.content.slice(0, PRIOR_TURN_MAX) }))
    const userTurn: ChatTurn = {
      role: 'user',
      content: truncated ? `${trimmed}\n\n(note: file truncated to first 60 KB)` : trimmed,
      context: filePath,
    }
    setTurns((prev) => [...prev, userTurn, { role: 'assistant', content: '' }])
    // Name the session after its opening question, so the drawer reads as
    // a list of investigations rather than "Untitled session" ×6.
    updateActive((s) => (
      s.title === UNTITLED ? { ...s, title: trimmed.slice(0, 40) } : s
    ))
    setQuestion('')

    await streamingApi(
      SCRIPT_PATHS.askStream(projectId),
      {
        filePath,
        fileContent: content,
        // Both deobfuscated views are "not the original bytes" as far as
        // the system prompt is concerned.
        deobfuscated: sourceMode !== 'original',
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
            next[next.length - 1] = {
              ...last,
              meta: { model: info.model, in: info.inputTokens, out: info.outputTokens },
            }
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
  }, [filePath, credentialId, model, question, fileBytes, turns, projectId, sourceMode,
      streamingApi, setTurns, updateActive])

  const sortedSessions = useMemo(
    () => sessions.slice().sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  )

  return (
    <div className="relative flex h-full flex-col">
      {/* Session bar */}
      <div className="flex items-center gap-1.5 border-b border-zinc-800 px-2 py-1.5 text-xs">
        <button
          onClick={() => setDrawerOpen((v) => !v)}
          title="Switch conversation"
          className="min-w-0 flex-1 truncate rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-left text-zinc-200 hover:border-zinc-700"
        >
          <span className="text-zinc-500">☰ </span>
          {active?.title ?? UNTITLED}
        </button>
        <button
          onClick={() => newSession(active?.mode ?? 'per-unit')}
          title="New conversation"
          className="rounded border border-zinc-700 px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          ＋
        </button>
        <select
          value={active?.mode ?? 'per-unit'}
          onChange={(e) => setMode(e.target.value as SessionMode)}
          title={active?.mode === 'shared'
            ? 'One thread across every file you open'
            : 'A separate thread per file and source view'}
          className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-zinc-300"
        >
          <option value="per-unit">Per file</option>
          <option value="shared">Everything</option>
        </select>
        {turns.length > 0 && (
          <button
            onClick={clearThread}
            disabled={streaming}
            className="rounded border border-zinc-700 px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
            title="Clear this thread"
          >
            ⟲
          </button>
        )}
      </div>

      {/* Credential + model */}
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
              <option key={c.id} value={c.id}>{c.label} ({c.provider})</option>
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
      </div>

      {/* Sessions drawer */}
      {drawerOpen && (
        <div className="absolute inset-0 z-20 flex flex-col bg-zinc-950/97">
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2 text-xs">
            <span className="font-medium text-zinc-200">Conversations</span>
            <button onClick={() => setDrawerOpen(false)} className="text-zinc-400 hover:text-zinc-100">✕</button>
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-zinc-900 overflow-auto">
            {sortedSessions.map((s) => (
              <li
                key={s.id}
                className={`flex items-center gap-2 px-3 py-2 text-xs ${
                  s.id === activeId ? 'bg-purple-950/20' : 'hover:bg-zinc-900/60'
                }`}
              >
                {renamingId === s.id ? (
                  <input
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => { renameSession(s.id, renameDraft); setRenamingId(null) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { renameSession(s.id, renameDraft); setRenamingId(null) }
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-zinc-100 focus:outline-none"
                  />
                ) : (
                  <button
                    onClick={() => { setActiveId(s.id); setDrawerOpen(false) }}
                    className="min-w-0 flex-1 truncate text-left text-zinc-200"
                  >
                    {s.title}
                    <span className="ml-2 text-[10px] text-zinc-600">
                      {s.mode === 'shared' ? 'everything' : 'per file'} · {sessionMessageCount(s)} msg
                    </span>
                  </button>
                )}
                <button
                  onClick={() => { setRenamingId(s.id); setRenameDraft(s.title) }}
                  title="Rename"
                  className="shrink-0 text-zinc-500 hover:text-zinc-200"
                >
                  ✎
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete “${s.title}”? Its messages are gone for good.`)) deleteSession(s.id)
                  }}
                  title="Delete"
                  className="shrink-0 text-zinc-500 hover:text-red-300"
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3 text-sm">
        {!filePath && <p className="text-zinc-500">Pick a file on the left to ask about it.</p>}
        {filePath && turns.length === 0 && (
          <div className="rounded border border-zinc-800 bg-zinc-900/40 p-3 text-zinc-400">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Currently asking about</div>
            <div className="mt-1 truncate font-mono text-xs text-purple-200">
              {filePath}
              {sourceMode !== 'original' && (
                <span className="ml-1 text-[10px] text-purple-400">(deobfuscated)</span>
              )}
            </div>
            <p className="mt-2 text-xs">
              Try: <em>“What does this file do?”</em> · <em>“Where is the data exfiltrated to?”</em>
            </p>
            {active?.mode === 'shared' && (
              <p className="mt-2 text-[11px] text-zinc-500">
                This conversation spans every file you open — the model keeps what it already saw.
              </p>
            )}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === 'user' ? 'flex justify-end' : ''}>
            <div
              className={
                t.role === 'user'
                  ? 'max-w-[92%] rounded border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-zinc-100'
                  : 'w-full rounded border border-purple-900/40 bg-purple-950/20 px-3 py-2 text-zinc-100'
              }
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-zinc-500">
                <span>
                  {t.role === 'user' ? 'You' : 'AI'}
                  {/* In shared mode one thread spans many files, so say
                      which one each question was about. */}
                  {t.role === 'user' && active?.mode === 'shared' && t.context && (
                    <span className="ml-1.5 font-mono normal-case text-purple-300/80">📄 {shortPath(t.context)}</span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  {t.meta && (
                    <span className="font-mono normal-case">
                      {t.meta.model} · {t.meta.in}+{t.meta.out} tok
                      {costLabel(t.meta)}
                    </span>
                  )}
                  {t.role === 'assistant' && t.content && (
                    <button
                      onClick={() => copyTurn(t.content)}
                      title="Copy markdown"
                      className="normal-case text-zinc-500 hover:text-zinc-200"
                    >
                      ⧉
                    </button>
                  )}
                </span>
              </div>
              {t.role === 'assistant' ? (
                t.content ? (
                  <div className="prose prose-sm prose-invert max-w-none prose-pre:bg-black/40 prose-pre:text-[11px]">
                    <ReactMarkdown>{t.content}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="text-xs italic text-zinc-500">Waiting for first token…</div>
                )
              ) : (
                <div className="whitespace-pre-wrap">{t.content}</div>
              )}
            </div>
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

/** Trailing path segment — full paths blow out the turn header. */
function shortPath(p: string): string {
  const parts = p.split('/')
  return parts[parts.length - 1] || p
}

function costLabel(meta: { model: string; in: number; out: number }): string {
  const cost = estimateCost(meta.model, meta.in, meta.out)
  return cost ? ` · ${cost}` : ''
}
