import { Bot, GitBranch, Unlock, NotebookPen, Globe, KeyRound, Users, Share2, Cpu, Smartphone, Package, FileCode2, Terminal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import LetterGlitch from './components/LetterGlitch'
import DecryptedText from './components/DecryptedText'
import ElectricBorder from './components/ElectricBorder'
import MagicBento, { type BentoCard } from './components/MagicBento'
import { TabbedShowcase } from './components/TabbedShowcase'
import logoLight from './assets/logo-light.png'
import iconLight from './assets/icon-light.png'
import openapkIcon from './assets/openapk-icon.png'

export default function App() {
  return (
    <div className="relative min-h-full overflow-hidden bg-black text-zinc-100">
      <div className="pointer-events-none fixed inset-0 z-0 opacity-50">
        <LetterGlitch
          glitchColors={['#fbbf24', '#52525b', '#1a1a1a']}
          glitchSpeed={55}
          outerVignette
          centerVignette
          smooth
        />
      </div>

      <Header />

      <main className="relative z-10">
        <Hero />
        <AvailableNow />
        <Ecosystems />
        <Capabilities />
        <TabbedShowcase />
        <WhyOpenBin />
        <CTA />
        <Footer />
      </main>
    </div>
  )
}

function Header() {
  return (
    <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
      <div className="flex items-center gap-2">
        <img src={iconLight} alt="" className="h-9 w-9" />
        <span className="font-mono text-base font-semibold tracking-[0.08em] text-zinc-100">
          OPENBIN<span className="text-amber-400">.AI</span>
        </span>
      </div>
      <nav className="flex items-center gap-5 text-base">
        <a
          href="#products"
          className="hidden text-zinc-200 hover:text-amber-400 sm:inline"
        >
          Products
        </a>
        <a
          href="#why"
          className="hidden text-zinc-200 hover:text-amber-400 sm:inline"
        >
          Why OpenBin
        </a>
        <a
          href="https://app.openbin.ai/docs"
          className="hidden text-zinc-200 hover:text-amber-400 sm:inline"
        >
          Docs
        </a>
        <a
          href="https://app.openbin.ai/community"
          className="text-amber-400 hover:text-amber-300"
        >
          Community
        </a>
        <a
          href="https://app.openbin.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden text-zinc-200 hover:text-amber-400 sm:inline"
        >
          Sign in
        </a>
        <a
          href="https://github.com/openbin-ai/platform"
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-200 hover:text-amber-400"
        >
          Source
        </a>
      </nav>
    </header>
  )
}

function Hero() {
  return (
    <section className="mx-auto flex max-w-6xl flex-col items-center px-6 pt-12 pb-20 text-center sm:pt-20">
      <img
        src={logoLight}
        alt="OpenBin.ai - The Open Binary Project"
        className="mb-12 h-80 w-auto drop-shadow-[0_8px_40px_rgba(251,191,36,0.35)] sm:h-112"
      />
      {/* Visible "official name" line — needs to be real text, not just
          alt/JSON-LD, for the phrase "The Open Binary Project" to actually
          rank when someone Googles it. Small, brand-toned, sits above the
          marketing headline. */}
      <p className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-amber-400/90 sm:text-sm">
        The Open Binary Project
      </p>
      <h1 className="max-w-5xl text-5xl font-semibold leading-tight tracking-tight text-zinc-50 sm:text-7xl">
        <DecryptedText
          text="AI decompilation,"
          animateOn="view"
          sequential
          revealDirection="start"
          speed={45}
          className="text-zinc-50"
          encryptedClassName="text-amber-400/70"
        />
        <br className="hidden sm:block" />{' '}
        <DecryptedText
          text="reverse engineering & debugging."
          animateOn="view"
          sequential
          revealDirection="start"
          speed={45}
          className="text-zinc-50"
          encryptedClassName="text-amber-400/70"
        />
      </h1>
      <p className="mt-7 max-w-3xl text-xl leading-relaxed text-zinc-100 sm:text-2xl">
        Decompile and reverse engineer <span className="text-amber-400">native binaries</span>,{' '}
        <span className="text-amber-400">Android APKs</span>, and malicious{' '}
        <span className="text-amber-400">npm, PyPI, PowerShell &amp; shell</span> packages -
        then publish your findings and{' '}
        <span className="text-amber-400">collaborate with the security-research community</span>.
        Accelerated by intelligent agents running on your own LLM.
      </p>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-300 sm:text-lg">
        Free and open source (AGPL). Cloud-based, so your work is accessible from
        anywhere and shareable with your team. Bring your own LLM key - you only
        ever pay your own AI provider.
      </p>
      <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
        <a
          href="https://github.com/openbin-ai/platform/releases/latest"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md bg-amber-400 px-6 py-3 text-base font-semibold text-black shadow-[0_6px_30px_rgba(251,191,36,0.45)] transition hover:bg-amber-300"
        >
          Download the CLI →
        </a>
        {/* Browse Community is the second primary CTA — collaborative
            security research IS the platform's value prop, so it gets
            equal visual weight to the CLI download. Filled purple so it
            stands out against the amber chrome around it. */}
        <a
          href="https://app.openbin.ai/community"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-purple-600 px-6 py-3 text-base font-semibold text-white shadow-[0_6px_30px_rgba(124,58,237,0.45)] transition hover:bg-purple-500"
        >
          <span aria-hidden>★</span>
          Browse community
        </a>
        <a
          href="https://app.openbin.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-amber-500/40 bg-zinc-900/60 px-6 py-3 text-base text-zinc-100 backdrop-blur hover:bg-zinc-800/60"
        >
          Open Web App →
        </a>
        <a
          href="https://openapk.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-amber-500/40 bg-zinc-900/60 px-6 py-3 text-base text-zinc-100 backdrop-blur hover:bg-zinc-800/60"
        >
          Try OpenAPK →
        </a>
      </div>
      <CloudSunsetNote />
      <p className="mt-8 font-mono text-sm uppercase tracking-[0.15em] text-zinc-300">
        Beta · Free &amp; open source (AGPL v3) · BYOK (Anthropic · OpenAI · Bedrock) · Runs in your browser
      </p>
    </section>
  )
}

/**
 * Small inline note pinned beneath the hero CTAs. Explains why the
 * "Download CLI" button is now the primary path: cloud Ghidra is scaled
 * to zero (see GhidraSunsetMessage.java backend-side) and binaries get
 * decompiled on the user's own machine instead. Sponsorship mailto for
 * anyone willing to fund cloud compute is right here so it can't be
 * missed.
 */
function CloudSunsetNote() {
  return (
    <div className="mt-6 max-w-2xl rounded-lg border border-amber-700/40 bg-amber-950/20 px-5 py-3 text-center text-sm text-zinc-200">
      <p>
        <span className="font-semibold text-amber-300">Cloud decompile is paused</span>{' '}
        — AWS compute outpaced what a free OSS project can carry. The CLI
        runs Ghidra on your own machine; your binary never leaves your laptop.
      </p>
      <p className="mt-1.5 text-xs text-zinc-400">
        Want to sponsor cloud decompile for the community?{' '}
        <a
          href="mailto:husam@openbin.ai"
          className="font-medium text-amber-300 underline-offset-4 hover:underline"
        >
          husam@openbin.ai
        </a>
      </p>
    </div>
  )
}

function AvailableNow() {
  return (
    <section id="products" className="mx-auto max-w-6xl px-6 pt-8 pb-16">
      <h2 className="mb-10 text-center font-mono text-sm font-semibold uppercase tracking-[0.22em] text-amber-400">
        Live products
      </h2>
      <div className="grid gap-7 lg:grid-cols-2">
        <ElectricBorder color="#fbbf24" speed={0.9} chaos={0.5} borderRadius={14}>
          <a
            href="https://app.openbin.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="group block h-full rounded-[14px] bg-zinc-950/85 p-7 backdrop-blur transition hover:bg-zinc-900/85 sm:p-8"
          >
            <div className="flex items-start gap-5">
              <div className="shrink-0 rounded-lg border border-amber-500/40 bg-black/40 p-3">
                <img src={iconLight} alt="OpenBin" className="h-12 w-12" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-3">
                  <h3 className="text-2xl font-semibold text-zinc-50 sm:text-3xl">
                    OpenBin<span className="text-amber-400">.ai</span>
                  </h3>
                  <span className="rounded border border-emerald-600 bg-emerald-900/40 px-2 py-0.5 font-mono text-xs font-semibold uppercase tracking-[0.15em] text-emerald-300">
                    live
                  </span>
                </div>
                <p className="mt-4 text-base leading-relaxed text-zinc-100 sm:text-lg">
                  Agent-native reverse engineering for native binaries - ELF, PE,
                  Mach-O. Ghidra under the hood, AI on top: hotspots, call chains,
                  string + import analysis, decompiled pseudo-C with citations.
                </p>
                <p className="mt-4 font-mono text-sm leading-relaxed text-zinc-300">
                  native disasm · pseudo-C · symbol graph · agent Q&amp;A · publish &amp; cite
                </p>
                <span className="mt-6 inline-block text-base font-semibold text-amber-400 group-hover:text-amber-300">
                  app.openbin.ai →
                </span>
              </div>
            </div>
          </a>
        </ElectricBorder>

        <ElectricBorder color="#fbbf24" speed={0.9} chaos={0.5} borderRadius={14}>
          <a
            href="https://openapk.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="group block h-full rounded-[14px] bg-zinc-950/85 p-7 backdrop-blur transition hover:bg-zinc-900/85 sm:p-8"
          >
            <div className="flex items-start gap-5">
              <div className="shrink-0 rounded-lg border border-amber-500/40 bg-black/40 p-3">
                <img src={openapkIcon} alt="OpenAPK" className="h-12 w-12" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-3">
                  <h3 className="text-2xl font-semibold text-zinc-50 sm:text-3xl">
                    OpenAPK<span className="text-amber-400">.ai</span>
                  </h3>
                  <span className="rounded border border-emerald-600 bg-emerald-900/40 px-2 py-0.5 font-mono text-xs font-semibold uppercase tracking-[0.15em] text-emerald-300">
                    live
                  </span>
                </div>
                <p className="mt-4 text-base leading-relaxed text-zinc-100 sm:text-lg">
                  Agent-native Android RE. JADX decompile, IDE-style navigation,
                  auto-crypto recreation, network call-site harvesting, MAR + VRR
                  report builder.
                </p>
                <p className="mt-4 font-mono text-sm leading-relaxed text-zinc-300">
                  JADX decompile · symbol index · crypto auto-recreate · MAR + VRR
                </p>
                <span className="mt-6 inline-block text-base font-semibold text-amber-400 group-hover:text-amber-300">
                  openapk.ai →
                </span>
              </div>
            </div>
          </a>
        </ElectricBorder>
      </div>
    </section>
  )
}

// What you can drop in. Doubles as SEO surface — these are the formats people
// search for ("decompile apk", "npm malware", "powershell analysis", ...).
const ecosystems: { icon: LucideIcon; title: string; formats: string; engine: string }[] = [
  { icon: Cpu, title: 'Native binaries', formats: 'ELF · PE · Mach-O', engine: 'Ghidra decompile + disassembly' },
  { icon: Smartphone, title: 'Android APKs', formats: '.apk · .dex · .so', engine: 'JADX decompile (OpenAPK)' },
  { icon: Package, title: 'npm packages', formats: '.tgz · .js · .ts', engine: 'supply-chain malware review' },
  { icon: FileCode2, title: 'PyPI packages', formats: '.whl · sdist · .py', engine: 'Python package + script analysis' },
  { icon: Terminal, title: 'PowerShell', formats: '.ps1 · .psm1', engine: 'static behavior + IOC detection' },
  { icon: Terminal, title: 'Shell scripts', formats: '.sh · .bash · .zsh', engine: 'static behavior + IOC detection' },
]

function Ecosystems() {
  return (
    <section className="mx-auto max-w-6xl px-6 pt-8 pb-16">
      <h2 className="mb-3 text-center font-mono text-sm font-semibold uppercase tracking-[0.22em] text-amber-400">
        Analyze almost anything
      </h2>
      <p className="mx-auto mb-10 max-w-2xl text-center text-lg leading-relaxed text-zinc-200">
        One platform for binaries, mobile apps, and the package ecosystems where
        supply-chain malware actually hides.
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {ecosystems.map(({ icon: Icon, title, formats, engine }) => (
          <div
            key={title}
            className="flex flex-col items-center rounded-xl border border-zinc-800/80 bg-zinc-950/70 p-5 text-center backdrop-blur transition hover:border-amber-500/40 hover:bg-zinc-900/70"
          >
            <Icon className="mb-3 h-7 w-7 text-amber-400" aria-hidden />
            <h3 className="text-sm font-semibold text-zinc-50">{title}</h3>
            <p className="mt-1 font-mono text-[11px] text-zinc-400">{formats}</p>
            <p className="mt-2 text-xs leading-snug text-zinc-400">{engine}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

const capabilityCards: BentoCard[] = [
  {
    icon: Bot,
    label: 'Ask',
    title: 'Agent-driven Q&A',
    description:
      'Ask anything about the binary. The agent navigates source like an IDE - go-to-def, find-usages, package-aware - and cites file:line on every answer.',
  },
  {
    icon: Share2,
    label: 'Publish',
    title: 'Publish your findings',
    description:
      'Turn a finished analysis into a public report with one click. Markdown, citations, annotated screenshots - discoverable by every other researcher on the platform.',
  },
  {
    icon: Users,
    label: 'Collaborate',
    title: 'Cite & build on others',
    description:
      'Browse community reports, cite findings in your own analysis, and credit the researchers who got there first. The reverse-engineering corpus, public and queryable.',
  },
  {
    icon: GitBranch,
    label: 'Trace',
    title: 'Call-chain tracing',
    description:
      'Walk methods upward to entry points or downward to leaves. See how user input flows from intent receivers all the way to network calls.',
  },
  {
    icon: Unlock,
    label: 'Decrypt',
    title: 'Auto decrypt & deobfuscate',
    description:
      'Detect obfuscated crypto and encrypted strings, reconstruct the algorithm in your browser, then decrypt without ever running the binary. CyberChef bridge built in.',
  },
  {
    icon: NotebookPen,
    label: 'Report',
    title: 'MAR + VRR templates',
    description:
      "Ship malware-analysis and vuln-research reports in your org's format. Annotate any view inside the workspace and drop it straight in - markdown, editable, every time.",
  },
  {
    icon: Globe,
    label: 'Network',
    title: 'Network call sites',
    description:
      'Every HTTP endpoint, header, and request body cross-referenced to the call site that built them - Retrofit, OkHttp, libcurl, raw sockets.',
  },
  {
    icon: KeyRound,
    label: 'BYOK',
    title: 'Your LLM, your keys',
    description:
      'Anthropic, OpenAI, or Bedrock - your own key, encrypted at rest. You pay $0 for AI inference: the platform never centralizes LLM spend.',
  },
]

function Capabilities() {
  return (
    <section className="mx-auto max-w-6xl px-6 pt-12 pb-28">
      <h2 className="mb-4 text-center font-mono text-sm font-semibold uppercase tracking-[0.22em] text-amber-400">
        What the platform does
      </h2>
      <p className="mx-auto mb-14 max-w-2xl text-center text-lg leading-relaxed text-zinc-200">
        Drop in a binary, plug in your API key, get to work - then publish what
        you found so the next researcher doesn't have to start from scratch.
      </p>
      <MagicBento
        cards={capabilityCards}
        enableStars
        enableSpotlight
        enableBorderGlow
        enableTilt={false}
        enableMagnetism
        clickEffect
        spotlightRadius={340}
        particleCount={10}
        glowColor="251, 191, 36"
      />
    </section>
  )
}

function WhyOpenBin() {
  return (
    <section id="why" className="mx-auto max-w-5xl px-6 pt-8 pb-24">
      <h2 className="mb-12 text-center font-mono text-sm font-semibold uppercase tracking-[0.22em] text-amber-400">
        Why OpenBin
      </h2>
      <div className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-12">
        <Pillar
          title="A collaborative platform, not a silo"
          body="The shared workspace security research has always been missing. Publish your reverse-engineering work, cite findings from other researchers, and build a public record of how malware and vulnerabilities actually work - together."
        />
        <Pillar
          title="Agent-native, not agent-bolted-on"
          body="Built from day one for LLMs to read decompiled code the way a researcher would - file-aware, symbol-aware, package-aware. Not a chatbot strapped onto a 2008 disassembler."
        />
        <Pillar
          title="Free, open source, BYOK"
          body="Free for researchers and AGPL-licensed - the whole platform is on GitHub. Bring your own LLM key (Anthropic, OpenAI, Bedrock), encrypted at rest, so you pay $0 for AI inference. Enterprise licensing available."
        />
      </div>
    </section>
  )
}

function Pillar({ title, body }: { title: string; body: string }) {
  return (
    <ElectricBorder color="#fbbf24" speed={0.5} chaos={0.25} borderRadius={10}>
      <div className="rounded-[10px] bg-zinc-950/80 p-6 backdrop-blur">
        <h3 className="text-xl font-semibold text-zinc-50">{title}</h3>
        <p className="mt-3 text-base leading-relaxed text-zinc-200">{body}</p>
      </div>
    </ElectricBorder>
  )
}

function CTA() {
  return (
    <section className="mx-auto max-w-3xl px-6 pb-24 text-center">
      <h2 className="text-3xl font-semibold text-zinc-50 sm:text-4xl">
        Start researching. Publish your first finding.
      </h2>
      <p className="mt-5 text-lg text-zinc-200">
        Both products are live. Drop in your LLM provider key, upload a binary
        or APK, put an agent to work - and when you've cracked it, share it with
        the community.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
        <a
          href="https://app.openbin.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md bg-amber-400 px-6 py-3 text-base font-semibold text-black shadow-[0_6px_30px_rgba(251,191,36,0.45)] transition hover:bg-amber-300"
        >
          Open OpenBin →
        </a>
        <a
          href="https://openapk.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-6 py-3 text-base text-zinc-100 backdrop-blur hover:bg-zinc-800/60"
        >
          Try OpenAPK →
        </a>
        <a
          href="https://github.com/openbin-ai/platform"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-6 py-3 text-base text-zinc-100 backdrop-blur hover:bg-zinc-800/60"
        >
          GitHub
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
        <a href="https://github.com/openbin-ai/platform" target="_blank" rel="noopener noreferrer" className="hover:text-amber-400">GitHub</a>
        <span aria-hidden>·</span>
        <a href="mailto:husam@openbin.ai" className="hover:text-amber-400">Contact</a>
        <span aria-hidden>·</span>
        <span>© {new Date().getFullYear()}</span>
      </div>
    </footer>
  )
}
