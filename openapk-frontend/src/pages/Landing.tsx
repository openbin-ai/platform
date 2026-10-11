import { useEffect, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { Link, useNavigate } from 'react-router-dom'
import { Star, Menu, X } from 'lucide-react'
import HexDrift from '../components/HexDrift'
import { FeatureTour } from '../components/FeatureTour'
import logoUrl from '../assets/logo.png'
import iconUrl from '../assets/icon.png'

// Tab-scoped flag set when the user clicks Sign in / Get started from the
// landing. On return from Keycloak we use it to skip past the marketing page
// and drop them straight into /dashboard. Users who arrive at / already
// signed in (e.g. typed the URL) do NOT have the flag, so we leave them on
// the landing with the "Open dashboard" CTA.
const POST_SIGNIN_FLAG = 'openapk:post-signin'

export function Landing() {
  const auth = useAuth()
  const navigate = useNavigate()
  const authed = auth.isAuthenticated
  const [menuOpen, setMenuOpen] = useState(false)

  const startSignin = () => {
    sessionStorage.setItem(POST_SIGNIN_FLAG, '1')
    void auth.signinRedirect()
  }

  useEffect(() => {
    if (authed && sessionStorage.getItem(POST_SIGNIN_FLAG) === '1') {
      sessionStorage.removeItem(POST_SIGNIN_FLAG)
      navigate('/dashboard', { replace: true })
    }
  }, [authed, navigate])

  return (
    <div className="relative min-h-full overflow-hidden bg-black text-zinc-100">
      <div className="pointer-events-none fixed inset-0 z-0 opacity-60">
        <HexDrift
          baseColors={['#3b0a0a', '#3f3f46', '#4c1d95']}
          accentColor="#ef4444"
          outerVignette
          centerVignette
        />
      </div>

      {/* Announcement bar: the BINNY beta. Mirrors the openbin.ai landing's
          BinnyAnnounceBar; links down to the install block on this page. */}
      <a
        href="#binny"
        className="relative z-20 block border-b border-purple-500/30 bg-purple-500/10 px-4 py-2 text-center text-sm text-purple-200 backdrop-blur transition hover:bg-purple-500/20"
      >
        <span className="font-semibold text-purple-100">BINNY beta is out.</span> A terminal agent that
        investigates your APK and drafts the report, with your own LLM key.{' '}
        <span className="underline decoration-purple-400/50 underline-offset-2">Install it</span>
      </a>

      <header className="relative z-30 flex items-center justify-between px-6 py-5 sm:px-10">
        <div className="flex items-center gap-2">
          <img src={iconUrl} alt="" className="h-8 w-8" />
          <span className="text-sm font-semibold tracking-wide text-zinc-200">OPENAPK<span className="text-red-500">.AI</span></span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {/* Compact Community pill in the top nav — second visual cue for
              the dashboard's headline CTA. Brand-amber to match the family
              accent so it stands out from plain text links. */}
          <Link
            to="/community"
            className="hidden items-center gap-1 rounded-md bg-amber-500/15 px-3 py-1 text-amber-300 hover:bg-amber-500/25 hover:text-amber-200 sm:inline-flex"
          >
            <Star aria-hidden className="h-3.5 w-3.5" /> Community
          </Link>
          <a
            href="https://github.com/openbin-ai/platform"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden text-zinc-400 hover:text-zinc-200 sm:inline"
          >
            Source
          </a>
          <a
            href="https://discord.gg/HQsCZBHXwc"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden text-zinc-400 hover:text-zinc-200 sm:inline"
          >
            Discord
          </a>
          {authed ? (
            <Link
              to="/dashboard"
              className="rounded-md border border-purple-500/60 bg-purple-600/20 px-3 py-1.5 text-purple-200 backdrop-blur hover:bg-purple-600/30"
            >
              Open dashboard
            </Link>
          ) : (
            <button
              onClick={startSignin}
              className="rounded-md border border-purple-500/60 bg-purple-600/20 px-3 py-1.5 text-purple-200 backdrop-blur hover:bg-purple-600/30"
            >
              Sign in
            </button>
          )}
          {/* Mobile menu toggle for the links the phone layout hides.
              Plain glyphs — this package doesn't ship an icon library. */}
          <button
            type="button"
            onClick={() => setMenuOpen(open => !open)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2 text-zinc-200 backdrop-blur sm:hidden"
          >
            {menuOpen ? <X className="h-4 w-4" aria-hidden /> : <Menu className="h-4 w-4" aria-hidden />}
          </button>
        </div>
        {menuOpen && (
          <nav className="absolute inset-x-0 top-full flex flex-col border-b border-zinc-800 bg-black/95 px-6 pb-4 pt-2 text-sm backdrop-blur sm:hidden">
            <Link to="/community" onClick={() => setMenuOpen(false)} className="inline-flex items-center gap-1.5 py-2.5 text-amber-300 hover:text-amber-200">
              <Star aria-hidden className="h-3.5 w-3.5" /> Community
            </Link>
            <a
              href="https://github.com/openbin-ai/platform"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
              className="py-2.5 text-zinc-300 hover:text-zinc-100"
            >
              Source
            </a>
            <a
              href="https://discord.gg/HQsCZBHXwc"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
              className="py-2.5 text-zinc-300 hover:text-zinc-100"
            >
              Discord
            </a>
          </nav>
        )}
      </header>

      <main className="relative z-10">
        <section className="mx-auto flex max-w-5xl flex-col items-center px-6 pt-12 pb-20 text-center sm:pt-20">
          <img
            src={logoUrl}
            alt="OpenAPK"
            className="mb-8 h-40 w-auto drop-shadow-[0_8px_30px_rgba(239,68,68,0.35)] sm:h-52"
          />
          {/* SEO: brand name in H1 so Google + ChatGPT search see "OpenAPK"
              as the page's primary subject. The marketing line is now a
              continuation rather than the whole heading. */}
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-zinc-50 sm:text-5xl">
            OpenAPK: Android reverse engineering,{' '}
            <span className="text-purple-400">from an agentic perspective</span>.
          </h1>
          <p className="mt-3 font-mono text-xs uppercase tracking-[0.25em] text-amber-400/80 sm:text-sm">
            Part of The Open Binary Project
          </p>
          <p className="mt-5 max-w-2xl text-base text-zinc-300/90 sm:text-lg">
            A free, cloud-based research workspace for security teams and reverse
            engineers. Bring your own LLM key, point the agent at the decompiled
            tree, and put it to work on identifier recovery, string decoding and
            crypto reconstruction.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
            {authed ? (
              <Link
                to="/dashboard"
                className="rounded-md bg-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow-[0_6px_30px_rgba(124,58,237,0.45)] hover:bg-purple-500"
              >
                Open dashboard
              </Link>
            ) : (
              <button
                onClick={startSignin}
                className="rounded-md bg-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow-[0_6px_30px_rgba(124,58,237,0.45)] hover:bg-purple-500"
              >
                Sign in and upload an APK
              </button>
            )}
            <Link
              to="/community"
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-5 py-2.5 text-sm font-semibold text-black hover:bg-amber-400"
            >
              <Star aria-hidden className="h-4 w-4" />
              Browse community
            </Link>
            <a
              href="#capabilities"
              className="rounded-md border border-zinc-700 bg-zinc-900/60 px-5 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800/60"
            >
              See what the agent does
            </a>
          </div>
          <p className="mt-6 text-xs text-zinc-500">
            v1.0 · Free &amp; open source (AGPL v3) · BYOK (Anthropic · OpenAI · Bedrock)
          </p>
        </section>

        <section id="binny" className="mx-auto max-w-4xl px-6 pb-20">
          <div className="rounded-lg border border-purple-500/40 bg-zinc-950/85 p-6 sm:p-8">
            <p className="mb-2 font-mono text-xs uppercase tracking-[0.25em] text-purple-300">BINNY beta</p>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">
              Hand the APK to an agent in your terminal.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-zinc-200">
              BINNY opens one of your OpenAPK projects, reads the decompiled tree
              through the same backend this site uses, and runs a triage,
              investigate, draft loop with your own LLM key. Pause it at phase
              boundaries, answer its questions, or switch to Q&amp;A and ask it to
              verify a claim. The draft lands on the project report for you to
              review. Needs the openbin CLI signed in first; it is a beta.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 rounded-md border border-zinc-800 bg-black/50 px-4 py-3">
                <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-purple-300/80">macOS / Linux</div>
                <code className="block overflow-x-auto whitespace-nowrap font-mono text-sm text-zinc-100">
                  curl -fsSL https://openbin.ai/install-binny.sh | sh
                </code>
              </div>
              <div className="min-w-0 rounded-md border border-zinc-800 bg-black/50 px-4 py-3">
                <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-purple-300/80">Windows (PowerShell)</div>
                <code className="block overflow-x-auto whitespace-nowrap font-mono text-sm text-zinc-100">
                  irm https://openbin.ai/install-binny.ps1 | iex
                </code>
              </div>
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              Then <code className="font-mono text-zinc-300">openbin login &amp;&amp; binny</code>. More on{' '}
              <a href="https://openbin.ai/#binny" target="_blank" rel="noopener noreferrer" className="text-amber-400 underline-offset-4 hover:underline">openbin.ai</a>.
            </p>
          </div>
        </section>

        <section id="byok" className="mx-auto max-w-4xl px-6 pb-20">
          <div className="rounded-lg border border-purple-500/30 bg-zinc-950/80 p-6 sm:p-8">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">
              Bring your own key.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-zinc-200">
              OpenAPK ships no hosted LLM and proxies nothing. You add a key for
              Anthropic, OpenAI or AWS Bedrock; it is stored encrypted, and every
              model call goes to <em className="not-italic text-purple-300">your</em>{' '}
              provider with <em className="not-italic text-purple-300">your</em>{' '}
              headers. The only AI bill is the one your provider sends you.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-zinc-400">
              Your projects (the APK, the decompiled tree, reports, screenshots)
              live in the cloud, so you can open them from anywhere and share
              them with your team. Everything the agent proposes can be undone
              from the UI, and the whole platform is AGPL-3.0 on GitHub, so you
              can self-host it instead.
            </p>
          </div>
        </section>

        <section id="capabilities" className="mx-auto max-w-4xl px-6 pb-20">
          <h2 className="mb-3 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
            What the agent does for you
          </h2>
          <p className="mb-10 max-w-2xl text-base text-zinc-400">
            The agent reads decompiled Java, Kotlin, smali, the manifest and
            resources the same way you would, across thousands of files at once.
            That makes the tedious parts of the workflow tractable.
          </p>
          <dl className="divide-y divide-zinc-800 border-y border-zinc-800">
            <Capability
              name="Identifier recovery"
              body="Reads ProGuard-mangled a/b/c and defpackage classes in context and proposes names, with its reasoning. You tick the ones you want, the rename is applied project-wide with word-boundary safety, and every rename can be reverted from the same panel."
            />
            <Capability
              name="Crypto reconstruction"
              body="Static signatures flag javax.crypto pipelines, hand-rolled XOR and Base64 obfuscators (Sketchware-style and friends), and custom decoder shapes. The agent writes a runnable Python decryptor and, when the algorithm maps cleanly, a CyberChef recipe URL you can hand to a teammate."
            />
            <Capability
              name="String decoding"
              body="After reconstructing the routine, OpenAPK collects every ciphertext literal that flows into the decoder's entry methods, dedupes them, and inlines the decoded output into the script."
            />
            <Capability
              name="BINNY light"
              body="Ask about the open file and BINNY reads other files and searches the tree when it needs to, with citations back to file and line. Ask it to highlight a finding, draft a report section or write a script and it does that on the project. Threads stay in your browser."
            />
            <Capability
              name="Evidence capture and reporting"
              body="Grab a region of the screen, annotate it with boxes, arrows, text or freehand, and insert it into a report section from the project gallery. Publish reports, or export them as Markdown with images inlined or as a print-ready PDF."
            />
          </dl>
        </section>

        <FeatureTour />

        <section id="features" className="mx-auto max-w-4xl px-6 pb-24">
          <h2 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
            Under the hood
          </h2>
          <div className="grid grid-cols-1 gap-x-12 gap-y-8 md:grid-cols-2">
            <Feature
              title="Decompilation"
              body="JADX Java and Kotlin extraction, with smali, resources and the manifest one click away. Re-decompile with different options without re-uploading. Full-text search across the tree."
            />
            <Feature
              title="Your model, your keys"
              body="Per-user credentials for Anthropic, OpenAI or AWS Bedrock. Pick the model that fits the budget per call. Keys live in your Postgres, encrypted at rest with a KEK you supply."
            />
            <Feature
              title="Reversible by design"
              body="Renames, decompiles and report edits can all be undone from the UI. BINNY only writes to highlights, the report or scripts when you ask it to, and every write carries your name. Audit trail per project."
            />
            <Feature
              title="Free and open source"
              body="Free for researchers. The whole stack (Spring Boot core, Postgres, Keycloak, S3, frontend) is AGPL-3.0 on GitHub: inspect it, contribute, or self-host it. No phone-home, no vendor analytics."
            />
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-6 pb-20">
          <a
            href="https://openbin.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="group block rounded-lg border border-amber-500/30 bg-zinc-950/80 p-6 transition hover:border-amber-400/60 sm:p-7"
          >
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-amber-400/80">
              Part of The Open Binary Project
            </p>
            <h2 className="mt-3 text-xl font-semibold text-zinc-50">
              Native binaries? That is OpenBin<span className="text-amber-400">.ai</span>.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-300">
              The same agent on ELF, PE and Mach-O, with Ghidra doing the
              decompiling. Same account, same free and BYOK stance, built for
              the malware triage and vuln-research work OpenAPK does not cover.
            </p>
            <span className="mt-4 inline-block font-mono text-sm text-amber-400 group-hover:underline group-hover:underline-offset-4">
              openbin.ai
            </span>
          </a>
        </section>

        <section className="mx-auto max-w-3xl px-6 pb-24 text-center">
          <h2 className="text-2xl font-semibold text-zinc-100 sm:text-3xl">
            Take it for a run.
          </h2>
          <p className="mt-3 text-sm text-zinc-400">
            Sign in, add your LLM provider key, and upload your first APK.
            Your key and your findings stay yours.
          </p>
          <div className="mt-6">
            {authed ? (
              <Link
                to="/projects"
                className="inline-block rounded-md bg-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow-[0_6px_30px_rgba(124,58,237,0.45)] hover:bg-purple-500"
              >
                Go to projects
              </Link>
            ) : (
              <button
                onClick={startSignin}
                className="rounded-md bg-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow-[0_6px_30px_rgba(124,58,237,0.45)] hover:bg-purple-500"
              >
                Sign in
              </button>
            )}
          </div>
        </section>

        <footer className="relative z-10 border-t border-zinc-900/80 bg-black/40 px-6 py-8 text-center text-xs text-zinc-400 backdrop-blur">
          <div className="flex flex-col items-center justify-center gap-1 sm:flex-row sm:gap-3">
            <span>OpenAPK.ai · Android Security Research Platform</span>
            <span className="hidden sm:inline">·</span>
            <span>Part of the <a href="https://openbin.ai" target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline">OpenBin</a> family</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono text-[11px] tracking-wide text-zinc-500">
            <span>AGPL v3 · BYOK · Free for researchers</span>
            <span aria-hidden>·</span>
            <Link to="/terms" className="hover:text-zinc-300">Terms</Link>
            <span aria-hidden>·</span>
            <Link to="/privacy" className="hover:text-zinc-300">Privacy</Link>
            <span aria-hidden>·</span>
            <Link to="/community" className="hover:text-zinc-300">Community</Link>
            <span aria-hidden>·</span>
            <a href="https://github.com/openbin-ai/platform" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300">Source</a>
            <span aria-hidden>·</span>
            <a href="https://discord.gg/HQsCZBHXwc" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300">Discord</a>
            <span aria-hidden>·</span>
            <a href="mailto:husam@openbin.ai" className="hover:text-zinc-300">Contact</a>
            <span aria-hidden>·</span>
            <span>© {new Date().getFullYear()}</span>
          </div>
        </footer>
      </main>
    </div>
  )
}

// Plain text blocks, not cards: four peers of equal weight, and a border
// around each would only add chrome.
function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-t border-zinc-800 pt-5">
      <h3 className="text-base font-semibold text-zinc-50">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">{body}</p>
    </div>
  )
}

function Capability({ name, body }: { name: string; body: string }) {
  return (
    <div className="grid gap-2 py-5 sm:grid-cols-[14rem_1fr] sm:gap-8">
      <dt className="text-base font-semibold text-zinc-50">{name}</dt>
      <dd className="text-sm leading-relaxed text-zinc-300">{body}</dd>
    </div>
  )
}
