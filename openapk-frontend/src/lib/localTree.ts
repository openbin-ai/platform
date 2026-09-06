// Client-side project source. Downloads the whole decompiled tree — the
// same single src.tar.gz object the backend keeps in S3 — via a presigned
// URL, extracts it in the browser (native DecompressionStream + a minimal
// tar parser, same approach as openbin's script-bundle viewer), and serves
// file reads and search from memory. Zero backend CPU per read; the
// server-side /file + /search endpoints remain the fallback for oversized
// trees, pre-S3 projects, and the fs (dev) backend, where /source-bundle
// 404s.
//
// Memory model: text files are decoded to strings at load time and the tar
// buffer is dropped; binary files keep only path + size (their bytes are
// never needed client-side — the viewer shows a placeholder and downloads
// go through /file/raw). The 250MB threshold below bounds the decoded set.

export type SourceBundle = { url: string; compressedBytes: number; etag: string }

export type LocalTree = {
  /** Decoded text file contents keyed by tree-relative path. */
  text: Map<string, string>
  /** Binary (non-UTF-8) file sizes by path — bytes stay server-side. */
  binary: Map<string, number>
  totalBytes: number
}

export type LocalSearchHit = { file: string; line: number; snippet: string }

export type RenameEntry = { original: string; suggested: string; status: string }

/** Above this uncompressed size the UI stays on the server-side endpoints. */
export const LOCAL_TREE_MAX_BYTES = 250 * 1024 * 1024

/**
 * Exact uncompressed size from the gzip ISIZE trailer (last 4 bytes,
 * little-endian, mod 2^32 — irrelevant at our sizes). Costs a 4-byte ranged
 * GET. Null when the host ignores Range (a 200 would make us buffer the
 * whole body just to peek) — caller falls back to an estimate.
 */
export async function gzipUncompressedSize(url: string): Promise<number | null> {
  try {
    const resp = await fetch(url, { headers: { Range: 'bytes=-4' } })
    if (resp.status !== 206) return null
    const buf = new Uint8Array(await resp.arrayBuffer())
    if (buf.length !== 4) return null
    return new DataView(buf.buffer, buf.byteOffset, 4).getUint32(0, true)
  } catch {
    return null
  }
}

/** Download + gunzip + untar + decode. onProgress is 0..1 over compressed bytes. */
export async function loadLocalTree(
  bundle: SourceBundle,
  onProgress?: (frac: number) => void,
): Promise<LocalTree> {
  const resp = await fetch(bundle.url, { cache: 'no-store' })
  if (!resp.ok) throw new Error(`source bundle fetch failed: HTTP ${resp.status}`)
  if (!resp.body) throw new Error('source bundle response has no body')

  let received = 0
  const counted = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength
      if (bundle.compressedBytes > 0) onProgress?.(Math.min(1, received / bundle.compressedBytes))
      controller.enqueue(chunk)
    },
  })
  // Cast: TS's DecompressionStream typing wants BufferSource on the writable
  // side, which pipeThrough's generics reject; the runtime accepts Uint8Array.
  const gunzip = new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>
  const decompressed = resp.body.pipeThrough(counted).pipeThrough(gunzip)
  const raw = new Uint8Array(await new Response(decompressed).arrayBuffer())

  const text = new Map<string, string>()
  const binary = new Map<string, number>()
  let totalBytes = 0
  const td = new TextDecoder('utf-8', { fatal: false })
  for (const e of parseTar(raw)) {
    if (e.type !== 'file') continue
    // Entries come from `tar -czf … -C srcDir .` server-side → "./"-prefixed.
    let p = e.name
    if (p.startsWith('./')) p = p.slice(2)
    // Skip the storage layer's cache sentinels defensively.
    if (!p || p.startsWith('.')) continue
    totalBytes += e.bytes.length
    if (looksTextual(e.bytes)) text.set(p, td.decode(e.bytes))
    else binary.set(p, e.bytes.length)
  }
  // `raw` (and every subarray view into it) is garbage after this returns —
  // only the decoded strings survive.
  return { text, binary, totalBytes }
}

/**
 * Apply the project's APPLIED renames the way the server does on /file reads
 * (RenameService.applyMapToContent): word-boundary substitution, in list
 * order. Not AST-aware — same caveat as the backend.
 */
export function applyRenames(content: string, renames: RenameEntry[]): string {
  let out = content
  for (const r of renames) {
    if (r.status !== 'APPLIED') continue
    out = out.replace(new RegExp(`\\b${escapeRegExp(r.original)}\\b`, 'g'), () => r.suggested)
  }
  return out
}

/**
 * Client-side grep, matching SearchService semantics: substring-or-regex per
 * line over RAW (pre-rename) content, SDK paths filtered unless included,
 * hits capped. Chunked with setTimeout yields so a full-tree scan never
 * freezes the tab.
 */
