import { useCallback, useRef, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { ApiError, API_BASE } from '@shared/api/client'
import { SCRIPT_PATHS } from '@shared/api/scripts'

// 10MB hard cap — matches the backend `openapk.script-analyzer.max-upload-bytes`
// default. Real NPM packages are usually <2MB; anything bigger is vendored
// binaries or DoS attempt.
const MAX_BYTES = 10 * 1024 * 1024

type Progress = { sent: number; total: number; filename: string } | null

export function ScriptUploadCard({
  onUploaded,
  onError,
}: {
  onUploaded: () => void
  onError: (msg: string) => void
}) {
  const auth = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<Progress>(null)
  const [dragActive, setDragActive] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return
      const file = files[0]
      if (!file.name.match(/\.(tgz|tar\.gz)$/i)) {
        onError('Expected an NPM tarball (.tgz or .tar.gz)')
        return
      }
      if (file.size > MAX_BYTES) {
        onError(`Tarball exceeds 10MB cap (got ${(file.size / 1024 / 1024).toFixed(1)}MB)`)
        return
      }
      setProgress({ sent: 0, total: file.size, filename: file.name })
      try {
        await uploadWithProgress(
          `${API_BASE}${SCRIPT_PATHS.upload}`,
          file,
          auth.user?.access_token,
          (sent) => setProgress({ sent, total: file.size, filename: file.name }),
          () => setAnalyzing(true),  // server-side analyze starts after upload completes
        )
        onUploaded()
      } catch (e) {
        onError((e as Error).message)
      } finally {
        setProgress(null)
        setAnalyzing(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [auth.user?.access_token, onUploaded, onError],
  )

  const pct = progress ? Math.min(100, Math.round((progress.sent / progress.total) * 100)) : 0
  const busy = progress !== null

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragActive(false)
        if (!busy) void handleFiles(e.dataTransfer.files)
      }}
      className={`overflow-hidden rounded-lg border bg-linear-to-br p-6 shadow-[0_8px_40px_rgba(168,85,247,0.08)] transition ${
        dragActive
          ? 'border-purple-500/70 from-purple-950/50 via-zinc-950/40 to-zinc-950/60'
          : 'border-purple-700/40 from-purple-950/30 via-zinc-950/40 to-zinc-950/60'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded border border-purple-600/60 bg-purple-900/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-purple-300">
          New
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-zinc-50">
            Analyze an NPM package
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-zinc-300">
            Drop a <code className="rounded bg-black/40 px-1 font-mono text-xs text-purple-200">.tgz</code>{' '}
            tarball — install hooks, secret-theft patterns, exfil endpoints, and
            obfuscator.io payloads are flagged statically. Findings come back in
            under a minute.
          </p>

          {busy ? (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="truncate font-mono text-purple-200">{progress?.filename}</span>
                <span className="text-zinc-400">
                  {analyzing ? 'Analyzing in Lambda…' : `${pct}%`}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-zinc-800/80">
                {analyzing ? (
                  <div className="script-bar h-full w-1/3 bg-linear-to-r from-purple-500/40 via-purple-400 to-purple-500/40" />
                ) : (
                  <div
                    className="h-full bg-purple-400 transition-[width] duration-150"
                    style={{ width: `${pct}%` }}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center rounded-md bg-purple-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_20px_rgba(168,85,247,0.4)] transition hover:bg-purple-400"
              >
                Pick .tgz file
              </button>
              <span className="text-xs text-zinc-500">
                or drop a tarball anywhere on this card · max 10 MB
              </span>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".tgz,.tar.gz,application/gzip"
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />

          <p className="mt-4 border-t border-purple-900/40 pt-3 text-xs text-zinc-400">
            Looking for a real-world sample? Run{' '}
            <code className="rounded bg-black/40 px-1 font-mono text-xs text-purple-200">npm pack &lt;package&gt;</code>{' '}
            to grab a tarball you can upload.
          </p>
        </div>
      </div>

      <style>{`
        @keyframes script-bar-slide {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        .script-bar {
          animation: script-bar-slide 1.4s linear infinite;
        }
      `}</style>
    </div>
  )
}

// XHR-based multipart upload. Same pattern as the binary uploader above —
// fetch can't report upload progress, so we keep XHR for the dropzone path
// and let everything else use the shared fetch helper.
function uploadWithProgress(
  url: string,
  file: File,
  token: string | undefined,
  onProgress: (sent: number) => void,
  onUploadComplete: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url, true)
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded)
    }
    xhr.upload.onload = () => {
      onProgress(file.size)
      onUploadComplete()
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new ApiError(xhr.status, `${xhr.status} ${xhr.statusText}: ${xhr.responseText}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.onabort = () => reject(new Error('Upload aborted'))
    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}
