import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import iconUrl from '../assets/icon.png'
import cliDecompile from '../assets/docs/cli-decompile.png'
import askAi from '../assets/docs/project-view-ask-ai.png'
import screenshotAnnotate from '../assets/docs/screenshot-annotate.png'
import reportInProject from '../assets/docs/report-in-project.png'
import reportPublish from '../assets/docs/report-publish.png'

/**
 * Public, anonymous-readable how-to. Walks the full loop a new user follows —
 * CLI decompile → open the analysis & ask AI → capture a screenshot → build a
 * report → publish it — with the exact buttons to click at each step. Lives
 * outside Layout/RequireAuth (see App.tsx) so prospective users can read it
 * before signing in. Self-contained chrome (header/footer) since the shared
 * Layout is auth-gated.
 */
export function Docs() {
  // Smooth in-page jumps from the step nav; restore on unmount is automatic.
  useEffect(() => {
    const prev = document.documentElement.style.scrollBehavior
    document.documentElement.style.scrollBehavior = 'smooth'
    return () => { document.documentElement.style.scrollBehavior = prev }
  }, [])

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      {/* header */}
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link to="/" className="flex items-center gap-2 transition hover:opacity-80">
            <img src={iconUrl} alt="OpenBin" className="h-7 w-7" />
            <span className="text-sm font-semibold tracking-wide">
              OPENBIN<span className="text-amber-400">.AI</span>
            </span>
            <span className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
              Docs
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/projects" className="text-zinc-300 hover:text-amber-400">Open app</Link>
            <Link to="/community" className="text-zinc-300 hover:text-amber-400">Community</Link>
            <a
              href="https://github.com/openbin-ai/platform"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-300 hover:text-amber-400"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        {/* intro */}
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-amber-400/90">
          Quick start
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
          From a binary to a published report
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-zinc-300">
          The whole workflow in five steps — decompile a file, explore it with an AI
          agent, capture evidence, write your report, and share it with the community.
          Every step tells you exactly where to click.
        </p>

        {/* step jump-nav */}
        <nav className="mt-8 grid gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 sm:grid-cols-2">
          {STEPS.map((s, i) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800/60 hover:text-zinc-100"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400 font-mono text-xs font-bold text-black">
                {i + 1}
              </span>
              {s.navTitle}
            </a>
          ))}
        </nav>

        {/* prerequisites */}
        <section className="mt-10 rounded-xl border border-amber-700/40 bg-amber-950/20 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-amber-300">
            Before you start (one minute)
          </h2>
          <ol className="mt-3 space-y-2 text-sm leading-relaxed text-zinc-200">
            <li>
              <strong>Sign in.</strong> Click <Kbd>Sign in</Kbd> (top-right of the app) — it's
              free and opens your browser to authenticate.
            </li>
            <li>
              <strong>Add your AI key.</strong> Go to{' '}
              <Kbd>Settings ▾ → API Keys</Kbd>, paste a key from Anthropic, OpenAI, or
              AWS Bedrock, and click <Kbd>Save</Kbd>. You bring your own key, so you only
              ever pay your AI provider — OpenBin charges <span className="text-amber-300">$0</span>{' '}
              for inference. Without a key, the <em>Ask</em> assistant stays disabled.
            </li>
          </ol>
        </section>

        {/* steps */}
        {STEPS.map((s, i) => (
          <Step key={s.id} id={s.id} number={i + 1} title={s.title} image={s.image} alt={s.alt}>
            {s.body}
          </Step>
        ))}

        {/* closing */}
        <section className="mt-14 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-center">
          <h2 className="text-xl font-semibold text-zinc-50">That's the whole loop.</h2>
          <p className="mt-2 text-sm text-zinc-300">
            Decompile → explore → capture → report → publish. Ready to try it?
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/projects"
              className="rounded-md bg-amber-400 px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-amber-300"
            >
              Open the app →
            </Link>
            <a
              href="https://github.com/openbin-ai/platform/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-zinc-700 bg-zinc-900/60 px-5 py-2.5 text-sm text-zinc-100 hover:bg-zinc-800/60"
            >
              Download the CLI
            </a>
            <Link
              to="/community"
              className="rounded-md border border-zinc-700 bg-zinc-900/60 px-5 py-2.5 text-sm text-zinc-100 hover:bg-zinc-800/60"
            >
              Browse community reports
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-900 bg-black/40 px-6 py-8 text-center text-sm text-zinc-400">
        OpenBin.ai · The Open Binary Project ·{' '}
        <a href="mailto:husam@openbin.ai" className="hover:text-amber-400">husam@openbin.ai</a>
      </footer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** Inline UI-label / keyboard chip so "where to click" reads unambiguously. */