export async function searchLocalTree(
  tree: LocalTree,
  q: string,
  opts: { caseSensitive: boolean; regex: boolean; includeSdks: boolean; limit?: number },
): Promise<LocalSearchHit[]> {
  const flags = opts.caseSensitive ? '' : 'i'
  let pattern: RegExp
  try {
    pattern = opts.regex ? new RegExp(q, flags) : new RegExp(escapeRegExp(q), flags)
  } catch (e) {
    throw new Error(`invalid regex: ${(e as Error).message}`)
  }
  const cap = Math.max(1, Math.min(opts.limit ?? 200, 1000))
  const hits: LocalSearchHit[] = []
  let scanned = 0
  for (const [path, content] of tree.text) {
    if (hits.length >= cap) break
    if (!opts.includeSdks && isSdkPath(path)) continue
    if (++scanned % 200 === 0) await new Promise((r) => setTimeout(r))
    // Whole-string pre-test first — V8 makes this far cheaper than splitting
    // every file into lines; most files don't match at all.
    if (!pattern.test(content)) continue
    const lines = content.split('\n')
    for (let i = 0; i < lines.length && hits.length < cap; i++) {
      if (pattern.test(lines[i])) {
        hits.push({ file: path, line: i + 1, snippet: snippet(lines[i]) })
      }
    }
  }
  return hits
}

// Mirrors SdkPaths.java — keep the two lists in sync.
const SDK_PREFIXES = [
  'android/', 'androidx/',
  'kotlin/', 'kotlinx/',
  'com/google/', 'com/android/',
  'com/facebook/', 'com/squareup/', 'com/bumptech/',
  'okhttp3/', 'okio/', 'retrofit2/',
  'org/jetbrains/', 'org/apache/', 'org/json/',
  'dagger/', 'javax/', 'jakarta/',
  'io/reactivex/', 'rx/',
]

export function isSdkPath(file: string): boolean {
  let norm = file.replace(/\\/g, '/')
  if (norm.startsWith('sources/')) norm = norm.slice('sources/'.length)
  return SDK_PREFIXES.some((p) => norm.startsWith(p))
}

const SNIPPET_MAX = 240

function snippet(line: string): string {
  const s = line.length > SNIPPET_MAX ? line.slice(0, SNIPPET_MAX) + '…' : line
  return s.replace(/^\s+/, '')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Same shape as ProjectService.looksTextual: NULs or a high ratio of
// non-whitespace control bytes in the first 8KB → binary.
function looksTextual(bytes: Uint8Array): boolean {
  const len = Math.min(bytes.length, 8192)
  if (len === 0) return true
  let suspicious = 0
  for (let i = 0; i < len; i++) {
    const b = bytes[i]
    if (b === 0) return false
    if (b < 0x08 || (b > 0x0d && b < 0x20)) suspicious++
  }
  return suspicious / len < 0.02
}

// ---- minimal tar parser (ustar + GNU long names) --------------------------
// Same fixed-layout approach as openbin's untar.ts: 512-byte headers,
// 512-byte-padded payloads, end = two zero blocks.

type TarEntry = { name: string; type: 'file' | 'dir' | 'other'; bytes: Uint8Array }

function parseTar(buf: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = []
  const td = new TextDecoder('utf-8')
  let offset = 0
  let pendingLongName: string | null = null

  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512)
    if (isZeroBlock(header)) break

    const rawName = readString(header, 0, 100)
    const prefix = readString(header, 345, 155)
    let name = prefix ? `${prefix}/${rawName}` : rawName
    if (pendingLongName) {
      name = pendingLongName
      pendingLongName = null
    }

    const size = parseOctal(header, 124, 12)
    const typeflag = String.fromCharCode(header[156])
    offset += 512

    if (typeflag === 'L') {
      pendingLongName = td.decode(buf.subarray(offset, offset + size)).replace(/\0+$/, '')
      offset += paddedSize(size)
      continue
    }

    const payloadEnd = offset + size
    const bytes = typeflag === '0' || typeflag === '\0'
      ? buf.subarray(offset, payloadEnd)
      : new Uint8Array(0)
    offset += paddedSize(size)

    if (!name) continue
    const type: TarEntry['type'] =
      typeflag === '0' || typeflag === '\0' ? 'file' :
      typeflag === '5' ? 'dir' : 'other'
    entries.push({ name, type, bytes })
  }
  return entries
}

function readString(buf: Uint8Array, offset: number, len: number): string {
  let end = offset
  while (end < offset + len && buf[end] !== 0) end++
  return new TextDecoder('utf-8').decode(buf.subarray(offset, end))
}

function parseOctal(buf: Uint8Array, offset: number, len: number): number {
  const s = readString(buf, offset, len).trim()
  if (!s) return 0
  const n = parseInt(s, 8)
  return Number.isFinite(n) ? n : 0
}

function paddedSize(size: number): number {
  return Math.ceil(size / 512) * 512
}

function isZeroBlock(b: Uint8Array): boolean {
  for (let i = 0; i < 512; i++) if (b[i] !== 0) return false
  return true
}
