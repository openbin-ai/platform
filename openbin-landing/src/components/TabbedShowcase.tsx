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
    caption: 'The agent\'s first pass is cached on the project. Hotspots, IOCs and suggested next steps are there when you open the binary, and they update as you ask questions.',
    src: aiAnalysisShot,
    href: '/projects/<id>',
  },
  {
    key: 'ask',
    label: 'BINNY light',
    caption: 'The in-browser agent. Ask about the code and it reads what it needs, cites lines and addresses, and when you ask, pins highlights, writes report sections and saves scripts on the project.',
    src: askAiShot,
    href: '/projects/<id>/ask',
  },
  {
    key: 'callchain',
    label: 'Call graph',
    caption: 'Cmd-click a function to walk its callers and callees, with a summary on each node. When SDK callers are elided, the view says how many.',
    src: graphShot,
    href: '/projects/<id>/graph',
  },
  {
    key: 'network',
    label: 'Network call sites',
    caption: 'Every HTTP endpoint, header and request body, cross-referenced to the call site that built it. Retrofit, OkHttp, libcurl and raw sockets in one view.',
    src: networkShot,
    href: '/projects/<id>/network',
  },
  {
    key: 'community',
    label: 'Community',
    caption: 'Publish a finished analysis for anyone to read. Browse other researchers\' reports and cite their findings in your own.',
    src: communityShot,
    href: '/community',
  },
  {
    key: 'reports',
    label: 'Reports',
    caption: 'Malware-analysis and vuln-research templates ship by default. Annotate any view in the workspace, drop it into a section, and export to Markdown or PDF.',
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
      <div className="mx-auto mb-10 max-w-3xl text-center">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-amber-400/90">The workspace</p>
        <h2 className="text-3xl font-semibold leading-tight tracking-tight text-zinc-50 sm:text-4xl">
          Screenshots from app.openbin.ai, not mockups.
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-zinc-300">
          Pick a tab to switch screens. Click the frame to zoom.
        </p>
      </div>

      <div role="tablist" className="mb-5 flex flex-wrap justify-center gap-2">
        {TABS.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === active}
            onClick={() => setActive(t.key)}
            className={`rounded-md border px-4 py-2 text-sm font-medium transition ${
              t.key === active
                ? 'border-amber-500/60 bg-amber-900/30 text-amber-200'
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
 * Plain frame around a screenshot. The one line of chrome is the in-app
 * path, so the reader knows which screen of the real product they are
 * looking at; no fake window buttons.
 */
function BrowserFrame({ href, src, alt }: { href: string; src: string; alt: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80 transition group-hover:border-amber-500/50">
      <div className="truncate border-b border-zinc-800 px-4 py-2 font-mono text-xs text-zinc-400">
        app.openbin.ai{href}
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
