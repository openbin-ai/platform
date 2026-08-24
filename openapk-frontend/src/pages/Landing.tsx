import { useEffect, useState } from 'react'
import { useAuth } from 'react-oidc-context'
import { Link, useNavigate } from 'react-router-dom'
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

      {/* Launch announcement — mirrors the openbin.ai landing bar. */}
      <a
        href="https://discord.gg/HQsCZBHXwc"
        target="_blank"
        rel="noopener noreferrer"
        className="relative z-20 block border-b border-purple-500/30 bg-purple-500/10 px-4 py-2 text-center text-sm text-purple-200 backdrop-blur transition hover:bg-purple-500/20"
      >
        <span aria-hidden className="mr-1">🚀</span>
        <span className="font-semibold text-purple-100">We've launched:</span> v1.0 is out of beta, with{' '}
        <span className="font-semibold text-purple-100">1000+ researchers</span> on board.{' '}
        <span className="underline decoration-purple-400/50 underline-offset-2">Join the Discord →</span>
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
            <span aria-hidden>★</span> Community
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
            className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-base leading-none text-zinc-200 backdrop-blur sm:hidden"
          >
            <span aria-hidden>{menuOpen ? '✕' : '☰'}</span>
          </button>
        </div>
        {menuOpen && (
          <nav className="absolute inset-x-0 top-full flex flex-col border-b border-zinc-800 bg-black/95 px-6 pb-4 pt-2 text-sm backdrop-blur sm:hidden">
            <Link to="/community" onClick={() => setMenuOpen(false)} className="py-2.5 text-amber-300 hover:text-amber-200">
              ★ Community
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
            OpenAPK — Android reverse engineering,{' '}
            <span className="text-purple-400">from an agentic perspective</span>.
          </h1>
          <p className="mt-3 font-mono text-xs uppercase tracking-[0.25em] text-amber-400/80 sm:text-sm">
            Part of The Open Binary Project
          </p>
          <p className="mt-5 max-w-2xl text-base text-zinc-300/90 sm:text-lg">
            A free, cloud-based research workspace for security teams and reverse
            engineers. Bring your own LLM key - point an agent at the decompiled
            tree and put it to work on identifier recovery, string decoding, and
            crypto reconstruction. Your work, your model, accessible anywhere.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
            {authed ? (
              <Link
                to="/dashboard"
                className="rounded-md bg-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow-[0_6px_30px_rgba(124,58,237,0.45)] hover:bg-purple-500"
              >
                Open dashboard →
              </Link>
            ) : (
              <button
                onClick={startSignin}
                className="rounded-md bg-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow-[0_6px_30px_rgba(124,58,237,0.45)] hover:bg-purple-500"
              >
                Get started →
              </button>
            )}
            <Link
              to="/community"
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-5 py-2.5 text-sm font-semibold text-black shadow-[0_4px_20px_rgba(251,191,36,0.4)] hover:bg-amber-400"
            >
              <span aria-hidden>★</span>
              Browse community
            </Link>
            <a
              href="#capabilities"
              className="rounded-md border border-zinc-700 bg-zinc-900/60 px-5 py-2.5 text-sm text-zinc-200 backdrop-blur hover:bg-zinc-800/60"
            >
              See what the agent does
            </a>
          </div>
          <p className="mt-6 text-xs text-zinc-500">
            v1.0 · Free &amp; open source (AGPL v3) · BYOK (Anthropic · OpenAI · Bedrock)
          </p>
        </section>

        <section id="byok" className="mx-auto max-w-4xl px-6 pb-20">
          <div className="rounded-xl border border-purple-500/30 bg-zinc-950/70 p-6 backdrop-blur sm:p-8">
            <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-purple-300">
              Bring your own key
            </h2>
            <p className="mt-4 text-base leading-relaxed text-zinc-200">
              OpenAPK ships no hosted LLM and proxies nothing. You provide
              credentials for Anthropic, OpenAI, or AWS Bedrock; they are
              encrypted at rest, and every model call goes straight to{' '}
              <em className="not-italic text-purple-300">your</em> provider with{' '}
              <em className="not-italic text-purple-300">your</em> headers - so you
              pay <span className="text-purple-300">$0</span> for AI inference. No
              telemetry. No middleman. No vendor lock-in on the intelligence layer.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-zinc-400">
              Your projects - the APK, the decompiled tree, reports, screenshots -
              live in the cloud, so your work is accessible from anywhere and
              shareable with your team. Everything the agent does is reversible
              from the UI, and because the whole platform is AGPL-3.0 on GitHub,
              you can self-host it if you'd rather. The agent is a tool you
              command, not a SaaS that holds your work hostage.
            </p>
          </div>
        </section>

        <section id="capabilities" className="mx-auto max-w-4xl px-6 pb-20">
          <h2 className="mb-3 text-center text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
            What the agent does for you
          </h2>
          <p className="mx-auto mb-10 max-w-2xl text-center text-sm text-zinc-400">
            The agent reads decompiled Java, Kotlin, smali, the manifest, and
            resources the same way you would - except it can do it across
            thousands of files in parallel. That makes the tedious parts of an
            RE workflow tractable.
          </p>
          <ul className="space-y-4 text-sm leading-relaxed text-zinc-300">
            <Capability
              name="Identifier recovery"
              body="Reads ProGuard-mangled a/b/c/defpackage classes in context and proposes meaningful names with reasoning. You tick what you want, the rewrite is applied project-wide with word-boundary safety, and every rename is reversible from the same panel."
            />
            <Capability
              name="Crypto reconstruction"
              body="Static signatures flag javax.crypto pipelines, hand-rolled XOR/Base64 obfuscators (Sketchware-style and friends), and custom decoder shapes. The agent emits a runnable Python decryptor and - when the algorithm maps cleanly - a CyberChef recipe URL you can hand to a teammate."
            />
            <Capability
              name="String decoding"
              body="After reconstructing the routine, OpenAPK harvests every ciphertext literal that flows into the decoder's entry methods across the project, dedupes them, and inlines the decoded output into the script so you don't have to re-run anything by hand."
            />
            <Capability
              name="Grounded source Q&A"
              body="Point the agent at any file or symbol. Answers are grounded in what is actually on disk - not the model's training set - with citations back to file:line. Threaded conversations are persisted per project so you can revisit a finding tomorrow."
            />
            <Capability
              name="Evidence capture & reporting"
              body="Region-grab the screen, annotate with rect/arrow/text/freehand, insert into a report section from the project gallery. Publish reports, export as portable Markdown (images base64-inlined) or print-ready PDF. Workflow status moves with the work."
            />
          </ul>
        </section>

        <FeatureTour />

        <section id="features" className="mx-auto max-w-6xl px-6 pb-24">
          <h2 className="mb-10 text-center text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
            Stack
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Feature
              title="Decompilation pipeline"
              body="JADX-powered Java + Kotlin extraction with smali, resources, and the manifest one click away. Re-decompile with different options without re-uploading. Full-text search across the tree."
            />
            <Feature
              title="Bring your own model"
              body="Per-user credentials for Anthropic, OpenAI, or AWS Bedrock. Pick the model that fits the budget on a per-call basis. Keys live in your Postgres, encrypted at rest with a KEK you supply."
            />
            <Feature
              title="Reversible by design"
              body="Renames, decompiles, and report edits are all reversible from the UI. Nothing the agent proposes is applied to your project unless you accept it. Audit trail per project."
            />
            <Feature
              title="Free & open source"
              body="Free for researchers. The whole stack - Spring Boot core, Postgres, Keycloak, S3, frontend - is AGPL-3.0 on GitHub: inspect it, contribute, or self-host if you need to. No phone-home, no vendor analytics."
            />
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-6 pb-20">
          <h2 className="mb-6 text-center text-xs font-medium uppercase tracking-[0.2em] text-amber-400">
            Part of The Open Binary Project (OpenBin)
          </h2>
          <a
            href="https://openbin.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="group block rounded-xl border border-amber-500/30 bg-zinc-950/70 p-6 backdrop-blur transition hover:border-amber-400/50 hover:bg-zinc-900/70 sm:p-7"
          >
            <div className="flex items-start gap-5">
              <div className="shrink-0 rounded-lg border border-amber-500/40 bg-black/40 p-3 text-2xl">
                🧬
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-3">
                  <h3 className="text-xl font-semibold text-zinc-50">
                    OpenBin<span className="text-amber-400">.ai</span>
                  </h3>
                  <span className="rounded border border-amber-600/60 bg-amber-900/30 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-300">
                    Native RE
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                  Same agent, native binaries. ELF / PE / Mach-O reverse engineering powered by
                  Ghidra, with the same free, BYOK, open-source stance. Built for the
                  malware triage and vuln-research workflows OpenAPK doesn't cover.
                </p>
                <span className="mt-4 inline-block text-sm font-semibold text-amber-400 group-hover:text-amber-300">
                  openbin.ai →
                </span>
              </div>
            </div>
          </a>
        </section>

        <section className="mx-auto max-w-3xl px-6 pb-24 text-center">
          <h2 className="text-2xl font-semibold text-zinc-100 sm:text-3xl">
            Take it for a run.
          </h2>
          <p className="mt-3 text-sm text-zinc-400">
            Sign in, drop in your LLM provider key, and upload your first APK.
            The agent goes to work; your key and your findings stay yours.
          </p>
          <div className="mt-6">
            {authed ? (
              <Link
                to="/projects"
                className="inline-block rounded-md bg-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow-[0_6px_30px_rgba(124,58,237,0.45)] hover:bg-purple-500"
              >
                Go to projects →
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

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-5 backdrop-blur transition hover:border-purple-500/40 hover:bg-zinc-900/60">
      <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">{body}</p>
    </div>
  )
}

function Capability({ name, body }: { name: string; body: string }) {
  return (
    <li className="flex gap-4 rounded-lg border border-zinc-800/70 bg-zinc-950/50 p-4 backdrop-blur">
      <span aria-hidden className="select-none text-purple-400">→</span>
      <div>
        <span className="font-semibold text-zinc-100">{name}</span>
        <span className="text-zinc-400"> - {body}</span>
      </div>
    </li>
  )
}