function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="mx-0.5 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[12px] text-zinc-100">
      {children}
    </span>
  )
}

/** Copy-friendly terminal command line. */
function Cmd({ children }: { children: ReactNode }) {
  return (
    <code className="block overflow-x-auto rounded-md border border-zinc-800 bg-black/70 px-3 py-2 font-mono text-[13px] text-emerald-300">
      <span className="select-none text-zinc-600">$ </span>{children}
    </code>
  )
}

function Step({
  id, number, title, image, alt, children,
}: {
  id: string
  number: number
  title: string
  image: string
  alt: string
  children: ReactNode
}) {
  return (
    <section id={id} className="mt-14 scroll-mt-20">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-400 font-mono text-sm font-bold text-black">
          {number}
        </span>
        <h2 className="text-xl font-semibold text-zinc-50 sm:text-2xl">{title}</h2>
      </div>
      <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-zinc-200">
        {children}
      </div>
      <figure className="mt-5">
        <img
          src={image}
          alt={alt}
          loading="lazy"
          className="w-full rounded-lg border border-zinc-800 shadow-lg"
        />
      </figure>
    </section>
  )
}

/** An ordered, click-by-click list — the core "don't make me think" unit. */
function Clicks({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 font-mono text-xs text-amber-400/80">{i + 1}.</span>
          <span className="flex-1">{it}</span>
        </li>
      ))}
    </ol>
  )
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border-l-2 border-amber-500/50 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-300">
      <span className="font-semibold text-amber-300">Tip:</span> {children}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Step content — kept here so each step is one editable block.
// ---------------------------------------------------------------------------

