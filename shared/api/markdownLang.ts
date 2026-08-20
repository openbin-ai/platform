// Which fenced-code languages the markdown renderer will highlight.
//
// Shiki throws on an unknown language, so an unrecognised fence must resolve
// to null and render as plain text rather than blowing up the whole post.
// Pure and dependency-free so it can be tested without a bundler.

export const HIGHLIGHT_LANGS = [
  'c', 'cpp', 'javascript', 'typescript', 'json', 'python', 'bash', 'shell',
  'powershell', 'sql', 'yaml', 'xml', 'html', 'java', 'go', 'rust', 'diff',
] as const

export type HighlightLang = (typeof HIGHLIGHT_LANGS)[number]

const ALIASES: Record<string, HighlightLang> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', sh: 'bash', zsh: 'bash', ps1: 'powershell', ps: 'powershell',
  yml: 'yaml', rs: 'rust', golang: 'go', 'c++': 'cpp', h: 'c', htm: 'html',
}

/** Fence info string -> a language Shiki loaded, or null for plain text. */
export function normalizeLang(raw: string | undefined | null): HighlightLang | null {
  if (!raw) return null
  const lower = raw.toLowerCase()
  const mapped = ALIASES[lower]
  if (mapped) return mapped
  return (HIGHLIGHT_LANGS as readonly string[]).includes(lower) ? (lower as HighlightLang) : null
}

/** The language of a fenced block, from react-markdown's className. */
export function langFromClassName(className: string | undefined): HighlightLang | null {
  const m = /language-([\w+#-]+)/.exec(className ?? '')
  return normalizeLang(m?.[1])
}
