import { useCallback, useRef, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import JSZip from 'jszip'
import { ApiError, API_BASE } from '@shared/api/client'
import { SCRIPT_PATHS } from '@shared/api/scripts'

// 25 MB hard cap — matches openapk.script-analyzer.max-upload-bytes. Real
// malicious packages are <2 MB; the rest of the headroom is for unpacked
// monorepos or audit drops with bundled test fixtures.
const MAX_BYTES = 25 * 1024 * 1024

type Progress = { sent: number; total: number; filename: string } | null

// Accept any of: NPM tarball, PyPI sdist (.tar.gz with setup.py), wheel
// (.whl), zip archive, single .js / .py / .ps1 / .sh, or a folder (browser
// packs it into a zip client-side before POST). Spring sniffs the archive
// contents and routes to the npm / pypi / shell worker.
const ACCEPT_FILES = '.tgz,.tar.gz,.zip,.whl,.js,.mjs,.cjs,.py,.ps1,.psm1,.sh,.bash,.zsh,application/gzip,application/zip,application/javascript,text/javascript,text/x-python,text/x-shellscript'

export function ScriptUploadCard({
  onUploaded,
  onError,
}: {
  onUploaded: () => void
  onError: (msg: string) => void
}) {
  const auth = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<Progress>(null)
  const [dragActive, setDragActive] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [packing, setPacking] = useState(false)

  const handleSingleFile = useCallback(
    async (rawFile: File, displayName?: string) => {
      const file = displayName ? new File([rawFile], displayName, { type: rawFile.type }) : rawFile
      if (file.size > MAX_BYTES) {
        onError(`Upload exceeds 25 MB cap (got ${(file.size / 1024 / 1024).toFixed(1)} MB)`)
        return
      }
      setProgress({ sent: 0, total: file.size, filename: file.name })
      try {
        await uploadWithProgress(
          `${API_BASE}${SCRIPT_PATHS.upload}`,
          file,
          auth.user?.access_token,
          (sent) => setProgress({ sent, total: file.size, filename: file.name }),
          () => setAnalyzing(true),
        )
        onUploaded()
      } catch (e) {
        onError((e as Error).message)
      } finally {
        setProgress(null)
        setAnalyzing(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
        if (folderInputRef.current) folderInputRef.current.value = ''
      }
    },
    [auth.user?.access_token, onUploaded, onError],
  )

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return
      // Multiple files at once = treat as a folder upload and zip them.
      // Single file with no folder shape = upload as-is.
      if (files.length === 1 && !(files[0] as File & { webkitRelativePath?: string }).webkitRelativePath) {
        await handleSingleFile(files[0])
        return
      }
      // Folder mode: bundle into a single .zip client-side so the existing
      // upload endpoint sees one file. We don't need to honor `.gitignore`
      // — the analyzer skips node_modules + .git already.
      setPacking(true)
      try {
        const zip = new JSZip()
        let rootName = ''
        for (let i = 0; i < files.length; i++) {
          const f = files[i] as File & { webkitRelativePath?: string }
          const rel = f.webkitRelativePath || f.name
          if (!rootName) rootName = rel.split('/')[0] || 'upload'
          zip.file(rel, await f.arrayBuffer())
        }
        const blob = await zip.generateAsync({
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 },
        })
        const packedFile = new File([blob], `${rootName}.zip`, { type: 'application/zip' })
        setPacking(false)
        await handleSingleFile(packedFile)
      } catch (e) {
        setPacking(false)
        onError(`Failed to package folder: ${(e as Error).message}`)
      }
    },
    [handleSingleFile, onError],
  )

  const pct = progress ? Math.min(100, Math.round((progress.sent / progress.total) * 100)) : 0
  const busy = progress !== null || packing

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragActive(false)
        if (busy) return
        // Drag-and-drop can include directories via DataTransferItem.
        const items = e.dataTransfer.items
        const hasDir = items && Array.from(items).some(
          (it) => it.kind === 'file' && (it as DataTransferItem).webkitGetAsEntry()?.isDirectory)
        if (hasDir) {
          void handleDroppedDirs(items, handleFiles, onError)
        } else {
          void handleFiles(e.dataTransfer.files)
        }
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
            Analyze an npm / PyPI package or loose shell script
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-zinc-300">
            Drop a <code className="rounded bg-black/40 px-1 font-mono text-xs text-purple-200">.tgz</code>,{' '}
            <code className="rounded bg-black/40 px-1 font-mono text-xs text-purple-200">.whl</code>,{' '}
            <code className="rounded bg-black/40 px-1 font-mono text-xs text-purple-200">.zip</code>,{' '}
            single <code className="rounded bg-black/40 px-1 font-mono text-xs text-purple-200">.js</code>/<code className="rounded bg-black/40 px-1 font-mono text-xs text-purple-200">.py</code>/<code className="rounded bg-black/40 px-1 font-mono text-xs text-purple-200">.ps1</code>/<code className="rounded bg-black/40 px-1 font-mono text-xs text-purple-200">.sh</code>,{' '}
            or a folder — install hooks, drive-by execution, encoded commands, secret
            theft, exfil endpoints, and persistence writes are flagged statically.
            Results back in under a minute.
          </p>

          {busy ? (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="truncate font-mono text-purple-200">
                  {packing ? 'Zipping folder…' : progress?.filename}
                </span>
                <span className="text-zinc-400">
                  {packing ? '…' : analyzing ? 'Analyzing in Lambda…' : `${pct}%`}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-zinc-800/80">
                {packing || analyzing ? (
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
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center rounded-md bg-purple-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_20px_rgba(168,85,247,0.4)] transition hover:bg-purple-400"
              >
                Pick file
              </button>
              <button
                onClick={() => folderInputRef.current?.click()}
                className="inline-flex items-center justify-center rounded-md border border-purple-500/60 bg-purple-950/40 px-4 py-2 text-sm font-semibold text-purple-200 transition hover:bg-purple-900/60"
              >
                Pick folder
              </button>
              <span className="text-xs text-zinc-500">
                or drop anywhere on this card · max 25 MB
              </span>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_FILES}
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <input
            ref={folderInputRef}
            type="file"
            // webkitdirectory is a non-standard but widely-supported attribute
            // that switches the OS picker to folder mode. Files come back
            // with .webkitRelativePath set, which JSZip uses to rebuild the
            // tree before compressing.
            // @ts-expect-error — webkitdirectory not in lib.dom yet
            webkitdirectory=""
            // directory is the Firefox-specific spelling; lib.dom now types it
            directory=""
            multiple
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />

          <p className="mt-4 border-t border-purple-900/40 pt-3 text-xs text-zinc-400">
            Looking for a real-world sample? Datadog publishes 877 confirmed-malicious
            packages at{' '}
            <a
              href="https://github.com/DataDog/malicious-software-packages-dataset"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-300 underline-offset-2 hover:underline"
            >
              datadog/malicious-software-packages-dataset
            </a>
            {' '}— zip password is{' '}
            <code className="rounded bg-black/40 px-1 font-mono text-[11px] text-purple-200">infected</code>.
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

// Drag-and-drop a directory: the OS gives us a DataTransferItemList of
// FileSystemEntries (not a flat FileList), so we walk the tree ourselves
// and synthesize a FileList for `handleFiles`. webkitGetAsEntry is the
// pre-standard but universally-supported API.
async function handleDroppedDirs(
  items: DataTransferItemList,
  onFiles: (fl: FileList | null) => void | Promise<void>,
  onError: (msg: string) => void,
) {
  try {
    const all: File[] = []
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry()
      if (!entry) continue
      await walkEntry(entry, '', all)
    }
    if (all.length === 0) {
      onError('Dropped folder was empty')
      return
    }
    // Synthesize a FileList-shaped object — DataTransfer is constructable in
    // modern browsers and lets us hand the same shape `handleFiles` expects.
    const dt = new DataTransfer()
    for (const f of all) dt.items.add(f)
    await onFiles(dt.files)
  } catch (e) {
    onError(`Folder read failed: ${(e as Error).message}`)
  }
}

type FsEntry = FileSystemEntry & {
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void
  createReader?: () => { readEntries: (cb: (entries: FsEntry[]) => void) => void }
}

async function walkEntry(entry: FsEntry, prefix: string, out: File[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((res, rej) => entry.file!(res, rej))
    // Attach the relative path the same way <input webkitdirectory> would,
    // so the zipping step sees a consistent shape regardless of input mode.
    Object.defineProperty(file, 'webkitRelativePath', {
      value: prefix + file.name,
      configurable: true,
    })
    out.push(file)
  } else if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader()
    // readEntries returns at most ~100 entries per call; loop until empty.
    let batch: FsEntry[]
    do {
      batch = await new Promise<FsEntry[]>((res) => reader.readEntries(res))
      for (const e of batch) await walkEntry(e, prefix + entry.name + '/', out)
    } while (batch.length > 0)
  }
}

// XHR-based multipart upload. fetch can't report upload progress, so we
// keep XHR for the dropzone path and let everything else use the shared
// fetch helper.
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
        // Spring's error responses are JSON: { timestamp, status, error,
        // message, path }. Surface just the `message` field so the error
        // banner reads as a single human sentence ("This zip is encrypted…")
        // instead of a raw JSON dump.
        let detail = xhr.responseText
        try {
          const j = JSON.parse(xhr.responseText)
          if (typeof j?.message === 'string' && j.message.length > 0) detail = j.message
        } catch { /* not JSON, use raw text */ }
        reject(new ApiError(xhr.status, detail))
      }
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.onabort = () => reject(new Error('Upload aborted'))
    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}
