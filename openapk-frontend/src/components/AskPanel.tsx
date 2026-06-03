import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { useStreamingApi } from '../api/streaming'
import { estimateCost } from '../lib/llmCost'

/*
 * Chat-style Ask AI panel for OpenAPK.
 *
 * Multiple sessions per project, each with a mode toggle:
 *   - per-file: threads keyed by file path; switching files swaps the
 *     visible thread.
 *   - shared:   one thread for the whole session; switching files just
 *     changes which file's content is attached to the next question.
 *
 * Sessions + threads are persisted to localStorage keyed by projectId so
 * page refresh keeps the conversation history (those LLM tokens cost real
 * money).
 */

type ChatTurn = {
  role: 'user' | 'assistant'
  content: string
  /** Only populated on assistant turns once streaming completes. */
  meta?: { model: string; in: number; out: number }
  /** Only present in shared-session turns -- the file the user was looking
   *  at when they asked. Helps the user remember the context later. */
  filePath?: string | null
}

type ChatSession = {
  id: string
  title: string
  mode: 'per-file' | 'shared'
  /** For per-file mode: keyed by file path. For shared mode: single entry
   *  under the synthetic key SHARED_KEY. */
  threads: Record<string, ChatTurn[]>
  createdAt: number
  updatedAt: number
}

const SHARED_KEY = '__shared__'
const sessionsKey = (projectId: string) => `openapk.askSessions.${projectId}`
const activeKey = (projectId: string) => `openapk.askActiveSession.${projectId}`

function newSessionId(): string {
  return crypto.randomUUID()
}

function emptySession(mode: 'per-file' | 'shared' = 'per-file'): ChatSession {
  const now = Date.now()
  return {
    id: newSessionId(),
    title: 'Untitled session',
    mode,
    threads: {},
    createdAt: now,
    updatedAt: now,
  }
}

