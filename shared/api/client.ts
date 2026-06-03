import { useCallback } from 'react'
import { useAuth } from 'react-oidc-context'

// Both openapk.ai and openbin.ai talk to the same Spring Boot backend, so
// this base URL is shared. In prod each frontend sets VITE_API_BASE to the
// public api domain (eg `https://api.openapk.ai`); dev falls back to the
// local backend.
//
// Exported so report download / print views can build raw fetch URLs for
// non-JSON responses — useApi parses content-type and expects JSON/text, so
// blob endpoints bypass it.
export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8081'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function useApi() {
  const auth = useAuth()
  const token = auth.user?.access_token

  return useCallback(
    async <T = unknown>(path: string, init?: RequestInit): Promise<T> => {
      const headers = new Headers(init?.headers)
      if (token) headers.set('Authorization', `Bearer ${token}`)
      // Don't set Content-Type for FormData — the browser must set it with the
      // multipart boundary. Only default to JSON for plain string/blob bodies.
      if (init?.body && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json')
      }
      const resp = await fetch(`${API_BASE}${path}`, { ...init, headers })
      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        throw new ApiError(
          resp.status,
          `${resp.status} ${resp.statusText}${text ? ': ' + text : ''}`,
        )
      }
      if (resp.status === 204) return undefined as T
      const ct = resp.headers.get('content-type') ?? ''
      if (ct.includes('application/json')) return (await resp.json()) as T
      return (await resp.text()) as unknown as T
    },
    [token],
  )
}
