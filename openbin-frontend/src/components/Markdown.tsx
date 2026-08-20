import { useEffect, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { HIGHLIGHT_LANGS, langFromClassName, type HighlightLang } from '@shared/api/markdownLang'

/**
 * Markdown with syntax-highlighted code blocks.
 *
 * Report sections and blog posts both render user-written markdown, and both
 * are full of code — that's the whole subject matter. Until now a fenced
 * block came out as undifferentiated grey text in a <pre>, which is a poor
 * showing for a reverse-engineering site.
 *
 * Highlighting is async (Shiki loads its WASM engine and grammars on demand),
 * so each block renders as plain text first and upgrades in place. That keeps
 * the post readable immediately instead of blocking paint on a ~1MB engine
 * download, and means a highlighting failure degrades to plain code rather
 * than an empty box.
 *
 * The highlighter is shared across every block on the page via a module-level
 * promise, so N code blocks cost one engine load.
 */

type Loaded = { codeToHtml: (code: string, opts: { lang: string; theme: string }) => string }

let highlighterPromise: Promise<Loaded> | null = null

async function getHighlighter(): Promise<Loaded> {
  if (highlighterPromise) return highlighterPromise
  highlighterPromise = (async () => {
    const { createHighlighter } = await import('shiki')
    return createHighlighter({
      themes: ['github-dark-default'],
      langs: [...HIGHLIGHT_LANGS],
    }) as unknown as Promise<Loaded>
  })()
  return highlighterPromise
}

function CodeBlock({ code, lang }: { code: string; lang: HighlightLang | null }) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    if (!lang) return
    let alive = true
    void (async () => {
      try {
        const hl = await getHighlighter()
        const out = hl.codeToHtml(code, { lang, theme: 'github-dark-default' })
        if (alive) setHtml(out)
      } catch {
        // Leave the plain-text rendering in place.
      }
    })()
    return () => { alive = false }
  }, [code, lang])

  if (html) {
    // Shiki's output is generated from `code` by a tokenizer that emits only
    // <pre>/<span> with class + style attributes — it never passes source
    // text through as markup, so this is not a route from post content to
    // arbitrary HTML.
    return (
      <div
        className="shiki-block overflow-x-auto rounded border border-zinc-800 text-[12.5px] [&>pre]:!bg-zinc-950 [&>pre]:p-3"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  return (
    <pre className="overflow-x-auto rounded border border-zinc-800 bg-zinc-950 p-3 text-[12.5px] text-zinc-300">
      <code>{code}</code>
    </pre>
  )
}

/**
 * `prose` classes are supplied by the caller so each surface keeps its own
 * typography scale; this component only owns code rendering and the image
 * hook that report views already use for signed media URLs.
 */
export function Markdown({
  children,
  img,
}: {
  children: string
  img?: (props: { src?: string; alt?: string }) => ReactNode
}) {
  return (
    <ReactMarkdown
      components={{
        // react-markdown hands inline code and fenced blocks to the same
        // component; only fenced blocks carry a language class, and inline
        // code has no newlines. Treat everything else as inline.
        code({ className, children: kids, ...props }: { className?: string; children?: ReactNode }) {
          const text = String(kids ?? '')
          const lang = langFromClassName(className)
          if (!className && !text.includes('\n')) {
            return (
              <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-200" {...props}>
                {kids}
              </code>
            )
          }
          return <CodeBlock code={text.replace(/\n$/, '')} lang={lang} />
        },
        // A fenced block arrives wrapped in <pre>; CodeBlock renders its own,
        // so unwrap to avoid nesting one inside another.
        pre({ children: kids }: { children?: ReactNode }) {
          return <>{kids}</>
        },
        ...(img ? { img: img as never } : {}),
      }}
    >
      {children}
    </ReactMarkdown>
  )
}