function loadSessions(projectId: string): ChatSession[] {
  try {
    const raw = window.localStorage.getItem(sessionsKey(projectId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed as ChatSession[]
  } catch {
    return []
  }
}

function saveSessions(projectId: string, sessions: ChatSession[]) {
  try {
    if (sessions.length === 0) {
      window.localStorage.removeItem(sessionsKey(projectId))
    } else {
      window.localStorage.setItem(sessionsKey(projectId), JSON.stringify(sessions))
    }
  } catch {
    // quota / sandbox -- silently drop
  }
}

function loadActiveId(projectId: string): string | null {
  try {
    return window.localStorage.getItem(activeKey(projectId))
  } catch {
    return null
  }
}

function saveActiveId(projectId: string, id: string | null) {
  try {
    if (id) window.localStorage.setItem(activeKey(projectId), id)
    else window.localStorage.removeItem(activeKey(projectId))
  } catch { /* ignore */ }
}

export type AskPanelProps = {
  projectId: string
  filePath: string | null
  credentialId: string | null
  model: string
}

export function AskPanel({ projectId, filePath, credentialId, model }: AskPanelProps) {
  const streamingApi = useStreamingApi()

  // ── sessions ──────────────────────────────────────────────────────────
  // Seed sessions + activeId atomically so we never end up in a "have
  // sessions but no valid activeId" limbo that renders Loading… forever.
  const [initial] = useState(() => {
    const loaded = loadSessions(projectId)
    const stored = loadActiveId(projectId)
    if (loaded.length > 0) {
      const id = stored && loaded.some(s => s.id === stored) ? stored : loaded[0].id
      return { sessions: loaded, activeId: id }
    }
    const fresh = emptySession('per-file')
    return { sessions: [fresh], activeId: fresh.id }
  })
  const [sessions, setSessions] = useState<ChatSession[]>(initial.sessions)
  const [activeId, setActiveId] = useState<string | null>(initial.activeId)

  // Reload when projectId changes (cross-project nav without remount). Skip
  // the first run; the lazy initializer above already loaded the right data.
  const initFor = useRef(projectId)
  useEffect(() => {
    if (initFor.current === projectId) return
    initFor.current = projectId
    const loaded = loadSessions(projectId)
    if (loaded.length > 0) {
      const stored = loadActiveId(projectId)
      setSessions(loaded)
      setActiveId(stored && loaded.some(s => s.id === stored) ? stored : loaded[0].id)
    } else {
      const fresh = emptySession('per-file')
      setSessions([fresh])
      setActiveId(fresh.id)
    }
  }, [projectId])

  // Safety net: if activeId ever points at nothing (e.g. after a delete),
  // jump to the first available session.
  useEffect(() => {
    if (sessions.length > 0 && (!activeId || !sessions.some(s => s.id === activeId))) {
      setActiveId(sessions[0].id)
    }
  }, [sessions, activeId])
  // Persist
  useEffect(() => { saveSessions(projectId, sessions) }, [sessions, projectId])
  useEffect(() => { saveActiveId(projectId, activeId) }, [activeId, projectId])

  const active = useMemo(
    () => sessions.find(s => s.id === activeId) ?? null,
    [sessions, activeId],
  )

  // ── thread selection (depends on mode + filePath) ─────────────────────
  const threadKey = active?.mode === 'shared' ? SHARED_KEY : (filePath ?? '')
  const turns: ChatTurn[] = active && threadKey ? (active.threads[threadKey] ?? []) : []

  // ── UI state ──────────────────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [question, setQuestion] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement | null>(null)

  // Auto-scroll on new content.
  useEffect(() => {
    requestAnimationFrame(() => {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    })
  }, [turns.length, streaming])

  // ── session mutators ──────────────────────────────────────────────────
  const updateActive = useCallback((mut: (s: ChatSession) => ChatSession) => {
    setSessions(prev => prev.map(s => (s.id === activeId ? { ...mut(s), updatedAt: Date.now() } : s)))
  }, [activeId])

  const newSession = useCallback(() => {
    const s = emptySession(active?.mode ?? 'per-file')
    setSessions(prev => [...prev, s])
    setActiveId(s.id)
    setDrawerOpen(false)
  }, [active?.mode])

  const deleteSession = useCallback((id: string) => {
    if (!confirm('Delete this chat session? This cannot be undone.')) return
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id)
      if (next.length === 0) {
        const fresh = emptySession('per-file')
        setActiveId(fresh.id)
        return [fresh]
      }
      if (id === activeId) setActiveId(next[0].id)
      return next
    })
  }, [activeId])

  const setMode = useCallback((mode: 'per-file' | 'shared') => {
    updateActive(s => ({ ...s, mode }))
  }, [updateActive])

  const startRename = (s: ChatSession) => {
    setRenaming(s.id)
    setRenameDraft(s.title)
  }
  const commitRename = (id: string) => {
    const title = renameDraft.trim() || 'Untitled session'
    setSessions(prev => prev.map(s => (s.id === id ? { ...s, title, updatedAt: Date.now() } : s)))
    setRenaming(null)
  }

  // ── send ──────────────────────────────────────────────────────────────
  async function send() {
    if (!active) return
    if (!credentialId) { setError('Pick an LLM credential first.'); return }
    if (!filePath) {
      setError(active.mode === 'shared'
        ? 'Open a file from the tree to attach as context for your first question.'
        : 'Open a file from the tree first.')
      return
    }
    const trimmed = question.trim()
    if (!trimmed) return

    setError(null)
    setStreaming(true)

    // Snapshot priorTurns BEFORE we mutate state.
    const priorTurns = turns.map(t => ({ role: t.role, content: t.content }))
    const userTurn: ChatTurn = { role: 'user', content: trimmed, filePath }
    const assistantTurn: ChatTurn = { role: 'assistant', content: '' }
    updateActive(s => ({
      ...s,
      title: s.title === 'Untitled session' && turns.length === 0
        ? trimmed.slice(0, 40)
        : s.title,
      threads: { ...s.threads, [threadKey]: [...turns, userTurn, assistantTurn] },
    }))
    setQuestion('')

    await streamingApi(
      `/api/projects/${projectId}/ask/stream`,
      { filePath, question: trimmed, credentialId, model: model || undefined, priorTurns },
      {
        onChunk: (text) => {
          updateActive(s => {
            const thread = s.threads[threadKey] ?? []
            if (thread.length === 0) return s
            const next = thread.slice()
            const last = next[next.length - 1]
            next[next.length - 1] = { ...last, content: last.content + text }
            return { ...s, threads: { ...s.threads, [threadKey]: next } }
          })
        },
        onDone: (info) => {
          updateActive(s => {
            const thread = s.threads[threadKey] ?? []
            if (thread.length === 0) return s
            const next = thread.slice()
            const last = next[next.length - 1]
            next[next.length - 1] = {
              ...last,
              meta: { model: info.model, in: info.inputTokens, out: info.outputTokens },
            }
            return { ...s, threads: { ...s.threads, [threadKey]: next } }
          })
          setStreaming(false)
        },
        onError: (msg) => {
          setError(msg)
          setStreaming(false)
          // Drop the placeholder assistant turn so a failed send doesn't
          // pollute the next priorTurns payload.
          updateActive(s => {
            const thread = s.threads[threadKey] ?? []
            if (thread.length === 0) return s
            const last = thread[thread.length - 1]
            if (last.role !== 'assistant' || last.content !== '') return s
            return { ...s, threads: { ...s.threads, [threadKey]: thread.slice(0, -1) } }
          })
        },
      },
    )
  }

  function clearCurrentThread() {
    if (!active) return
    if (!confirm('Clear messages in this thread?')) return
    updateActive(s => {
      const next = { ...s.threads }
      delete next[threadKey]
      return { ...s, threads: next }
    })
  }

  async function copyMarkdown(content: string) {
    try {
      await navigator.clipboard.writeText(content)
    } catch {
      // Browser blocked it (insecure context, permissions). Fall back to a
      // selectable prompt.
      window.prompt('Copy markdown:', content)
    }
  }

  // ── render ────────────────────────────────────────────────────────────
  if (!active) {
    return <div className="p-4 text-xs text-zinc-500">Loading sessions…</div>
  }
  if (!credentialId) {
    return (
      <div className="space-y-2 p-3 text-xs text-zinc-500">
        <p>No LLM credential selected.</p>
        <Link to="/settings/api-keys" className="inline-block rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500">
          Add or pick a credential
        </Link>
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 text-xs">
      {/* Session drawer (overlay on the left of the panel) */}
      {drawerOpen && (
        <>
          <div className="absolute inset-0 z-10 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 z-20 flex w-64 flex-col border-r border-zinc-800 bg-zinc-950 shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Sessions</span>
              <button onClick={newSession} title="New session" className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800">+ New</button>
            </div>
            <ul className="flex-1 overflow-auto">
              {[...sessions].sort((a, b) => b.updatedAt - a.updatedAt).map(s => {
                const turnCount = Object.values(s.threads).reduce((acc, t) => acc + t.length, 0)
                return (
                  <li key={s.id} className={`group flex items-center gap-2 border-b border-zinc-900 px-3 py-2 ${s.id === activeId ? 'bg-zinc-900/80' : 'hover:bg-zinc-900/40'}`}>
                    <div className="min-w-0 flex-1 cursor-pointer" onClick={() => { setActiveId(s.id); setDrawerOpen(false) }}>
                      {renaming === s.id ? (
                        <input
                          autoFocus
                          value={renameDraft}
                          onChange={e => setRenameDraft(e.target.value)}
                          onBlur={() => commitRename(s.id)}
                          onKeyDown={e => { if (e.key === 'Enter') commitRename(s.id); if (e.key === 'Escape') setRenaming(null) }}
                          className="w-full rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[11px] text-zinc-100"
                        />
                      ) : (
                        <div className="truncate text-[11px] text-zinc-100" title={s.title}>{s.title}</div>
                      )}
                      <div className="mt-0.5 flex items-center gap-2 text-[9px] text-zinc-500">
                        <span className={`rounded px-1 ${s.mode === 'shared' ? 'bg-emerald-900/50 text-emerald-300' : 'bg-zinc-800 text-zinc-400'}`}>
                          {s.mode}
                        </span>
                        <span>{turnCount} msg</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100">
                      <button onClick={() => startRename(s)} title="Rename" className="rounded px-1 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">✎</button>
                      <button onClick={() => deleteSession(s.id)} title="Delete" className="rounded px-1 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-red-300">🗑</button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </aside>
        </>
      )}

      {/* Main column */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <button
            onClick={() => setDrawerOpen(true)}
            title="Show all sessions"
            className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800"
          >
            ≡ Sessions
          </button>
          <span className="truncate font-mono text-[11px] text-zinc-300" title={active.title}>{active.title}</span>
          <span className="ml-auto flex items-center gap-1 text-[10px] text-zinc-500">
            Mode:
            <button
              onClick={() => setMode('per-file')}
              className={`rounded px-1.5 py-0.5 ${active.mode === 'per-file' ? 'bg-purple-700 text-white' : 'border border-zinc-700 text-zinc-300 hover:bg-zinc-800'}`}
              title="Each file gets its own thread"
            >
              Per-file
            </button>
            <button
              onClick={() => setMode('shared')}
              className={`rounded px-1.5 py-0.5 ${active.mode === 'shared' ? 'bg-purple-700 text-white' : 'border border-zinc-700 text-zinc-300 hover:bg-zinc-800'}`}
              title="One thread for the whole session; file context changes as you switch files"
            >
              Shared
            </button>
          </span>
          {turns.length > 0 && !streaming && (
            <button onClick={clearCurrentThread} title="Clear messages in this thread" className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800">Clear</button>
          )}
        </div>

        {/* Transcript */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {turns.length === 0 ? (
            <div className="text-[11px] leading-relaxed text-zinc-600">
              {active.mode === 'per-file'
                ? <>Ask anything about the <span className="font-mono text-zinc-400">{filePath ? (filePath.split('/').pop() ?? filePath) : 'currently open file'}</span> — what it does, where it's called from, suspicious patterns, what an unfamiliar API does. Each file gets its own thread.</>
                : <>Shared mode: one thread spans every file you open. The agent always sees the file you're currently looking at, plus the full conversation history.</>
              }
            </div>
          ) : (
            <ul className="space-y-3">
              {turns.map((t, i) => (
                <li key={i} className={t.role === 'user' ? 'flex justify-end' : ''}>
                  <div className={`max-w-[92%] rounded px-3 py-2 ${t.role === 'user' ? 'bg-purple-900/40 text-zinc-100' : 'bg-zinc-900/80 text-zinc-200'}`}>
                    {active.mode === 'shared' && t.role === 'user' && t.filePath && (
                      <div className="mb-1 truncate font-mono text-[9px] text-zinc-500" title={t.filePath}>
                        📄 {t.filePath.split('/').pop() ?? t.filePath}
                      </div>
                    )}
                    {t.role === 'user' ? (
                      <div className="whitespace-pre-wrap break-words text-[12px]">{t.content}</div>
                    ) : t.content === '' && streaming && i === turns.length - 1 ? (
                      <div className="text-[11px] italic text-zinc-500">Waiting for first token…</div>
                    ) : (
                      <div className="markdown-answer text-[12px] leading-relaxed">
                        <ReactMarkdown>{t.content}</ReactMarkdown>
                      </div>
                    )}
                    {t.role === 'assistant' && t.content !== '' && (
                      <div className="mt-2 flex items-center gap-3 border-t border-zinc-800 pt-1.5 text-[9px] text-zinc-500">
                        {t.meta && (
                          <span>
                            {t.meta.model} · in {t.meta.in.toLocaleString()} · out {t.meta.out.toLocaleString()}
                            {' '}{estimateCost(t.meta.model, t.meta.in, t.meta.out)}
                          </span>
                        )}
                        <button
                          onClick={() => void copyMarkdown(t.content)}
                          title="Copy raw markdown to clipboard (drop straight into the report)"
                          className="ml-auto rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                        >
                          Copy markdown
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div ref={transcriptEndRef} />
        </div>

        {error && (
          <div className="border-t border-red-900/60 bg-red-950/40 px-3 py-1 text-[11px] text-red-300">
            {error}
          </div>
        )}

        {/* Input */}
        <div className="border-t border-zinc-800 bg-zinc-950/60 p-3">
          <div className="mb-1.5 flex items-center justify-between text-[10px] text-zinc-500">
            <span className="truncate font-mono" title={filePath ?? ''}>
              {filePath ? <>📄 {filePath.split('/').pop() ?? filePath}</> : <span className="italic">No file open</span>}
            </span>
            <span className="ml-2 shrink-0">⏎ to send · ⇧⏎ for newline</span>
          </div>
          <div className="flex items-end gap-2">
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !streaming) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder={active.mode === 'shared' ? 'Ask anything about this project…' : 'Ask anything about this file…'}
              rows={2}
              disabled={streaming}
              className="flex-1 resize-none rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[12px] text-zinc-100 focus:border-purple-500 focus:outline-none disabled:opacity-60"
            />
            <button
              onClick={() => void send()}
              disabled={streaming || !question.trim() || !filePath}
              className="self-stretch rounded bg-purple-600 px-3 text-[12px] font-medium text-white hover:bg-purple-500 disabled:opacity-50"
            >
              {streaming ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
