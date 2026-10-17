import { useEffect, useMemo, useRef, useState } from 'react'
import { DOC_SECTIONS } from './content'
import { Img, Lead, focusRing } from './primitives'
import { pageVisible, type DocApp, type DocCtx, type DocPage, type DocSection, type InstallScript, type LinkComponent } from './types'

/**
 * The docs site both apps render at /docs/*. One content tree
 * (shared/docs/content.tsx), filtered per app; the host app passes its router
 * Link, the current pathname, its screenshots and its install URL helper.
 *
 * URL shape: /docs/<section>/<page>. Bare /docs opens the first page. Unknown
 * paths render a not-found state inside the shell so the sidebar stays.
 */
export function DocsShell({
  app,
  appName,
  appUrl,
  pathname,
  Link,
  images,
  installScriptUrl,
}: {
  app: DocApp
  appName: string
  appUrl: string
  pathname: string
  Link: LinkComponent
  images: Record<string, string | undefined>
  installScriptUrl: (file: InstallScript) => string
}) {
  const sections = useMemo(
    () =>
      DOC_SECTIONS.filter((s) => pageVisible(app, s))
        .map((s) => ({ ...s, pages: s.pages.filter((p) => pageVisible(app, p)) }))
        .filter((s) => s.pages.length > 0),
    [app],
  )
  const flat = useMemo(() => sections.flatMap((s) => s.pages.map((p) => ({ section: s, page: p }))), [sections])

  const { section, page, notFound } = resolve(pathname, sections, flat)
  const index = flat.findIndex((f) => f.page === page)
  const prev = index > 0 ? flat[index - 1] : null
  const next = index >= 0 && index < flat.length - 1 ? flat[index + 1] : null

  const ctx: DocCtx = { app, appName, appUrl, images, installScriptUrl, Link }

  const [query, setQuery] = useState('')
  const [navOpen, setNavOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // Jump to the top of the article on page change; the browser keeps the
  // scroll position otherwise because the shell element does not remount.
  useEffect(() => {
    if (!pathname.includes('#')) window.scrollTo({ top: 0 })
    setNavOpen(false)
  }, [pathname])

  useEffect(() => {
    document.title = `${page.title} · ${appName} docs`
    return () => { document.title = appName }
  }, [page.title, appName])

  // "/" focuses search unless the user is already typing somewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    const terms = q.split(/\s+/)
    return flat
      .map((f) => ({ ...f, score: score(f.page, f.section, terms) }))
      .filter((f) => f.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
  }, [query, flat])

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:gap-12 lg:py-12">
        {/* Sidebar */}
        <aside className="lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pr-2">
          <div className="flex items-center justify-between gap-3 lg:block">
            <label className="relative block flex-1">
              <span className="sr-only">Search the docs</span>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search docs"
                className={`w-full rounded-md border border-zinc-800 bg-zinc-900/70 py-2 pl-3 pr-9 text-sm text-zinc-100 placeholder:text-zinc-500 ${focusRing}`}
              />
              <kbd aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-zinc-700 px-1.5 font-mono text-[10px] text-zinc-500">
                /
              </kbd>
            </label>
            <button
              type="button"
              onClick={() => setNavOpen((o) => !o)}
              aria-expanded={navOpen}
              aria-controls="docs-nav"
              className={`rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-200 lg:hidden ${focusRing}`}
            >
              {navOpen ? 'Hide pages' : 'All pages'}
            </button>
          </div>

          {results ? (
            <SearchResults results={results} Link={Link} onPick={() => setQuery('')} />
          ) : (
            <nav id="docs-nav" aria-label="Documentation" className={`${navOpen ? 'block' : 'hidden'} mt-5 lg:block`}>
              {sections.map((s) => (
                <div key={s.id} className="mb-6">
                  <p className="mb-1.5 px-2 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">{s.title}</p>
                  <ul>
                    {s.pages.map((p) => {
                      const active = p === page && !notFound
                      return (
                        <li key={p.slug}>
                          <Link
                            to={`/docs/${s.id}/${p.slug}`}
                            aria-current={active ? 'page' : undefined}
                            className={`block rounded-md border-l-2 px-3 py-1.5 text-sm transition ${focusRing} ${
                              active
                                ? 'border-amber-400 bg-amber-500/10 text-amber-200'
                                : 'border-transparent text-zinc-300 hover:bg-zinc-900 hover:text-zinc-50'
                            }`}
                          >
                            {p.title}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          )}
        </aside>

        {/* Article */}
        <article className="mt-8 min-w-0 lg:mt-0">
          {notFound ? (
            <NotFound Link={Link} first={flat[0]} />
          ) : (
            <>
              <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-amber-400/90">{section.title}</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">{page.title}</h1>
              <div className="mt-3">
                <Lead>{page.summary}</Lead>
              </div>
              {page.image && <Img src={images[page.image.key]} alt={page.image.alt} />}
              <div className="mt-6 space-y-3">{page.body(ctx)}</div>

              <nav aria-label="Previous and next page" className="mt-14 grid gap-3 border-t border-zinc-800 pt-6 sm:grid-cols-2">
                {prev ? <PagerLink Link={Link} dir="prev" item={prev} /> : <span />}
                {next ? <PagerLink Link={Link} dir="next" item={next} /> : <span />}
              </nav>

              <p className="mt-10 text-xs text-zinc-500">
                Something missing or wrong on this page? Say so in the{' '}
                <a href="https://discord.gg/HQsCZBHXwc" target="_blank" rel="noopener noreferrer" className={`rounded text-zinc-300 underline underline-offset-4 ${focusRing}`}>
                  Discord
                </a>{' '}
                or open an issue on{' '}
                <a href="https://github.com/openbin-ai/platform/issues" target="_blank" rel="noopener noreferrer" className={`rounded text-zinc-300 underline underline-offset-4 ${focusRing}`}>
                  GitHub
                </a>
                .
              </p>
            </>
          )}
        </article>
      </div>
    </div>
  )
}

type Flat = { section: DocSection; page: DocPage }

function resolve(pathname: string, sections: DocSection[], flat: Flat[]): Flat & { notFound: boolean } {
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/') // ["docs", section?, page?]
  const [, sid, pslug] = parts
  const first = flat[0]
  if (!sid) return { ...first, notFound: false }
  // Legacy: /docs/cli pointed at the old CLI reference page.
  if (sid === 'cli' && !pslug) {
    const hit = flat.find((f) => f.section.id === 'cli')
    if (hit) return { ...hit, notFound: false }
  }
  const section = sections.find((s) => s.id === sid)
  if (!section) return { ...first, notFound: true }
  const page = pslug ? section.pages.find((p) => p.slug === pslug) : section.pages[0]
  if (!page) return { section, page: section.pages[0], notFound: true }
  return { section, page, notFound: false }
}

function score(page: DocPage, section: DocSection, terms: string[]): number {
  const title = page.title.toLowerCase()
  const summary = page.summary.toLowerCase()
  const keys = (page.keywords ?? []).join(' ')
  const sec = section.title.toLowerCase()
  let s = 0
  for (const t of terms) {
    if (title.includes(t)) s += 5
    if (keys.includes(t)) s += 3
    if (summary.includes(t)) s += 2
    if (sec.includes(t)) s += 1
  }
  // Every term must match somewhere.
  return terms.every((t) => title.includes(t) || keys.includes(t) || summary.includes(t) || sec.includes(t)) ? s : 0
}

function SearchResults({ results, Link, onPick }: { results: (Flat & { score: number })[]; Link: LinkComponent; onPick: () => void }) {
  return (
    <div className="mt-4" role="region" aria-live="polite" aria-label="Search results">
      {results.length === 0 ? (
        <p className="px-2 py-3 text-sm text-zinc-500">No pages match. Try a feature name, like "fork" or "highlights".</p>
      ) : (
        <ul className="space-y-1">
          {results.map((r) => (
            <li key={`${r.section.id}/${r.page.slug}`}>
              <Link
                to={`/docs/${r.section.id}/${r.page.slug}`}
                onClick={onPick}
                className={`block rounded-md px-3 py-2 hover:bg-zinc-900 ${focusRing}`}
              >
                <span className="block text-sm text-zinc-100">{r.page.title}</span>
                <span className="block text-xs text-zinc-500">{r.section.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PagerLink({ Link, dir, item }: { Link: LinkComponent; dir: 'prev' | 'next'; item: Flat }) {
  return (
    <Link
      to={`/docs/${item.section.id}/${item.page.slug}`}
      className={`block rounded-lg border border-zinc-800 px-4 py-3 transition hover:border-amber-500/50 ${focusRing} ${dir === 'next' ? 'text-right' : ''}`}
    >
      <span className="block font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">{dir === 'prev' ? 'Previous' : 'Next'}</span>
      <span className="mt-1 block text-sm font-medium text-zinc-100">{item.page.title}</span>
    </Link>
  )
}

function NotFound({ Link, first }: { Link: LinkComponent; first: Flat }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-8">
      <h1 className="text-2xl font-semibold text-zinc-50">No page here</h1>
      <p className="mt-2 text-sm text-zinc-300">The link may be old. Pick a page from the list, or start from the beginning.</p>
      <Link to={`/docs/${first.section.id}/${first.page.slug}`} className={`mt-5 inline-block rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-300 ${focusRing}`}>
        Start here
      </Link>
    </div>
  )
}
