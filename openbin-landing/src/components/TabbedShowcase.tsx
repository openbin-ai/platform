import { useEffect, useState } from 'react'

// Screenshots from app.openbin.ai showing the platform in action. Each tab
// is a different facet of the workflow - analysis, ask, publish, report.
import aiAnalysisShot from '../assets/screenshots/ai_analysis.png'
import askAiShot from '../assets/screenshots/ask_ai.png'
import graphShot from '../assets/screenshots/graph.png'
import networkShot from '../assets/screenshots/network.png'
import communityShot from '../assets/screenshots/community.png'
import reportShot from '../assets/screenshots/report.png'

type Tab = {
  key: string
  label: string
  caption: string
  src: string
  href: string
}

const TABS: Tab[] = [
  {
    key: 'analysis',
    label: 'AI analysis',
    caption: 'Persistent agent analysis cached per project: hotspots, IOCs, next-step recommendations - visible the moment you open the binary, refined as you ask questions.',
    src: aiAnalysisShot,
    href: '/projects/<id>',
  },
  {
    key: 'ask',
    label: 'Ask the agent',
    caption: 'Talk to a researcher-grade AI that reads decompiled code like an IDE. Every answer cites file:line and a stable function name so you can verify it.',
    src: askAiShot,
    href: '/projects/<id>/ask',
  },
  {
    key: 'callchain',
    label: 'Call graph',
    caption: 'Cmd-click any function to walk callers + callees with AI-narrated summaries - and honest fan-out telling you how many SDK callers were elided.',
    src: graphShot,
    href: '/projects/<id>/graph',
  },
  {
    key: 'network',
    label: 'Network call sites',
    caption: 'Every HTTP endpoint, header, and request body cross-referenced to the call site that built them. Retrofit, OkHttp, libcurl, raw sockets - all one view.',
    src: networkShot,
    href: '/projects/<id>/network',
  },
  {
    key: 'community',
    label: 'Community',
    caption: 'Publish finished analyses for the world to read. Browse other researchers, cite their findings in your reports, build a public corpus of how things actually work.',
    src: communityShot,
    href: '/community',
  },
  {
    key: 'reports',
    label: 'Reports',
    caption: 'Mode-aware MAR / VRR templates ship by default. Annotate any view in the workspace, drop it straight in, export to Markdown or PDF.',
    src: reportShot,
    href: '/projects/<id>/report',
  },
]

export function TabbedShowcase() {
  const [active, setActive] = useState<string>(TABS[0].key)
  const [zoomed, setZoomed] = useState<Tab | null>(null)
  const current = TABS.find(t => t.key === active) ?? TABS[0]

  return (
    <section id="showcase" className="mx-auto max-w-400 px-6 pt-8 pb-24 lg:px-10">
      <h2 className="mb-4 text-center font-mono text-sm font-semibold uppercase tracking-[0.22em] text-amber-400">
        See what shipped
      </h2>
      <p className="mx-auto mb-10 max-w-2xl text-center text-base leading-relaxed text-zinc-300">
        Real product, today. Click a tab to switch the view; click the frame to zoom.
      </p>

      <div role="tablist" className="mb-5 flex flex-wrap justify-center gap-2">
        {TABS.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === active}
            onClick={() => setActive(t.key)}
            className={`rounded-md border px-4 py-2 text-sm font-medium transition ${
              t.key === active
                ? 'border-amber-500/60 bg-amber-900/30 text-amber-200 shadow-[0_0_24px_rgba(251,191,36,0.18)]'
                : 'border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setZoomed(current)}
        className="group block w-full cursor-zoom-in text-left"
        aria-label={`Zoom: ${current.label}`}
      >
        <BrowserFrame href={current.href} src={current.src} alt={current.label} />
      </button>
      <p className="mx-auto mt-5 max-w-3xl text-center text-sm leading-relaxed text-zinc-400">
        {current.caption}
      </p>

      {zoomed && <Lightbox tab={zoomed} onClose={() => setZoomed(null)} />}
    </section>
  )
}

/**
 * Mac-style window chrome around a screenshot. Same idea as the OpenAPK
 * FeatureTour frame but tinted amber to match the OpenBin palette.
 */
function BrowserFrame({ href, src, alt }: { href: string; src: string; alt: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/70 shadow-[0_20px_60px_rgba(251,191,36,0.15)] ring-1 ring-amber-500/10 backdrop-blur transition group-hover:border-amber-500/40 group-hover:shadow-[0_24px_80px_rgba(251,191,36,0.28)]">
      <div className="flex items-center gap-2 border-b border-zinc-800/80 bg-zinc-900/60 px-3 py-2">
        <span className="h-3 w-3 rounded-full bg-red-500/80" />
        <span className="h-3 w-3 rounded-full bg-amber-400/80" />
        <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
        <div className="ml-3 hidden flex-1 truncate rounded-md bg-zinc-950/60 px-3 py-1 font-mono text-[10px] text-zinc-500 sm:block">
          openapk.ai{href}
        </div>
      </div>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="block h-auto w-full"
      />
    </div>
  )
}

function Lightbox({ tab, onClose }: { tab: Tab; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="max-h-full w-full max-w-450" onClick={e => e.stopPropagation()}>
        <BrowserFrame href={tab.href} src={tab.src} alt={tab.label} />
        <div className="mt-4 flex items-start justify-between gap-4">
          <div className="text-zinc-100">
            <p className="text-sm font-semibold">{tab.label}</p>
            <p className="mt-1 text-xs text-zinc-400">{tab.caption}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            aria-label="Close"
          >
            Close (Esc)
          </button>
        </div>
      </div>
    </div>
  )
}
