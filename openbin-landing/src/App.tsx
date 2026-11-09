import { useState } from 'react'
import { Menu, X, Star, BookOpen } from 'lucide-react'
import HexDrift from './components/HexDrift'
import DecryptedText from './components/DecryptedText'
import { TabbedShowcase } from './components/TabbedShowcase'
import logoLight from './assets/logo-light.png'
import iconLight from './assets/icon-light.png'
import openapkIcon from './assets/openapk-icon.png'

export default function App() {
  return (
    <div className="relative min-h-full overflow-hidden bg-black text-zinc-100">
      <div className="pointer-events-none fixed inset-0 z-0 opacity-50">
        <HexDrift
          baseColors={['#27272a', '#3f3f46', '#52525b']}
          accentColor="#fbbf24"
          outerVignette
          centerVignette
        />
      </div>

      <BinnyAnnounceBar />
      <Header />

      <main className="relative z-10">
        <Hero />
        <GetStarted />
        <BinnyBeta />
        <Platforms />
        <Inputs />
        <TabbedShowcase />
        <WhatYouCanDo />
        <WhyOpenBin />
        <HallOfFame />
        <CTA />
        <Footer />
      </main>
    </div>
  )
}

/**
 * Announcement bar: the BINNY beta. Links down to the install section on this
 * page. Not dismissible: it's a marketing headline on a static page, not a
 * repeated in-app nag. Mirrored on the openapk.ai landing.
 */
function BinnyAnnounceBar() {
  return (
    <a
      href="#binny"
      className="relative z-20 block border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-sm text-amber-200 backdrop-blur transition hover:bg-amber-500/20"
    >
      <span className="font-semibold text-amber-100">BINNY is open source.</span> An agent harness for
      reverse engineering that runs on any model, including local ones.{' '}
      <span className="underline decoration-amber-400/50 underline-offset-2">See it</span>
    </a>
  )
}

// One list drives both the desktop nav row and the mobile dropdown so the
// two can't drift. external → new tab; accent → amber (Community only).
const navLinks: { label: string; href: string; external?: boolean; accent?: boolean }[] = [
  { label: 'Get started', href: '#install' },
  { label: 'BINNY', href: '#binny' },
  { label: 'Features', href: '#features' },
  { label: 'Why OpenBin', href: '#why' },
  { label: 'Docs', href: 'https://app.openbin.ai/docs' },
  { label: 'Community', href: 'https://app.openbin.ai/community', accent: true },
  { label: 'Sign in', href: 'https://app.openbin.ai', external: true },
  { label: 'Source', href: 'https://github.com/openbin-ai/platform', external: true },
  { label: 'Discord', href: 'https://discord.gg/HQsCZBHXwc', external: true },
]

