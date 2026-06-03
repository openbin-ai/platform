import { useEffect, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { API_BASE } from '@shared/api/client'

/**
 * Renders an <img> for a path that requires Bearer auth. Fetches once, creates
 * a blob URL, revokes on unmount. For non-API URLs (e.g. inline data:),
 * passes through directly.
 */
export function AuthenticatedImg({
  src, alt, className,
}: { src: string; alt?: string; className?: string }) {
  const auth = useAuth()
  const token = auth.user?.access_token
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const needsAuth = src.startsWith('/api/') || src.startsWith(`${API_BASE}/api/`)

  useEffect(() => {
    if (!needsAuth) return
    let cancelled = false
    let createdUrl: string | null = null
    setError(null)
    setBlobUrl(null)
    const absolute = src.startsWith('http') ? src : `${API_BASE}${src}`
    fetch(absolute, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.blob()
      })
      .then(b => {
        if (cancelled) return
        createdUrl = URL.createObjectURL(b)
        setBlobUrl(createdUrl)
      })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [src, token, needsAuth])

  if (!needsAuth) return <img src={src} alt={alt ?? ''} className={className} />
  if (error) return <span className="text-xs text-red-400">[image failed: {error}]</span>
  if (!blobUrl) return <span className="text-xs text-zinc-500">[loading image…]</span>
  return <img src={blobUrl} alt={alt ?? ''} className={className} />
}
