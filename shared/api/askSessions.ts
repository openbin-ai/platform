// Named, multi-session chat state for the Ask AI panels.
//
// Sessions are purely client-side — there is no chat table on the backend,
// which is deliberate: transcripts are cheap to keep locally, they carry
// snippets of the sample under analysis, and nobody wants them on a server
// by default. The tradeoff is that they're per-browser.
//
// Extracted from the BIN ProjectView's inline implementation so the SCRIPT
// panel gets the same behaviour instead of a second, subtly-different copy.
// The BIN panel still has its own inline copy with its own storage keys;
// this module was written to match its on-disk shape so it can adopt this
// later without a migration.

import { useCallback, useEffect, useRef, useState } from 'react'

export type ChatTurn = {
  role: 'user' | 'assistant'
  content: string
  meta?: { model: string; in: number; out: number }
  /**
   * Which unit the question was asked about. Only meaningful in 'shared'
   * mode, where one thread spans many files — it's what lets the transcript
   * show "you asked this about lib/index.js" instead of an unattributed
   * wall of questions.
   */
  context?: string
}

/**
 * per-unit — one thread per file (or function); switching files switches
 *   conversation. Best when investigating files independently.
 * shared — one thread for the whole session, spanning every file you open.
 *   Best for "walk me through this package" narratives, where the model
 *   benefits from remembering what it already saw.
 */
export type SessionMode = 'per-unit' | 'shared'

export type ChatSession = {
  id: string
  title: string
  mode: SessionMode
  /** per-unit: keyed by unit key. shared: everything under SHARED_KEY. */
  threads: Record<string, ChatTurn[]>
  createdAt: number
  updatedAt: number
}

export const SHARED_KEY = '__shared__'
export const UNTITLED = 'Untitled session'

const sessionsKey = (ns: string, projectId: string) => `${ns}.askSessions.${projectId}`
const activeKey = (ns: string, projectId: string) => `${ns}.askActiveSession.${projectId}`

function newId(): string {
  // crypto.randomUUID isn't available on http:// origins in some browsers,
  // and this id only needs to be unique within one localStorage bucket.
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function emptySession(mode: SessionMode = 'per-unit'): ChatSession {
  const now = Date.now()
  return { id: newId(), title: UNTITLED, mode, threads: {}, createdAt: now, updatedAt: now }
}

function load<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota exceeded or storage disabled — transcripts are a convenience,
    // never load-bearing, so dropping the write is the right failure.
  }
}

/**
 * Session store for one project. `ns` namespaces localStorage per product
 * ("openbin.script", "openapk", …) so two apps on the same origin don't
 * fight over a key.
 */
export function useAskSessions(ns: string, projectId: string) {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeId, setActiveId] = useState<string>('')
  // Guards the seed effect so switching projects re-seeds, but a re-render
  // (or a StrictMode double-invoke) doesn't wipe live state.
  const initFor = useRef<string | null>(null)

  useEffect(() => {
    if (initFor.current === projectId) return
    initFor.current = projectId
    const loaded = load<ChatSession[]>(sessionsKey(ns, projectId), [])
    const storedActive = load<string>(activeKey(ns, projectId), '')
    if (loaded.length === 0) {
      const fresh = emptySession()
      setSessions([fresh])
      setActiveId(fresh.id)
      return
    }
    setSessions(loaded)
    // An active id pointing at a deleted session would render an empty
    // panel with no way back; fall back to the most recent.
    const valid = loaded.some((s) => s.id === storedActive)
    setActiveId(valid ? storedActive : loaded.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0].id)
  }, [ns, projectId])

  useEffect(() => {
    if (sessions.length > 0) save(sessionsKey(ns, projectId), sessions)
  }, [ns, projectId, sessions])

  useEffect(() => {
    if (activeId) save(activeKey(ns, projectId), activeId)
  }, [ns, projectId, activeId])

  const active = sessions.find((s) => s.id === activeId) ?? null

  /** Mutate the active session, always refreshing its recency stamp. */
  const updateActive = useCallback((fn: (s: ChatSession) => ChatSession) => {
    setSessions((prev) => prev.map((s) => (s.id === activeId ? { ...fn(s), updatedAt: Date.now() } : s)))
  }, [activeId])

  const newSession = useCallback((mode: SessionMode = 'per-unit') => {
    const fresh = emptySession(mode)
    setSessions((prev) => [fresh, ...prev])
    setActiveId(fresh.id)
  }, [])

  const deleteSession = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id)
      // Never leave the panel session-less — that state has no UI.
      if (next.length === 0) {
        const fresh = emptySession()
        setActiveId(fresh.id)
        return [fresh]
      }
      if (id === activeId) {
        setActiveId(next.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0].id)
      }
      return next
    })
  }, [activeId])

  const renameSession = useCallback((id: string, title: string) => {
    const clean = title.trim().slice(0, 60)
    if (!clean) return
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: clean } : s)))
  }, [])

  const setMode = useCallback((mode: SessionMode) => {
    updateActive((s) => ({ ...s, mode }))
  }, [updateActive])

  return {
    sessions, active, activeId,
    setActiveId, updateActive, newSession, deleteSession, renameSession, setMode,
  }
}

/** Total messages in a session, for the drawer's at-a-glance count. */
export function sessionMessageCount(s: ChatSession): number {
  return Object.values(s.threads).reduce((n, t) => n + t.length, 0)
}