function Header() {
  const [menuOpen, setMenuOpen] = useState(false)

  // Button treatment, not bare text — the hex-drift background makes plain
  // links hard to read; a solid pill gives each label its own quiet ground.
  const linkClass = (accent?: boolean) =>
    accent
      ? 'rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-300 backdrop-blur transition hover:bg-amber-500/20 hover:text-amber-200'
      : 'rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 text-sm text-zinc-200 backdrop-blur transition hover:border-amber-500/40 hover:text-amber-300'

  return (
    // z-30 (above the hero) so the mobile dropdown paints over page content.
    <header className="relative z-30 flex items-center justify-between px-6 py-5 sm:px-10">
      <div className="flex items-center gap-2">
        <img src={iconLight} alt="" className="h-9 w-9" />
        <span className="font-mono text-base font-semibold tracking-[0.08em] text-zinc-100">
          OPENBIN<span className="text-amber-400">.AI</span>
        </span>
      </div>

      <nav className="hidden items-center gap-2.5 sm:flex">
        {navLinks.map(({ label, href, external, accent }) => (
          <a
            key={label}
            href={href}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className={linkClass(accent)}
          >
            {label}
          </a>
        ))}
      </nav>

      <button
        type="button"
        onClick={() => setMenuOpen(open => !open)}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2 text-zinc-200 backdrop-blur sm:hidden"
      >
        {menuOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
      </button>

      {menuOpen && (
        <nav className="absolute inset-x-0 top-full flex flex-col gap-2 border-b border-zinc-800 bg-black/95 px-6 pb-4 pt-3 backdrop-blur sm:hidden">
          {navLinks.map(({ label, href, external, accent }) => (
            <a
              key={label}
              href={href}
              {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              onClick={() => setMenuOpen(false)}
              className={`block text-center ${linkClass(accent)}`}
            >
              {label}
            </a>
          ))}
        </nav>
      )}
    </header>
  )
}

function Hero() {
  return (
    <section className="mx-auto flex max-w-6xl flex-col items-center px-6 pt-12 pb-20 text-center sm:pt-20">
      <img
        src={logoLight}
        alt="OpenBin.ai - The Open Binary Project"
        className="mb-8 h-40 w-auto drop-shadow-[0_8px_40px_rgba(251,191,36,0.35)] sm:mb-10 sm:h-72"
      />
      {/* Visible "official name" line — needs to be real text, not just
          alt/JSON-LD, for the phrase "The Open Binary Project" to actually
          rank when someone Googles it. Small, brand-toned, sits above the
          marketing headline. */}
      <p className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-amber-400/90 sm:text-sm">
        The Open Binary Project
      </p>
      {/* Post-launch positioning: collaboration leads, decompilation is the
          supporting cast. The "AI decompiler" keywords stay in index.html's
          title/meta/JSON-LD for SEO — do not "fix" the mismatch. */}
      <h1 className="max-w-5xl text-5xl font-semibold leading-tight tracking-tight text-zinc-50 sm:text-7xl">
        <DecryptedText
          text="Decompile. Analyze. Publish."
          animateOn="view"
          sequential
          revealDirection="start"
          speed={45}
          className="text-zinc-50"
          encryptedClassName="text-amber-400/70"
        />
      </h1>
      <p className="mt-7 max-w-3xl text-xl leading-relaxed text-zinc-100 sm:text-2xl">
        <span className="text-amber-400">Decompile</span> and{' '}
        <span className="text-amber-400">analyze</span> native binaries, Android
        APKs, and malicious npm, PyPI, PowerShell &amp; shell packages with
        an agent that reads the code with you, then{' '}
        <span className="text-amber-400">publish</span> your findings, fork
        other researchers' projects, and build on each other's work.
      </p>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-300 sm:text-lg">
        Free and open source (AGPL). Cloud-based, so your work is accessible from
        anywhere and shareable with your team. Bring your own LLM key - you only
        ever pay your own AI provider.
      </p>
      {/* One primary action and one secondary. The old row had four equal
          buttons in two colours; a reader could not tell which one was the
          door. Community and OpenAPK keep their links as plain text below. */}
      <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
        <a
          href="https://app.openbin.ai"
          className="rounded-md bg-amber-400 px-6 py-3 text-base font-semibold text-black shadow-[0_6px_30px_rgba(251,191,36,0.45)] transition hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          Open the app
        </a>
        <a
          href="#install"
          className="rounded-md border border-amber-500/40 bg-zinc-900/60 px-6 py-3 text-base text-zinc-100 backdrop-blur transition hover:bg-zinc-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          Install the CLI
        </a>
      </div>
      <p className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-base">
        <a href="https://app.openbin.ai/docs" className="inline-flex items-center gap-2 font-medium text-amber-400 underline-offset-4 hover:underline">
          <BookOpen aria-hidden className="h-4 w-4" />
          New here? Read the docs
        </a>
        <a href="https://app.openbin.ai/community" className="inline-flex items-center gap-2 text-zinc-200 underline-offset-4 hover:text-amber-300 hover:underline">
          <Star aria-hidden className="h-4 w-4" />
          Browse community reports
        </a>
      </p>
      <p className="mt-10 font-mono text-sm uppercase tracking-[0.15em] text-zinc-300">
        Free &amp; open source (AGPL v3) · Bring your own model key · Runs in your browser
      </p>
    </section>
  )
}

/**
 * Three commands from nothing to a project URL. Decompiling runs on the
 * reader's machine (cloud Ghidra/JADX is off, see GhidraSunsetMessage.java),
 * so the install block is the real front door and gets its own section
 * instead of hanging under the hero buttons.
 */
function GetStarted() {
  const steps: { title: string; body: string; cmd: string; alt?: string }[] = [
    { title: 'Install the CLI', body: 'macOS and Linux. Windows uses PowerShell.', cmd: 'curl -fsSL https://openbin.ai/install.sh | sh', alt: 'irm https://openbin.ai/install.ps1 | iex' },
    { title: 'Sign in once', body: 'Opens your browser. The same account works on OpenBin and OpenAPK.', cmd: 'openbin login' },
    { title: 'Decompile a file', body: 'Ghidra for native binaries, JADX for APKs, both in a local Docker container. It prints a project URL when it is done.', cmd: 'openbin decompile ./sample.elf', alt: 'openbin apk ./app.apk' },
  ]
  return (
    <section id="install" className="mx-auto max-w-6xl scroll-mt-20 px-6 pt-4 pb-20">
      <SectionHeading
        label="Get started"
        title="Three commands to your first project."
        intro="Your file is decompiled on your own machine and only the decompiled result is uploaded. Docker Desktop (WSL 2 on Windows) must be installed and running."
      />
      <ol className="grid gap-4 lg:grid-cols-3">
        {steps.map((st, i) => (
          <li key={st.title} className="flex min-w-0 flex-col rounded-lg border border-zinc-800 bg-zinc-950/80 p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400 font-mono text-sm font-bold text-black">{i + 1}</span>
              <h3 className="text-lg font-semibold text-zinc-50">{st.title}</h3>
            </div>
            <p className="mt-3 flex-1 text-sm leading-relaxed text-zinc-300">{st.body}</p>
            <code className="mt-4 block overflow-x-auto whitespace-nowrap rounded-md border border-zinc-800 bg-black/60 px-3 py-2 font-mono text-[13px] text-emerald-300">
              <span className="select-none text-zinc-600">$ </span>{st.cmd}
            </code>
            {st.alt && (
              <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md border border-zinc-800 bg-black/60 px-3 py-2 font-mono text-[13px] text-zinc-300">
                <span className="select-none text-zinc-600">{st.alt.startsWith('irm') ? 'PS> ' : '$ '}</span>{st.alt}
              </code>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-5 text-sm text-zinc-400">
        Cloud decompile is paused: AWS compute outpaced what a free project can carry, so the CLI does that part locally.
        Full install notes, flags and troubleshooting are in the{' '}
        <a href="https://app.openbin.ai/docs/cli/install" className="text-amber-400 underline-offset-4 hover:underline">CLI docs</a>.
        Want to sponsor cloud decompile for the community?{' '}
        <a href="mailto:husam@openbin.ai" className="text-amber-400 underline-offset-4 hover:underline">husam@openbin.ai</a>
      </p>
    </section>
  )
}

/**
 * Section label + heading pair used below the hero. The mono amber label is
 * the hero's own "The Open Binary Project" treatment reused as the page's
 * identity motif; the sentence-case heading carries the actual content.
 */
function SectionHeading({ label, title, intro }: { label: string; title: string; intro?: string }) {
  return (
    <div className="mb-10 max-w-3xl">
      <p className="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-amber-400/90">{label}</p>
      <h2 className="text-3xl font-semibold leading-tight tracking-tight text-zinc-50 sm:text-4xl">{title}</h2>
      {intro && <p className="mt-4 text-lg leading-relaxed text-zinc-300">{intro}</p>}
    </div>
  )
}

// BINNY: the open source agent harness. Copy on the left, a transcript of
// the real start-up on the right so the reader sees what "harness" means
// before they install anything. Install commands sit under the transcript.
const binnyTranscript = `$ binny
  BINNY v0.1.0-beta.2   project: dropper.elf   model: ollama / qwen3:14b

> /investigate
  triage      ELF x86-64, stripped, 3 playbooks selected
  investigate reading main, 14 callees, 212 strings, 6 imports
  tool        get_function(sub_401a30)
  tool        run(script=decode_config.py)   sandbox: no network
  checkpoint  phase boundary reached. continue? (supervised)

> /draft
  Draft written to the project report. 9 findings, 4 IOCs.`

function BinnyBeta() {
  return (
    <section id="binny" className="mx-auto max-w-6xl scroll-mt-20 px-6 pt-8 pb-20">
      <div className="rounded-lg border border-amber-500/40 bg-zinc-950/85 p-7 sm:p-10">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-14">
          <div className="min-w-0">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-amber-400/90">BINNY · open source</p>
            <h2 className="text-3xl font-semibold leading-tight tracking-tight text-zinc-50 sm:text-4xl">
              An agent harness for reverse engineering. You pick the model.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-zinc-200">
              BINNY is the harness, not the model. It brings the tools (decompiled
              functions, strings, imports, a sealed sandbox, local Ghidra), the
              playbooks, the triage, investigate, draft loop, budgets, checkpoints
              and the report format. Plug in Claude, GPT, DeepSeek, Qwen, Kimi,
              Gemini, Bedrock, or a local model through Ollama or LM Studio.
            </p>
            <p className="mt-4 text-base leading-relaxed text-zinc-400">
              Three run modes: autonomous to a finished draft, supervised with
              pauses at phase boundaries, collaborative with an interview before
              the write-up. Or skip the loop and question a sample directly. The
              draft lands on the project report for you to review. Sessions
              resume where they stopped.
            </p>
            <p className="mt-4 text-base leading-relaxed text-zinc-400">
              Not a terminal person? <code className="font-mono text-zinc-200">binny desktop</code> runs
              the same engine as BINNY Desktop in your browser: an explorer and code pane, a
              function/strings/imports panel for Ghidra projects, findings that jump to the
              code they are about, highlights, artifacts and the report, with one click to
              push it all to your project.
            </p>
            <div className="mt-6 flex flex-wrap gap-3 text-sm">
              <a href="https://github.com/openbin-ai/binny" target="_blank" rel="noopener noreferrer" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 font-medium text-amber-200 transition hover:bg-amber-500/20">
                Source on GitHub
              </a>
              <a href="https://app.openbin.ai/docs/binny" className="rounded-md border border-zinc-700 bg-zinc-900/60 px-4 py-2 text-zinc-200 transition hover:bg-zinc-800/60">
                BINNY docs
              </a>
            </div>
          </div>
          <div className="min-w-0 space-y-3">
            <pre aria-label="BINNY session transcript" className="overflow-x-auto rounded-md border border-zinc-800 bg-black/70 px-4 py-4 font-mono text-[12.5px] leading-relaxed text-zinc-300">
              {binnyTranscript}
            </pre>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 rounded-md border border-zinc-800 bg-black/50 px-4 py-3">
                <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-amber-400/80">macOS / Linux</div>
                <code className="block overflow-x-auto whitespace-nowrap font-mono text-sm text-zinc-100">
                  curl -fsSL https://openbin.ai/install-binny.sh | sh
                </code>
              </div>
              <div className="min-w-0 rounded-md border border-zinc-800 bg-black/50 px-4 py-3">
                <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-amber-400/80">Windows (PowerShell)</div>
                <code className="block overflow-x-auto whitespace-nowrap font-mono text-sm text-zinc-100">
                  irm https://openbin.ai/install-binny.ps1 | iex
                </code>
              </div>
            </div>
            <p className="text-xs text-zinc-500">
              Then <code className="font-mono text-zinc-300">openbin login &amp;&amp; binny</code>, or{' '}
              <code className="font-mono text-zinc-300">binny desktop</code> for the graphical app. Docker is needed only for local decompile and the sandbox.
              AGPL-3.0, binaries for macOS, Linux and Windows on the{' '}
              <a href="https://github.com/openbin-ai/binny/releases" target="_blank" rel="noopener noreferrer" className="text-amber-400 underline-offset-4 hover:underline">
                releases page
              </a>.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

// Two live products behind one account. They get equal weight on purpose:
// neither is the "real" one, the reader picks by what they are holding.
function Platforms() {
  return (
    <section id="platforms" className="mx-auto max-w-6xl px-6 pt-8 pb-20">
      <SectionHeading
        label="Two apps, one account"
        title="Pick the app for what you are holding."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <PlatformBlock
          href="https://app.openbin.ai"
          icon={iconLight}
          name="OpenBin"
          summary="Native binaries: ELF, PE and Mach-O. The CLI runs Ghidra on your machine and uploads the decompiled tree. The workspace adds hotspots, call chains, string and import analysis, and pseudo-C with citations."
          linkLabel="app.openbin.ai"
        />
        <PlatformBlock
          href="https://openapk.ai"
          icon={openapkIcon}
          name="OpenAPK"
          summary="Android APKs. JADX decompile, IDE-style navigation, crypto routine reconstruction, network call-site harvesting, and a report builder with malware-analysis and vuln-research templates."
          linkLabel="openapk.ai"
        />
      </div>
    </section>
  )
}

function PlatformBlock({ href, icon, name, summary, linkLabel }: { href: string; icon: string; name: string; summary: string; linkLabel: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex h-full flex-col rounded-lg border border-zinc-800 bg-zinc-950/80 p-7 transition hover:border-amber-500/50 sm:p-8"
    >
      <div className="flex items-center gap-4">
        <img src={icon} alt="" className="h-10 w-10" />
        <h3 className="text-2xl font-semibold text-zinc-50">
          {name}<span className="text-amber-400">.ai</span>
        </h3>
      </div>
      <p className="mt-5 flex-1 text-base leading-relaxed text-zinc-200">{summary}</p>
      <span className="mt-6 font-mono text-sm text-amber-400 group-hover:underline group-hover:underline-offset-4">
        {linkLabel}
      </span>
    </a>
  )
}

// What you can drop in. Doubles as SEO surface: these are the formats people
// search for ("decompile apk", "npm malware", "powershell analysis", ...).
const inputs: { kind: string; formats: string; engine: string }[] = [
  { kind: 'Native binaries', formats: 'ELF · PE · Mach-O', engine: 'Ghidra decompile and disassembly, run locally by the CLI' },
  { kind: 'Android APKs', formats: '.apk · .dex · .so', engine: 'JADX decompile on OpenAPK; bundled .so files go through Ghidra' },
  { kind: 'npm packages', formats: '.tgz · .js · .ts', engine: 'Supply-chain malware review' },
  { kind: 'PyPI packages', formats: '.whl · sdist · .py', engine: 'Package and script analysis' },
  { kind: 'PowerShell', formats: '.ps1 · .psm1', engine: 'Static behaviour and IOC detection' },
  { kind: 'Shell scripts', formats: '.sh · .bash · .zsh', engine: 'Static behaviour and IOC detection' },
]

// A table, not an icon grid: the reader is scanning for their file type, and
// a column of formats scans faster than six tiles with the same glyph.
function Inputs() {
  return (
    <section className="mx-auto max-w-6xl px-6 pt-8 pb-20">
      <SectionHeading
        label="Inputs"
        title="What you can drop in."
        intro="Binaries, mobile apps, and the package formats supply-chain malware ships in."
      />
      {/* Phones get a stacked list; the three-column table only earns its
          width from sm upward. */}
      <dl className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950/80 sm:hidden">
        {inputs.map(({ kind, formats, engine }) => (
          <div key={kind} className="px-5 py-4">
            <dt className="font-semibold text-zinc-50">{kind}</dt>
            <dd className="mt-1 font-mono text-sm text-amber-300">{formats}</dd>
            <dd className="mt-1 text-sm text-zinc-300">{engine}</dd>
          </div>
        ))}
      </dl>
      <div className="hidden rounded-lg border border-zinc-800 bg-zinc-950/80 sm:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 font-mono text-xs uppercase tracking-[0.15em] text-zinc-400">
              <th scope="col" className="px-5 py-3 font-medium">Input</th>
              <th scope="col" className="px-5 py-3 font-medium">Formats</th>
              <th scope="col" className="px-5 py-3 font-medium">What runs</th>
            </tr>
          </thead>
          <tbody>
            {inputs.map(({ kind, formats, engine }) => (
              <tr key={kind} className="border-b border-zinc-800/70 last:border-b-0">
                <th scope="row" className="px-5 py-4 font-semibold text-zinc-50">{kind}</th>
                <td className="px-5 py-4 font-mono text-amber-300">{formats}</td>
                <td className="px-5 py-4 text-zinc-300">{engine}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// The product map. Each row names a thing a researcher can do and links to
// the docs page that shows how; the point is that nobody leaves this page
// still wondering what the app contains. Rows, not icon tiles: the text is
// the content.
const capabilities: { title: string; body: string; href: string }[] = [
  { title: 'Read decompiled code like an IDE', body: 'Function list, pseudo-C with disassembly side by side, click-to-jump, cross-highlighting between the two panes, strings, imports and data.', href: 'https://app.openbin.ai/docs/workspace/navigating-code' },
  { title: 'Walk the call graph', body: 'Callers and callees from any function, with hotspots surfaced from the analysis.', href: 'https://app.openbin.ai/docs/workspace/call-graph-and-hotspots' },
  { title: 'Ask BINNY light in the browser', body: 'The in-app agent reads the functions it needs, cites addresses, and on request pins highlights, writes report sections and saves scripts.', href: 'https://app.openbin.ai/docs/binny/light' },
  { title: 'Pin highlights and capture evidence', body: 'Mark the lines that matter, grab a region of the screen, annotate it, and keep it in the project gallery.', href: 'https://app.openbin.ai/docs/workspace/highlights' },
  { title: 'Write the report where the code is', body: 'Markdown editor with malware-analysis and vuln-research templates, screenshots inline, export to Markdown or PDF.', href: 'https://app.openbin.ai/docs/reports' },
  { title: 'Publish and fork', body: 'Make a project public, let others fork it and build on your work, upvote and discuss reports, follow the researchers you learn from.', href: 'https://app.openbin.ai/docs/community' },
  { title: 'Work as a team', body: 'Share a project with roles, keep a project overview, chat on the project, message researchers directly.', href: 'https://app.openbin.ai/docs/collaborate' },
  { title: 'Play the weekly CTF', body: 'One crackme a week. First correct flag is Researcher of the Week. Leaderboards by week, season and all time.', href: 'https://app.openbin.ai/docs/community/ctf' },
]

function WhatYouCanDo() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-6 pt-8 pb-20">
      <SectionHeading
        label="What you can do"
        title="Everything in the workspace, and where to read about it."
        intro="Each item links to the docs page that walks through it click by click."
      />
      <ul className="grid gap-x-10 gap-y-2 sm:grid-cols-2">
        {capabilities.map((c) => (
          <li key={c.title} className="border-t border-zinc-800">
            <a href={c.href} className="group block py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
              <h3 className="text-lg font-semibold text-zinc-50 group-hover:text-amber-200">{c.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">{c.body}</p>
              <span className="mt-2 inline-block font-mono text-xs text-amber-400 underline-offset-4 group-hover:underline">Read the docs</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Three claims, written as prose rather than three matching cards: the
// points are different sizes and the reader should feel that.
function WhyOpenBin() {
  return (
    <section id="why" className="mx-auto max-w-6xl px-6 pt-8 pb-24">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
        <div>
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-amber-400/90">Why OpenBin</p>
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-zinc-50 sm:text-4xl">
            Reverse engineering has never had a shared workspace.
          </h2>
        </div>
        <div className="space-y-6 text-lg leading-relaxed text-zinc-200">
          <p>
            Most of this work ends up in private notes and threads that are hard
            to find a year later. On OpenBin you publish a report, someone else
            forks the project and extends it, and the record of how a sample
            works grows in public with the researchers' names on it.
          </p>
          <p>
            The agent reads decompiled code the way you do: by file, by symbol,
            by package. It can jump to a definition, find usages, and cite the
            line it is talking about, instead of guessing from a pasted snippet.
          </p>
          <p>
            The whole platform is AGPL on GitHub and free for researchers. You
            bring your own model key, stored encrypted, and the only AI bill is
            the one your provider sends you. In the terminal, BINNY also runs
            on local models.
          </p>
        </div>
      </div>
    </section>
  )
}

// Launch-day shoutout to the beta researchers who carried the community —
// answering questions in Discord, publishing public research, and generally
// standing on BINness. Handles are Twitter/X handles; each card links to
// x.com/<handle>. Order matters: Pwnie is deliberately #1 — he built the
// Discord and brought a huge share of the community in. The founder is NOT
// in the grid (his shoutout is the signed line below it).
const hallOfFame: { handle: string; name: string; badge?: string }[] = [
  { handle: '@0xpwnie', name: 'Pwnie', badge: 'built the Discord' },
  { handle: '@Loserlarping', name: 'Larp' },
  { handle: '@kernelstub', name: 'Prepakis Georgios' },
  { handle: '@LxlxIxlxlxL', name: 'rootkittie' },
  { handle: '@JuluisKStar', name: 'Choppery' },
  { handle: '@noth1ng_real', name: 'http' },
]

function HallOfFame() {
  return (
    <section id="hall-of-fame" className="mx-auto max-w-5xl px-6 pt-4 pb-24">
      <p className="mb-3 text-center font-mono text-xs uppercase tracking-[0.3em] text-amber-400/90">Hall of Fame</p>
      <h2 className="mx-auto mb-10 max-w-2xl text-center text-lg leading-relaxed text-zinc-200">
        The researchers who stood on BINness through beta: answering questions
        in Discord, publishing research, and building this community into what
        it is today. Thank you.
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {hallOfFame.map(({ handle, name, badge }) => (
          <a
            key={handle}
            href={`https://x.com/${handle.slice(1)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-5 text-center transition hover:border-amber-500/50"
          >
            <span className="break-all font-mono text-sm font-semibold text-amber-400">{handle}</span>
            <span className="mt-1 text-sm text-zinc-200">{name}</span>
            {badge && <span className="mt-1 text-xs text-zinc-400">{badge}</span>}
          </a>
        ))}
      </div>
      <p className="mt-8 text-center text-sm italic text-zinc-400">
        Thank you for building this with me. I owe you all.{' '}
        <a
          href="https://x.com/oneandonlyhusam"
          target="_blank"
          rel="noopener noreferrer"
          className="not-italic font-mono text-amber-400/90 underline-offset-4 hover:underline"
        >
          Bytecode Assassin (@oneandonlyhusam), founder
        </a>
      </p>
      <p className="mt-4 text-center text-base text-zinc-300">
        Want your name here?{' '}
        <a
          href="https://discord.gg/HQsCZBHXwc"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-amber-400 underline-offset-4 hover:underline"
        >
          Join the Discord
        </a>{' '}
        and start publishing.
      </p>
    </section>
  )
}

function CTA() {
  return (
    <section className="mx-auto max-w-3xl px-6 pb-24 text-center">
      <h2 className="text-3xl font-semibold leading-tight tracking-tight text-zinc-50 sm:text-4xl">
        Decompile a sample and see what you find.
      </h2>
      <p className="mt-5 text-lg leading-relaxed text-zinc-200">
        Sign in, add your LLM provider key, and drop in a binary or an APK. When
        you have worked it out, publish the report so the next person starts
        from your notes instead of from zero.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
        <a
          href="https://app.openbin.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md bg-amber-400 px-6 py-3 text-base font-semibold text-black shadow-[0_6px_30px_rgba(251,191,36,0.45)] transition hover:bg-amber-300"
        >
          Open app.openbin.ai
        </a>
        <a
          href="https://discord.gg/HQsCZBHXwc"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-6 py-3 text-base text-zinc-100 hover:bg-zinc-800/60"
        >
          Join the Discord
        </a>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="relative z-10 border-t border-zinc-900/80 bg-black/40 px-6 py-8 text-center text-base text-zinc-300 backdrop-blur">
      <div className="flex flex-col items-center justify-center gap-1 sm:flex-row sm:gap-3">
        <span>OpenBin.ai · The Open Binary Project</span>
        <span className="hidden sm:inline">·</span>
        <span>Collaborative platform for security research and reverse engineering</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono text-sm tracking-wide text-zinc-400">
        <span>AGPL v3 · BYOK · Free for researchers</span>
        <span aria-hidden>·</span>
        <a href="/terms.html" className="hover:text-amber-400">Terms</a>
        <span aria-hidden>·</span>
        <a href="/privacy.html" className="hover:text-amber-400">Privacy</a>
        <span aria-hidden>·</span>
        <a href="https://app.openbin.ai/docs" className="hover:text-amber-400">Docs</a>
        <span aria-hidden>·</span>
        <a href="https://github.com/openbin-ai/platform" target="_blank" rel="noopener noreferrer" className="hover:text-amber-400">GitHub</a>
        <span aria-hidden>·</span>
        <a href="https://discord.gg/HQsCZBHXwc" target="_blank" rel="noopener noreferrer" className="hover:text-amber-400">Discord</a>
        <span aria-hidden>·</span>
        <a href="mailto:husam@openbin.ai" className="hover:text-amber-400">Contact</a>
        <span aria-hidden>·</span>
        <span>© {new Date().getFullYear()}</span>
      </div>
    </footer>
  )
}
