// In-browser tar.gz extractor used by ScriptProjectView to render the
// deobfuscated source bundle. Avoids a tar-reader dep — the format is
// fixed-layout, 512-byte headers + 512-byte-padded payloads, and the only
// fields we care about (name, size, type) are at well-known offsets.
//
// Gunzip uses the built-in DecompressionStream (Chrome / Edge / Firefox
// since 2023, Safari 16.4+). No fallback for older Safari — the upload
// flow's drag-and-drop already requires modern APIs.

export type TarEntry = {
  /** Path inside the tarball — caller is responsible for stripping any wrappers. */
  name: string
  /** 'file' for regular files, 'dir' for directories, 'other' for symlinks/longlinks/etc. */
  type: 'file' | 'dir' | 'other'
  /** Raw bytes. Empty for directories. */
  bytes: Uint8Array
}

/**
 * Download a .tar.gz from a URL and yield each entry. Streams through the
 * gunzip + tar parse so we never hold the full compressed body in memory
 * simultaneously with the parsed entries (still ~2× peak vs raw, but
 * acceptable for the 25 MB upload cap we enforce server-side).
 */
export async function extractTarGz(url: string): Promise<TarEntry[]> {
  const resp = await fetch(url, { cache: 'no-store' })
  if (!resp.ok) throw new Error(`bundle fetch failed: HTTP ${resp.status}`)
  if (!resp.body) throw new Error('bundle response has no body')

  // Pipe gzip → decompressed bytes, then collect into a single Uint8Array.
  // We need random access for the 512-byte header parsing so we can't
  // really stream the tar pass; sizes here are small enough (<25 MB
  // uncompressed) that buffering once is fine.
  const decompressed = resp.body.pipeThrough(new DecompressionStream('gzip'))
  const raw = new Uint8Array(await new Response(decompressed).arrayBuffer())
  return parseTar(raw)
}

// Tar header reference: each entry is a 512-byte header followed by the
// file payload, NUL-padded to the next 512-byte boundary. We support the
// ustar variant plus GNU long-name extensions because npm tarballs use
// both. End-of-archive is two consecutive zero blocks.
function parseTar(buf: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = []
  const td = new TextDecoder('utf-8')
  let offset = 0
  // Carry-forward state for GNU long-name records ('L' typeflag) — those
  // records hold a name that applies to the NEXT real entry.
  let pendingLongName: string | null = null

  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512)
    // Empty block — possible end-of-archive marker.
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

    // GNU long-name: payload is the NUL-terminated name for the next
    // entry. Don't return it as a real file.
    if (typeflag === 'L') {
      const longName = td.decode(buf.subarray(offset, offset + size)).replace(/\0+$/, '')
      pendingLongName = longName
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
  // Sizes in tar headers are NUL-terminated octal strings, optionally with
  // a leading space. Empty / unparseable → 0 (consistent with how the rest
  // of the parser treats malformed records).
  const s = readString(buf, offset, len).trim()
  if (!s) return 0
  const n = parseInt(s, 8)
  return Number.isFinite(n) ? n : 0
}

function paddedSize(size: number): number {
  // Each payload is padded to a multiple of 512.
  return Math.ceil(size / 512) * 512
}

function isZeroBlock(b: Uint8Array): boolean {
  for (let i = 0; i < 512; i++) if (b[i] !== 0) return false
  return true
}

// -----------------------------------------------------------------------
// Tree builder used by the file browser.

export type FileNode = {
  name: string
  /** Full path from the bundle root (no leading slash). */
  path: string
  kind: 'file' | 'dir'
  size: number
  children?: FileNode[]
}

/**
 * Build a sorted directory tree from a flat list of tar entries. Strips
 * a single optional leading prefix (e.g. 'original/') so the UI can show
 * the package as the root without forcing the caller to know about the
 * bundle's internal layout.
 */
export function buildTree(entries: TarEntry[], prefix = ''): FileNode {
  const root: FileNode = { name: '', path: '', kind: 'dir', size: 0, children: [] }
  for (const e of entries) {
    if (e.type !== 'file') continue
    let p = e.name
    if (prefix && p.startsWith(prefix)) p = p.slice(prefix.length)
    if (!p) continue
    insertPath(root, p.split('/').filter(Boolean), e.bytes.byteLength)
  }
  sortTree(root)
  return root
}

function insertPath(node: FileNode, parts: string[], size: number) {
  if (parts.length === 0) return
  const [head, ...rest] = parts
  if (!node.children) node.children = []
  let child = node.children.find((c) => c.name === head)
  if (rest.length === 0) {
    const path = node.path ? `${node.path}/${head}` : head
    if (!child) {
      node.children.push({ name: head, path, kind: 'file', size })
    } else {
      child.kind = 'file'
      child.size = size
    }
    return
  }
  if (!child) {
    const path = node.path ? `${node.path}/${head}` : head
    child = { name: head, path, kind: 'dir', size: 0, children: [] }
    node.children.push(child)
  }
  insertPath(child, rest, size)
}

function sortTree(node: FileNode) {
  if (!node.children) return
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const c of node.children) sortTree(c)
}