const STEPS: {
  id: string
  navTitle: string
  title: string
  image: string
  alt: string
  body: ReactNode
}[] = [
  {
    id: 'decompile',
    navTitle: 'Decompile a file with the CLI',
    title: 'Decompile a file with the CLI',
    image: cliDecompile,
    alt: 'Running openbin decompile in the terminal, which prints a project URL',
    body: (
      <>
        <p>
          Native binaries (ELF, PE, Mach-O) are decompiled on <em>your</em> machine with the
          OpenBin CLI — your file never gets uploaded, only the decompiled result does.
        </p>
        <Clicks
          items={[
            <>Install it (Linux/macOS): <Cmd>curl -fsSL https://openbin.ai/install.sh | sh</Cmd></>,
            <>Sign in once — opens your browser: <Cmd>openbin login</Cmd></>,
            <>Decompile a binary: <Cmd>openbin decompile ./firmware.elf</Cmd> …or an Android APK: <Cmd>openbin apk ./app.apk</Cmd></>,
            <>When it finishes, it prints a <strong>project URL</strong>. Open it — that's your analysis in the web app.</>,
          ]}
        />
        <Tip>
          The first decompile downloads the worker image (one-time, then cached). Docker must be
          running. Keep the CLI current with <Cmd>openbin update</Cmd>.
        </Tip>
      </>
    ),
  },
  {
    id: 'explore',
    navTitle: 'Open the analysis & ask the AI',
    title: 'Open the analysis & ask the AI',
    image: askAi,
    alt: 'Project view: function list, decompiled code, and the Ask AI panel',
    body: (
      <>
        <p>
          Your project opens in an IDE-style view: the <strong>function list</strong> on the left,
          decompiled pseudo-C in the middle, and tools on the right.
        </p>
        <Clicks
          items={[
            <>Click any <strong>function</strong> in the left list to read its code. Click a function name inside the code to jump to its definition.</>,
            <>Want the machine code too? Hit <Kbd>⇆ Split</Kbd> to show disassembly side-by-side — click a line or variable to highlight it in both panes.</>,
            <>On the right, open the <Kbd>Ask</Kbd> tab and type a question like <em>"what does this function do?"</em>. Answers cite the exact <code className="text-amber-300">file:line</code> so you can verify them.</>,
          ]}
        />
        <Tip>This is where your API key is used — if <Kbd>Ask</Kbd> is greyed out, add a key under Settings → API Keys (see above).</Tip>
      </>
    ),
  },
  {
    id: 'screenshot',
    navTitle: 'Capture & annotate a screenshot',
    title: 'Capture & annotate a screenshot',
    image: screenshotAnnotate,
    alt: 'Annotating a captured screenshot with rectangles and arrows before saving to the gallery',
    body: (
      <>
        <p>Grab visual evidence for your report without leaving the app.</p>
        <Clicks
          items={[
            <>In the code viewer header, click <Kbd>📸</Kbd> to capture a region of the screen (the side panel hides itself so it isn't in the shot) — or <Kbd>📷</Kbd> to paste, drag, or upload an image.</>,
            <>Mark it up: draw <strong>rectangles, arrows, and text</strong> to point at exactly what matters.</>,
            <>Click <Kbd>Save</Kbd>. The image lands in the project's <strong>Gallery</strong>, ready to drop into a report.</>,
          ]}
        />
        <Tip>Use <Kbd>📸</Kbd> (region capture) for clean shots of the code — it hides the chrome so you only capture what you framed.</Tip>
      </>
    ),
  },
  {
    id: 'report',
    navTitle: 'Build your report',
    title: 'Build your report',
    image: reportInProject,
    alt: 'The report editor inside a project with sections, inserted screenshot, and the preview toggle',
    body: (
      <>
        <p>Every project has a built-in report editor — Markdown, with your screenshots and analysis baked in.</p>
        <Clicks
          items={[
            <>Open the <Kbd>Report</Kbd> tab on the right panel (or <Kbd>Report ↗</Kbd> to edit it full-screen).</>,
            <>You start from a template. Click <Kbd>+ Add section</Kbd> for more, or click a section title to rename it.</>,
            <>Write in Markdown. Click <Kbd>🖼 Insert</Kbd> to drop in a screenshot from your Gallery, and <Kbd>👁 Preview</Kbd> to see it rendered.</>,
            <>For findings-heavy sections, click <Kbd>Pull from analysis</Kbd> to auto-fill them from the latest analysis (IOCs, static findings, and more).</>,
            <>Click <Kbd>Save</Kbd> when you're happy.</>,
          ]}
        />
        <Tip>Need it offline? <Kbd>Download .md</Kbd> exports portable Markdown (images inlined), and <Kbd>🖨 PDF</Kbd> opens a print-ready view.</Tip>
      </>
    ),
  },
  {
    id: 'publish',
    navTitle: 'Publish & share it',
    title: 'Publish & share it',
    image: reportPublish,
    alt: 'Publishing a report and sharing it to the community feed with a malware type and tags',
    body: (
      <>
        <p>Turn a finished analysis into a citable, public report.</p>
        <Clicks
          items={[
            <>Click <Kbd>Publish</Kbd>. This locks the report (read-only) so it's a stable snapshot — click <Kbd>Unpublish</Kbd> anytime to reopen it for edits.</>,
            <>To make it public, click <Kbd>🌐 Share with community</Kbd>, pick a malware type and a few tags, and confirm.</>,
            <>Done — it's live in the <Link to="/community" className="text-amber-400 hover:underline">Community feed</Link> with a shareable link. Other researchers can read it, cite it, and build on your work.</>,
          ]}
        />
        <Tip>Sharing is optional. You can publish a report just for yourself and never push it to the community.</Tip>
      </>
    ),
  },
]
