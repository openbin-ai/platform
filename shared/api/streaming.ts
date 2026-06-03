import { useCallback } from 'react'
import { useAuth } from 'react-oidc-context'
import { API_BASE } from './client'

export type StreamCallbacks = {
  onChunk: (text: string) => void
  onDone: (info: { model: string; inputTokens: number; outputTokens: number }) => void
  onError: (message: string) => void
}

/**
 * Streaming POST helper that consumes a Server-Sent Events response body and
 * dispatches each event to typed callbacks. Used for endpoints like /ask/stream
 * where the backend emits incremental text chunks and a final "done" event.
 */
export function useStreamingApi() {
  const auth = useAuth()
  const token = auth.user?.access_token

  return useCallback(
    async (path: string, body: unknown, cb: StreamCallbacks): Promise<void> => {
      const headers = new Headers({
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      })
      if (token) headers.set('Authorization', `Bearer ${token}`)

      let resp: Response
      try {
        resp = await fetch(`${API_BASE}${path}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        })
      } catch (e) {
        cb.onError(`network error: ${(e as Error).message}`)
        return
      }

      if (!resp.ok || !resp.body) {
        const text = await resp.text().catch(() => '')
        cb.onError(`${resp.status} ${resp.statusText}${text ? ': ' + text : ''}`)
        return
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let sep
          while ((sep = buf.indexOf('\n\n')) >= 0) {
            const raw = buf.slice(0, sep)
            buf = buf.slice(sep + 2)
            dispatch(raw, cb)
          }
        }
        if (buf.length > 0) dispatch(buf, cb)
      } catch (e) {
        cb.onError(`stream interrupted: ${(e as Error).message}`)
      }
    },
    [token],
  )
}

function dispatch(raw: string, cb: StreamCallbacks) {
  let name = 'message'
  let dataLines: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) name = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    // ignore comments (lines starting with ":") and other field types
  }
  if (dataLines.length === 0) return
  const data = dataLines.join('\n')
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return
  }
  const obj = parsed as Record<string, unknown>
  if (name === 'chunk') {
    cb.onChunk(typeof obj.text === 'string' ? obj.text : '')
  } else if (name === 'done') {
    cb.onDone({
      model: typeof obj.model === 'string' ? obj.model : '',
      inputTokens: typeof obj.inputTokens === 'number' ? obj.inputTokens : 0,
      outputTokens: typeof obj.outputTokens === 'number' ? obj.outputTokens : 0,
    })
  } else if (name === 'error') {
    cb.onError(typeof obj.message === 'string' ? obj.message : 'stream error')
  }
}
