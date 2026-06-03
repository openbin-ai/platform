import { useEffect } from 'react'
import { useAuth } from 'react-oidc-context'
import { Link, useNavigate } from 'react-router-dom'
import LetterGlitch from '../components/LetterGlitch'
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
        <LetterGlitch
          glitchColors={['#3b0a0a', '#7c3aed', '#ef4444']}
          glitchSpeed={55}
          outerVignette
          centerVignette
          smooth
        />
      </div>

      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <div className="flex items-center gap-2">
          <img src={iconUrl} alt="" className="h-8 w-8" />
          <span className="text-sm font-semibold tracking-wide text-zinc-200">OPENAPK<span className="text-red-500">.AI</span></span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link
            to="/community"
            className="hidden text-purple-300 hover:text-purple-200 sm:inline"
          >
            Community
          </Link>
          <a
            href="https://github.com/keycomagix/openapk"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden text-zinc-400 hover:text-zinc-200 sm:inline"
          >
            Source
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
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto flex max-w-5xl flex-col items-center px-6 pt-12 pb-20 text-center sm:pt-20">
          <img
            src={logoUrl}
            alt="OpenAPK"
            className="mb-8 h-40 w-auto drop-shadow-[0_8px_30px_rgba(239,68,68,0.35)] sm:h-52"
          />
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-zinc-50 sm:text-5xl">
            Android reverse engineering,{' '}
            <span className="text-purple-400">from an agentic perspective</span>.
          </h1>
          <p className="mt-5 max-w-2xl text-base text-zinc-300/90 sm:text-lg">
            A self-hosted research workspace for security teams and reverse
            engineers. Bring your own LLM key - point an agent at the decompiled
            tree and put it to work on identifier recovery, string decoding, and
            crypto reconstruction. Your APK, your model, your infrastructure.
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
            <a
              href="#capabilities"
              className="rounded-md border border-zinc-700 bg-zinc-900/60 px-5 py-2.5 text-sm text-zinc-200 backdrop-blur hover:bg-zinc-800/60"
            >
              See what the agent does
            </a>
          </div>
          <p className="mt-6 text-xs text-zinc-500">
            Beta · BYOK (Anthropic · OpenAI · Bedrock) · self-hosted
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
              encrypted at rest with a KEK you control, and every model call
              leaves <em className="not-italic text-purple-300">your</em>{' '}
              infrastructure with <em className="not-italic text-purple-300">your</em>{' '}
              headers. No telemetry. No middleman. No vendor lock-in on the
              intelligence layer.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-zinc-400">
              The APK, the decompiled tree, the reports, the screenshots -
              all of it sits in Postgres and on a disk you own. Self-host the
              whole stack with Docker. Air-gap it if you need to. The agent is
              a tool the researcher commands, not a SaaS that holds their work
              hostage.
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
              body="Renames, decompiles, and report edits are all reversible from the UI. Nothing the agent does touches your filesystem unless you tick a box. Audit trail per project."
            />
            <Feature
              title="Self-hosted"
              body="Docker-compose for the whole stack: Spring Boot core, Postgres, Keycloak, MinIO/S3, frontend. Air-gap-friendly. No phone-home. No vendor analytics."
            />
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-6 pb-20">
          <h2 className="mb-6 text-center text-xs font-medium uppercase tracking-[0.2em] text-amber-400">
            Part of the OpenBin family
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
                  Ghidra, with the same BYOK, self-hosted, open-source stance. Built for the
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
            The agent goes to work; nothing leaves your box.
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
            <span>AGPL v3 · BYOK · self-hostable</span>
            <span aria-hidden>·</span>
            <Link to="/terms" className="hover:text-zinc-300">Terms</Link>
            <span aria-hidden>·</span>
            <Link to="/privacy" className="hover:text-zinc-300">Privacy</Link>
            <span aria-hidden>·</span>
            <Link to="/community" className="hover:text-zinc-300">Community</Link>
            <span aria-hidden>·</span>
            <a href="https://github.com/keycomagix/openapk" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300">Source</a>
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
