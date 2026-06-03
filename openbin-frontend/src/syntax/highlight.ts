import type { HighlighterCore } from 'shiki/core'

// OpenBin only renders Ghidra's decompiled pseudo-C in the highlighted pane,
// so we ship a single language to keep the WASM payload tight. The
// disassembly tab is intentionally NOT a Shiki language — asm tokenization
// is finicky across arches and the per-instruction layout we render is much
// nicer than what Shiki would produce.
let highlighterPromise: Promise<HighlighterCore> | null = null

async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterPromise) return highlighterPromise
  highlighterPromise = (async () => {
    const { createHighlighterCore } = await import('shiki/core')
    const { createOnigurumaEngine } = await import('shiki/engine/oniguruma')
    return createHighlighterCore({
      themes: [import('@shikijs/themes/github-dark-default')],
      langs: [import('@shikijs/langs/c')],
      engine: createOnigurumaEngine(import('shiki/wasm')),
    })
  })()
  return highlighterPromise
}

/** Render C source to syntax-highlighted HTML. Falls back to escaped plain text on error. */
export async function highlightC(code: string): Promise<string> {
  const hl = await getHighlighter()
  try {
    return hl.codeToHtml(code, { lang: 'c', theme: 'github-dark-default' })
  } catch {
    return escapePlain(code)
  }
}

function escapePlain(s: string): string {
  const escaped = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<pre class="shiki-plain"><code>${escaped}</code></pre>`
}
