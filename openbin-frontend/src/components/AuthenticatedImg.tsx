import { useEffect, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { API_BASE } from '@shared/api/client'

/**
 * Renders an <img> for a path that requires Bearer auth.
 *
 * Two backend shapes are supported:
 *   - S3 prod: GET /api/.../media/{name} returns JSON { url: presignedS3Url }.
 *     We set <img src={url}> directly; the presigned URL self-authenticates so
 *     no Bearer is sent on the S3 hop and there's no cross-origin redirect
 *     (Firefox refuses to follow a 302 to S3 when the original fetch carried
 *     an Authorization header).
 *   - Local dev (fs backend): the same endpoint returns image bytes; we read
 *     them as a blob and create a blob URL.
 *
 * Content-Type discriminates between the two responses.
 */
export function AuthenticatedImg({
  src, alt, className,
}: { src: string; alt?: string; className?: string }) {
  const auth = useAuth()
  const token = auth.user?.access_token
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Anonymous /api/public/ media 302s to a presigned S3 URL. A plain <img>
  // follows that redirect fine, but a fetch() would subject the S3 response
  // to CORS (which the bucket doesn't serve) — so never fetch public paths.
  const isPublic = src.includes('/api/public/')
  const needsAuth = !isPublic && (src.startsWith('/api/') || src.startsWith(`${API_BASE}/api/`))

  useEffect(() => {
    if (!needsAuth) return
    let cancelled = false
    let createdBlobUrl: string | null = null
    setError(null)
    setImgUrl(null)
    const absolute = src.startsWith('http') ? src : `${API_BASE}${src}`
    fetch(absolute, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async r => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        const ct = r.headers.get('content-type') ?? ''
        if (ct.includes('application/json')) {
          const json = (await r.json()) as { url: string }
          if (!cancelled) setImgUrl(json.url)
        } else {
          const blob = await r.blob()
          if (cancelled) return
          createdBlobUrl = URL.createObjectURL(blob)
          setImgUrl(createdBlobUrl)
        }
      })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
    return () => {
      cancelled = true
      if (createdBlobUrl) URL.revokeObjectURL(createdBlobUrl)
    }
  }, [src, token, needsAuth])

  if (!needsAuth) {
    const direct = isPublic && src.startsWith('/api/') ? `${API_BASE}${src}` : src
    return <img src={direct} alt={alt ?? ''} className={className} />
  }
  if (error) return <span className="text-xs text-red-400">[image failed: {error}]</span>
  if (!imgUrl) return <span className="text-xs text-zinc-500">[loading image…]</span>
  return <img src={imgUrl} alt={alt ?? ''} className={className} />
}
