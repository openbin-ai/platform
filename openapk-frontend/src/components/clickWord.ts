/**
 * Resolve a mouse event on the highlighted code viewer to the Java identifier
 * the user clicked on, plus the immediately-preceding qualifying class if one
 * is present (e.g. clicking the `a` in `c.a(x)` returns { word: "a", qualifyingClass: "c" }).
 *
 * The implementation walks the click target up to the enclosing `.line` span
 * (Shiki's per-line wrapper), reconstructs a linear character offset by
 * walking all text nodes in document order, then runs a simple identifier-
 * char scan around that offset. Returns null on punctuation, whitespace, or
 * non-identifier content.
 */
export type ClickedSymbol = {
  word: string
  qualifyingClass?: string
}

const IDENT = /[A-Za-z0-9_$]/
const IDENT_HEAD = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  type DocLegacy = Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  const d = document as DocLegacy
  if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y)
    if (r) return { node: r.startContainer, offset: r.startOffset }
  }
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y)
    if (p) return { node: p.offsetNode, offset: p.offset }
  }
  return null
}

export function extractClickedSymbol(e: MouseEvent): ClickedSymbol | null {
  const target = e.target as HTMLElement | null
  if (!target) return null
  const lineEl = target.closest('.line') as HTMLElement | null
  if (!lineEl) return null
  const caret = caretAt(e.clientX, e.clientY)
  if (!caret) return null

  // Reconstruct linear offset into the line's textContent by walking text nodes.
  let offset = 0
  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT)
  let cur: Node | null
  let found = false
  while ((cur = walker.nextNode())) {
    if (cur === caret.node) {
      offset += caret.offset
      found = true
      break
    }
    offset += (cur as Text).data.length
  }
  if (!found) return null

  const text = lineEl.textContent ?? ''
  if (offset < 0 || offset > text.length) return null

  let start = offset
  let end = offset
  while (start > 0 && IDENT.test(text[start - 1])) start--
  while (end < text.length && IDENT.test(text[end])) end++
  if (start === end) return null
  const word = text.slice(start, end)
  if (!IDENT_HEAD.test(word)) return null

  // Look behind for a "ClassName." qualifier on the same line.
  let qualifyingClass: string | undefined
  if (start >= 1 && text[start - 1] === '.') {
    const qEnd = start - 1
    let qStart = qEnd
    while (qStart > 0 && IDENT.test(text[qStart - 1])) qStart--
    if (qStart < qEnd) {
      const cand = text.slice(qStart, qEnd)
      if (IDENT_HEAD.test(cand)) qualifyingClass = cand
    }
  }
  return { word, qualifyingClass }
}
