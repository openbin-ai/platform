import type { HighlighterCore } from 'shiki/core'

// OpenBin renders three Shiki languages: pseudo-C for Ghidra decompiled
// output (BIN flow) and JS/TS for script-analyzer source review. The
// disassembly tab is intentionally NOT a Shiki language — asm tokenization
// is finicky across arches and the per-instruction layout we render is
// much nicer than what Shiki would produce.
let highlighterPromise: Promise<HighlighterCore> | null = null

async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterPromise) return highlighterPromise
  highlighterPromise = (async () => {
    const { createHighlighterCore } = await import('shiki/core')
    const { createOnigurumaEngine } = await import('shiki/engine/oniguruma')
    return createHighlighterCore({
      themes: [import('@shikijs/themes/github-dark-default')],
      langs: [
        import('@shikijs/langs/c'),
        import('@shikijs/langs/javascript'),
        import('@shikijs/langs/typescript'),
        import('@shikijs/langs/json'),
      ],
      engine: createOnigurumaEngine(import('shiki/wasm')),
    })
  })()
  return highlighterPromise
}

/** Render C source to syntax-highlighted HTML. Falls back to escaped plain text on error. */
export async function highlightC(code: string): Promise<string> {
  return highlight(code, 'c')
}

/** Render JS/TS/JSON source. Lang inferred from file extension. */
export async function highlightScript(code: string, filename: string): Promise<string> {
  const lang = inferScriptLang(filename)
  return highlight(code, lang)
}

function inferScriptLang(filename: string): 'javascript' | 'typescript' | 'json' {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.json') || lower.endsWith('.json5') || lower.endsWith('.map')) return 'json'
  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.mts') || lower.endsWith('.cts')) return 'typescript'
  return 'javascript'
}

async function highlight(code: string, lang: 'c' | 'javascript' | 'typescript' | 'json'): Promise<string> {
  const hl = await getHighlighter()
  try {
    return hl.codeToHtml(code, { lang, theme: 'github-dark-default' })
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
