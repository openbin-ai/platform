import { useEffect, useState } from 'react'
import { useApi } from '@shared/api/client'
import { dmProjectChatPath, type DmConversationSummary } from '@shared/api/dm'
import { DmThread } from './MessagesPage'

/**
 * A project's team chat, mounted inside the workspace (side panel) or the
 * overview page. Opens (or creates) the project conversation, then renders
 * the shared thread. Everyone on the roster can read and post, so there is
 * no policy gate to explain; a 404 here means the caller lost access.
 */
export function ProjectChatPanel({ projectId, accent = 'purple' }: { projectId: string; accent?: 'purple' | 'amber' }) {
  const api = useApi()
  const [conv, setConv] = useState<DmConversationSummary | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setConv(null)
    setErr(null)
    api<DmConversationSummary>(dmProjectChatPath(projectId), { method: 'POST' })
      .then((c) => { if (!cancelled) setConv(c) })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'could not open the chat') })
    return () => { cancelled = true }
  }, [api, projectId])

  if (err) return <p className="p-4 text-xs text-red-400">Couldn't open the team chat: {err}</p>
  if (!conv) return <p className="p-4 text-xs text-zinc-500">Opening team chat…</p>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2 text-xs text-zinc-400">
        <span className="font-medium text-zinc-200">Team chat</span>
        <span>· {conv.memberCount} member{conv.memberCount === 1 ? '' : 's'} on this project</span>
      </div>
      <DmThread id={conv.id} summary={conv} accent={accent} hideHeader />
    </div>
  )
}
