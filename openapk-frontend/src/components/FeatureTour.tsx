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
  caption: 'Watch the agent work through the code as it streams. JADX Java and Kotlin extraction, with hotspots, IOCs and suggested next steps cached on the project.',
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
    caption: 'Cmd-click any method to walk its callers and callees, with a summary on each node. When SDK callers are hidden at a hot method, the view says how many.',
    body: '',
    src: callChainShot,
    href: '/projects/<id>/callchain',
  },
  {
    title: 'Native libraries via Ghidra',
    caption: 'JNI .so files go through Ghidra via the CLI. Functions, strings, imports and decompiled pseudo-C, syntax-highlighted in the same code viewer as the Java.',
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
    caption: 'Anthropic, OpenAI or AWS Bedrock. Keys are encrypted at rest with your KEK. Per-user token budgets and a full audit log, so a runaway loop never surprises your bill.',
    body: '',
    src: apiKeysShot,
    href: '/settings/api-keys',
  },
]

export function FeatureTour() {
  const [zoomed, setZoomed] = useState<Tile | null>(null)

  return (
    <section id="tour" className="mx-auto max-w-6xl px-6 pb-24">
      <h2 className="mb-3 text-center text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
        Screenshots from the product, not mockups.
      </h2>
      <p className="mx-auto mb-12 max-w-2xl text-center text-base text-zinc-400">
        Tap any frame to zoom.
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
 * Plain frame around a screenshot. The one line of chrome is the in-app
 * path, so the reader knows which screen they are looking at; no fake
 * window buttons.
 */
function BrowserFrame({ href, src, alt }: { href: string; src: string; alt: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80 transition group-hover:border-purple-500/50">
      <div className="truncate border-b border-zinc-800 px-4 py-2 font-mono text-xs text-zinc-400">
        openapk.ai{href}
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
