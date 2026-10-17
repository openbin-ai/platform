import { useState, type ReactNode } from 'react'

// Building blocks for doc pages. Everything here is plain markup with the
// apps' dark-first zinc palette; light mode comes from shared/theme/light.css.
// Focus rings are explicit on every interactive element because the docs are
// read keyboard-first more than any other page.

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950'

export function P({ children }: { children: ReactNode }) {
  return <p className="text-[15px] leading-relaxed text-zinc-200">{children}</p>
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="text-lg leading-relaxed text-zinc-300">{children}</p>
}

/** Section heading with a stable anchor derived from the text. */
export function H2({ id, children }: { id?: string; children: string }) {
  const anchor = id ?? slugify(children)
  return (
    <h2 id={anchor} className="group mt-10 scroll-mt-24 text-xl font-semibold tracking-tight text-zinc-50 first:mt-0">
      <a href={`#${anchor}`} className={`rounded ${focusRing}`}>
        {children}
        <span aria-hidden className="ml-2 text-zinc-600 opacity-0 transition group-hover:opacity-100">#</span>
      </a>
    </h2>
  )
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-6 text-base font-semibold text-zinc-100">{children}</h3>
}

/** Inline UI label or key cap, so "where to click" reads unambiguously. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="mx-0.5 inline-block rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 align-baseline font-mono text-[12px] leading-none text-zinc-100">
      {children}
    </span>
  )
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-zinc-800/80 px-1 py-0.5 font-mono text-[13px] text-amber-200">{children}</code>
}

/** One terminal line with a copy button. `children` must be the exact text. */
export function Cmd({ children, prompt = '$' }: { children: string; prompt?: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(children)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="group/cmd relative my-2 flex items-start gap-2 rounded-md border border-zinc-800 bg-black/70">
      <code className="block min-w-0 flex-1 overflow-x-auto px-3 py-2 font-mono text-[13px] leading-relaxed text-emerald-300">
        <span className="select-none text-zinc-600">{prompt} </span>
        {children}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy command'}
        className={`m-1.5 shrink-0 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100 ${focusRing}`}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

/** Multi-line code or output. No copy button; it is for reading. */
export function Pre({ children }: { children: string }) {
  return (
    <pre className="my-3 overflow-x-auto rounded-md border border-zinc-800 bg-black/70 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-zinc-200">
      {children}
    </pre>
  )
}

/** Ordered, click-by-click list. The core "do not make me think" unit. */
export function Clicks({ items }: { items: ReactNode[] }) {
  return (
    <ol className="my-3 space-y-2.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-zinc-200">
          <span className="mt-[3px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-400 font-mono text-[11px] font-bold text-black">
            {i + 1}
          </span>
          <span className="min-w-0 flex-1">{it}</span>
        </li>
      ))}
    </ol>
  )
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="my-3 space-y-2 pl-1">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-zinc-200">
          <span aria-hidden className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/80" />
          <span className="min-w-0 flex-1">{it}</span>
        </li>
      ))}
    </ul>
  )
}

export function Tip({ children }: { children: ReactNode }) {
  return (
    <p className="my-3 rounded-md border-l-2 border-amber-500/60 bg-zinc-900/50 px-3 py-2 text-sm leading-relaxed text-zinc-300">
      <span className="font-semibold text-amber-300">Tip </span>
      {children}
    </p>
  )
}

export function Note({ title = 'Note', children }: { title?: string; children: ReactNode }) {
  return (
    <div className="my-3 rounded-md border border-zinc-700 bg-zinc-900/60 px-4 py-3 text-sm leading-relaxed text-zinc-200">
      <p className="font-semibold text-zinc-50">{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  )
}

export function Warn({ children }: { children: ReactNode }) {
  return (
    <div className="my-3 rounded-md border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm leading-relaxed text-zinc-200">
      <p className="font-semibold text-red-300">Watch out</p>
      <div className="mt-1">{children}</div>
    </div>
  )
}

/** Two-column definition table. */
export function Table({ head, rows }: { head: [string, string] | [string, string, string]; rows: ReactNode[][] }) {
  return (
    <div className="my-4 overflow-x-auto rounded-md border border-zinc-800">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-800 font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-400">
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-zinc-800/70 align-top last:border-b-0">
              {r.map((c, j) => (
                <td key={j} className={`px-4 py-2.5 ${j === 0 ? 'whitespace-nowrap font-medium text-zinc-50' : 'text-zinc-300'}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Img({ src, alt, caption }: { src?: string; alt: string; caption?: string }) {
  if (!src) return null
  return (
    <figure className="my-5">
      <img src={src} alt={alt} loading="lazy" decoding="async" className="w-full rounded-lg border border-zinc-800 shadow-lg" />
      {caption && <figcaption className="mt-2 text-center text-xs text-zinc-500">{caption}</figcaption>}
    </figure>
  )
}

export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`rounded text-amber-300 underline decoration-amber-400/40 underline-offset-4 hover:decoration-amber-300 ${focusRing}`}>
      {children}
    </a>
  )
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
