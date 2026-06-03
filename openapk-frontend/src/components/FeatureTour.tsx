import { useEffect, useState } from 'react'

// Screenshots live in src/assets/screenshots/. Vite hashes + fingerprints
// these on build; importing as URL keeps the asset graph honest.
import projectsShot from '../assets/screenshots/projects.png'
import decompiledShot from '../assets/screenshots/decompiled-code-ai-analysis.png'
import callChainShot from '../assets/screenshots/call-chain.png'
import nativeShot from '../assets/screenshots/native-code.png'
import cryptoShot from '../assets/screenshots/crypto.png'
import annotateShot from '../assets/screenshots/code-screenshot-annotating.png'
import reportTemplatesShot from '../assets/screenshots/report-templates.png'
import apiKeysShot from '../assets/screenshots/api-keys.png'

type Tile = {
  title: string
  caption: string
  body: string
  src: string
  href: string // fake URL path shown in the chrome bar
}

const HERO: Tile = {
  title: 'Decompile + AI analysis, side by side',
  caption: 'See the agent reason about the code in real time. JADX-powered Java + Kotlin extraction with persistent hotspots, IOCs, and next-step recommendations cached on the project.',
  body: '',
  src: decompiledShot,
  href: '/projects/<id>/code',
}

const TILES: Tile[] = [
  {
    title: 'Your investigations, organised',
    caption: 'Workflow state per project (uploaded · analyzing · drafting · published), latest analysis cached, mode-aware report templates ready to populate.',
    body: '',
    src: projectsShot,
    href: '/projects',
  },
  {
    title: 'Trace data flow with call chains',
    caption: 'Cmd-click any method to walk callers + callees with AI-narrated summaries. Honest about truncation — see exactly how many SDK callers were hidden at hot methods.',
    body: '',
    src: callChainShot,
    href: '/projects/<id>/callchain',
  },
  {
    title: 'Native libraries via Ghidra',
    caption: 'JNI .so files dispatched to a containerised Ghidra worker. Functions, strings, imports, decompiled pseudo-C — all syntax-highlighted, all in the same code viewer.',
    body: '',
    src: nativeShot,
    href: '/projects/<id>/native',
  },
  {
    title: 'Crypto + obfuscation decoder detection',
    caption: 'Static scan flags javax.crypto sites and hand-rolled Base64+XOR string decoders. One click generates a runnable decryptor script you can drop into your toolkit.',
    body: '',
    src: cryptoShot,
    href: '/projects/<id>/crypto',
  },
  {
    title: 'Capture + annotate for evidence',
    caption: 'In-browser screenshot tool with arrow / box / blur primitives. Saves straight to the project gallery and embeds into report sections as base64 on export.',
    body: '',
    src: annotateShot,
    href: '/projects/<id>/gallery',
  },
  {
    title: 'Custom MAR / VRR templates',
    caption: 'Default malware-analysis or vulnerability-research templates out of the box. Save your own section sets, apply them to any project, share across cases.',
    body: '',
    src: reportTemplatesShot,
    href: '/settings/report-templates',
  },
  {
    title: 'Bring your own model',
    caption: 'Anthropic · OpenAI · AWS Bedrock. Keys encrypted at rest with your KEK. Per-user token budgets + full audit log so a runaway loop never surprises your bill.',
    body: '',
    src: apiKeysShot,
    href: '/settings/api-keys',
  },
]

export function FeatureTour() {
  const [zoomed, setZoomed] = useState<Tile | null>(null)

  return (
    <section id="tour" className="mx-auto max-w-6xl px-6 pb-24">
      <h2 className="mb-3 text-center text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
        See it in action
      </h2>
      <p className="mx-auto mb-12 max-w-2xl text-center text-sm text-zinc-400">
        Tap any frame to zoom. This is the actual product, no mockups.
      </p>

      {/* Hero shot — centered, full-width emphasis */}
      <div className="mb-16">
        <button
          type="button"
          onClick={() => setZoomed(HERO)}
          className="group block w-full cursor-zoom-in text-left"
          aria-label={`Zoom: ${HERO.title}`}
        >
          <BrowserFrame href={HERO.href} src={HERO.src} alt={HERO.title} />
        </button>
        <div className="mx-auto mt-5 max-w-3xl text-center">
          <h3 className="text-lg font-semibold text-zinc-100 sm:text-xl">{HERO.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">{HERO.caption}</p>
        </div>
      </div>

      <div className="space-y-20">
        {TILES.map((t, i) => (
          <ZigZagRow
            key={t.src}
            tile={t}
            imageRight={i % 2 === 0}
            onZoom={() => setZoomed(t)}
          />
        ))}
      </div>

      {zoomed && <Lightbox tile={zoomed} onClose={() => setZoomed(null)} />}
    </section>
  )
}

function ZigZagRow({ tile, imageRight, onZoom }: { tile: Tile; imageRight: boolean; onZoom: () => void }) {
  const copy = (
    <div className="md:max-w-md">
      <h3 className="text-lg font-semibold text-zinc-100 sm:text-xl">{tile.title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-zinc-400 sm:text-base">{tile.caption}</p>
    </div>
  )
  const image = (
    <button
      type="button"
      onClick={onZoom}
      className="group block w-full cursor-zoom-in text-left"
      aria-label={`Zoom: ${tile.title}`}
    >
      <BrowserFrame href={tile.href} src={tile.src} alt={tile.title} />
    </button>
  )
  return (
    <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2 md:gap-12">
      {imageRight ? (
        <>
          <div className="order-2 md:order-1">{copy}</div>
          <div className="order-1 md:order-2">{image}</div>
        </>
      ) : (
        <>
          <div className="order-1">{image}</div>
          <div className="order-2">{copy}</div>
        </>
      )}
    </div>
  )
}

/**
 * Mac-style window chrome around a screenshot. The fake URL bar reads as
 * "real product" without the cost of an actual interactive demo.
 */
function BrowserFrame({ href, src, alt }: { href: string; src: string; alt: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/70 shadow-[0_20px_60px_rgba(124,58,237,0.20)] ring-1 ring-purple-500/10 backdrop-blur transition group-hover:border-purple-500/40 group-hover:shadow-[0_24px_80px_rgba(124,58,237,0.35)]">
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

/**
 * Click anywhere outside the image (or Esc) to close. No focus-trap or
 * portal — single-screenshot lightbox at the bottom of the landing tree,
 * stacking context is fine without it.
 */
function Lightbox({ tile, onClose }: { tile: Tile; onClose: () => void }) {
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
      <div className="max-h-full max-w-7xl" onClick={e => e.stopPropagation()}>
        <BrowserFrame href={tile.href} src={tile.src} alt={tile.title} />
        <div className="mt-4 flex items-start justify-between gap-4">
          <div className="text-zinc-100">
            <p className="text-sm font-semibold">{tile.title}</p>
            <p className="mt-1 text-xs text-zinc-400">{tile.caption}</p>
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
