import type { HighlighterCore } from 'shiki/core'

// Languages we ship for. Anything else falls back to plaintext.
// Keeping the list small keeps the WASM payload small.
// `c` is used by the Native viewer for Ghidra's decompiled pseudo-C —
// there's no source file with a .c extension in an APK, so EXT_TO_LANG
// intentionally doesn't map to it.
const LANGS = ['java', 'kotlin', 'xml', 'json', 'yaml', 'properties', 'javascript', 'typescript', 'c'] as const
export type Lang = (typeof LANGS)[number] | 'text'

const EXT_TO_LANG: Record<string, Lang> = {
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  xml: 'xml',
  html: 'xml',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  properties: 'properties',
  js: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
}

export function detectLang(path: string): Lang {
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/)
  if (!m) return 'text'
  if (m[1] === 'androidmanifest') return 'xml'
  return EXT_TO_LANG[m[1]] ?? 'text'
}

let highlighterPromise: Promise<HighlighterCore> | null = null

async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterPromise) return highlighterPromise
  highlighterPromise = (async () => {
    const { createHighlighterCore } = await import('shiki/core')
    const { createOnigurumaEngine } = await import('shiki/engine/oniguruma')
    return createHighlighterCore({
      // Both GitHub themes: tokens carry the dark color inline plus a
      // --shiki-light variable, and shared/theme/light.css flips to the
      // variable under html.light. One highlight pass serves both modes.
      themes: [import('@shikijs/themes/github-dark-default'), import('@shikijs/themes/github-light-default')],
      langs: [
        import('@shikijs/langs/java'),
        import('@shikijs/langs/kotlin'),
        import('@shikijs/langs/xml'),
        import('@shikijs/langs/json'),
        import('@shikijs/langs/yaml'),
        import('@shikijs/langs/properties'),
        import('@shikijs/langs/javascript'),
        import('@shikijs/langs/typescript'),
        import('@shikijs/langs/c'),
      ],
      engine: createOnigurumaEngine(import('shiki/wasm')),
    })
  })()
  return highlighterPromise
}

export async function highlight(code: string, lang: Lang): Promise<string> {
  if (lang === 'text') return escapePlain(code)
  const hl = await getHighlighter()
  try {
    return hl.codeToHtml(code, {
      lang,
      themes: { dark: 'github-dark-default', light: 'github-light-default' },
      defaultColor: 'dark',
    })
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
