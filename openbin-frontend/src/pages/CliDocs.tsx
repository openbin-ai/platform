import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import iconUrl from '../assets/icon.png'

/**
 * CLI reference — install per-OS, the Docker requirement (the #1 support
 * question), the core commands, and troubleshooting for the two ways Docker
 * can be missing. Anonymous-readable (declared outside RequireAuth in
 * App.tsx) so prospective users can read it before signing in. Self-contained
 * chrome since the shared Layout is auth-gated. Mirrors Docs.tsx styling.
 */
export function CliDocs() {
  useEffect(() => {
    const prev = document.documentElement.style.scrollBehavior
    document.documentElement.style.scrollBehavior = 'smooth'
    return () => { document.documentElement.style.scrollBehavior = prev }
  }, [])

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link to="/" className="flex items-center gap-2 transition hover:opacity-80">
            <img src={iconUrl} alt="OpenBin" className="h-7 w-7" />
            <span className="text-sm font-semibold tracking-wide">
              OPENBIN<span className="text-amber-400">.AI</span>
            </span>
            <span className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
              CLI Docs
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/docs" className="text-zinc-300 hover:text-amber-400">Quick start</Link>
            <Link to="/projects" className="text-zinc-300 hover:text-amber-400">Open app</Link>
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
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-amber-400/90">
          CLI reference
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
          The OpenBin CLI
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-zinc-300">
          Decompilation runs on <em>your</em> machine. The <code className="text-amber-300">openbin</code> CLI
          runs the decompiler in a local Docker container and uploads only the
          resulting analysis JSON — your binaries and APKs never leave your computer.
          Available for <strong>macOS, Linux, and Windows</strong>.
        </p>

        {/* Docker requirement — the load-bearing prerequisite, up top. */}
        <section id="docker" className="mt-10 scroll-mt-20 rounded-xl border border-sky-700/40 bg-sky-950/20 p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-sky-200">
            <span aria-hidden>🐳</span> Docker is required
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-zinc-200">
            The CLI runs Ghidra (native binaries) and JADX (APKs) inside a Docker
            container it manages for you. That means <strong>Docker must be installed and
            running</strong> before you decompile anything. The first decompile downloads the
            worker image once (~350&nbsp;MB for APKs, ~700&nbsp;MB for native), then caches it.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-zinc-300">
            <li>
              <strong className="text-zinc-100">macOS / Windows:</strong> install{' '}
              <a href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noopener noreferrer" className="text-sky-300 underline-offset-2 hover:underline">
                Docker Desktop
              </a>{' '}
              and launch it (Windows uses the WSL&nbsp;2 backend). Wait until it reports “running”.
            </li>
            <li>
              <strong className="text-zinc-100">Linux:</strong> install{' '}
              <a href="https://docs.docker.com/engine/install/" target="_blank" rel="noopener noreferrer" className="text-sky-300 underline-offset-2 hover:underline">
                Docker Engine
              </a>, then add your user to the{' '}
              <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[12px] text-zinc-100">docker</code>{' '}
              group so it runs without <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[12px] text-zinc-100">sudo</code>.
            </li>
          </ul>
          <p className="mt-3 text-sm text-zinc-400">
            Verify it's ready: <Cmd>docker info</Cmd>
            If that prints without error, you're good. The CLI checks this for you and
            explains what to fix if Docker is missing or stopped.
          </p>
        </section>

        {/* Install */}
        <section id="install" className="mt-12 scroll-mt-20">
          <h2 className="text-xl font-semibold text-zinc-50 sm:text-2xl">Install</h2>
          <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-zinc-200">
            <div>
              <p className="mb-1.5 font-mono text-[11px] uppercase tracking-wide text-amber-400/80">macOS / Linux</p>
              <Cmd>curl -fsSL https://openbin.ai/install.sh | sh</Cmd>
            </div>
            <div>
              <p className="mb-1.5 font-mono text-[11px] uppercase tracking-wide text-amber-400/80">Windows (PowerShell)</p>
              <Cmd>irm https://openbin.ai/install.ps1 | iex</Cmd>
            </div>
            <p className="text-sm text-zinc-400">
              Installs a single ~10&nbsp;MB binary. Prefer a manual download? Grab the
              archive for your platform from the{' '}
              <a href="https://github.com/openbin-ai/platform/releases/latest" target="_blank" rel="noopener noreferrer" className="text-amber-300 underline-offset-2 hover:underline">
                latest release
              </a>{' '}(Windows ships as a <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[12px]">.zip</code> with{' '}
              <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[12px]">openbin.exe</code>).
            </p>
            <Tip>
              Keep the CLI current with <Cmd>openbin update</Cmd>
              It self-replaces in place and pulls a newer worker image automatically on the next run.
            </Tip>
          </div>
        </section>

        {/* Commands */}
        <section id="commands" className="mt-12 scroll-mt-20">
          <h2 className="text-xl font-semibold text-zinc-50 sm:text-2xl">Commands</h2>
          <div className="mt-4 space-y-5">
            <CmdDoc name="openbin login" desc="One-time browser sign-in. Caches a token so later commands are authenticated.">
              <Cmd>openbin login</Cmd>
            </CmdDoc>
            <CmdDoc name="openbin apk" desc="Decompile an Android APK — or an XAPK / split-APK bundle — locally with JADX, then upload the merged source tree as a project.">
              <Cmd>openbin apk ./app.apk</Cmd>
              <Cmd>openbin apk ./com.vendor.app.xapk</Cmd>
              <p className="mt-1.5 text-sm text-zinc-400">
                For an <code className="text-amber-300">.xapk</code>/<code className="text-amber-300">.apks</code> bundle, every split (base + config splits)
                is decompiled and merged into one project. If the app ships native libraries,
                the CLI points you to the project's Native tab to decompile them with Ghidra.
              </p>
            </CmdDoc>
            <CmdDoc name="openbin decompile" desc="Decompile a native binary (ELF, PE, Mach-O) locally with Ghidra, then upload the analysis as a project.">
              <Cmd>openbin decompile ./firmware.elf</Cmd>
            </CmdDoc>
            <CmdDoc name="openbin attach-native" desc="Decompile a single .so and attach it to an existing APK project's Native tab. The in-app 'Decompile this lib' button gives you the exact command to paste.">
              <Cmd>openbin attach-native --project=&lt;id&gt; --lib-path=resources/lib/arm64-v8a/libnative.so ./libnative.so</Cmd>
            </CmdDoc>
            <CmdDoc name="openbin update" desc="Update the CLI to the latest release in place.">
              <Cmd>openbin update</Cmd>
            </CmdDoc>
          </div>
        </section>

        {/* Troubleshooting */}
        <section id="troubleshooting" className="mt-12 scroll-mt-20">
          <h2 className="text-xl font-semibold text-zinc-50 sm:text-2xl">Troubleshooting</h2>
          <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-zinc-200">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="font-semibold text-zinc-100">“Docker is required … the <code className="text-amber-300">docker</code> command wasn't found”</p>
              <p className="mt-1.5 text-sm text-zinc-300">
                Docker isn't installed (or isn't on your PATH). Install it for your OS from the{' '}
                <a href="#docker" className="text-sky-300 underline-offset-2 hover:underline">Docker section</a> above, then re-run.
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="font-semibold text-zinc-100">“Docker is installed but its daemon isn't responding”</p>
              <p className="mt-1.5 text-sm text-zinc-300">
                The engine isn't running. On macOS/Windows, start Docker Desktop and wait until
                it says “running”. On Linux, <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[12px]">sudo systemctl start docker</code>{' '}
                (and confirm your user is in the <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[12px]">docker</code> group).
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="font-semibold text-zinc-100">Entry / Exports panels are empty on an old project</p>
              <p className="mt-1.5 text-sm text-zinc-300">
                Analyses run before the latest worker showed empty Entry/Exports. Run{' '}
                <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[12px]">openbin update</code> and re-decompile the file to populate them.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-14 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-center">
          <h2 className="text-xl font-semibold text-zinc-50">Ready?</h2>
          <p className="mt-2 text-sm text-zinc-300">
            Install, sign in, and decompile your first file.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Link to="/docs" className="rounded-md bg-amber-400 px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-amber-300">
              5-step quick start →
            </Link>
            <Link to="/projects" className="rounded-md border border-zinc-700 bg-zinc-900/60 px-5 py-2.5 text-sm text-zinc-100 hover:bg-zinc-800/60">
              Open the app
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

/** Copy-friendly terminal command line. Mirrors Docs.tsx's Cmd. */
function Cmd({ children }: { children: ReactNode }) {
  return (
    <code className="mt-1 block overflow-x-auto rounded-md border border-zinc-800 bg-black/70 px-3 py-2 font-mono text-[13px] text-emerald-300">
      <span className="select-none text-zinc-600">$ </span>{children}
    </code>
  )
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border-l-2 border-amber-500/50 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-300">
      <span className="font-semibold text-amber-300">Tip:</span> {children}
    </p>
  )
}

function CmdDoc({ name, desc, children }: { name: string; desc: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
      <p className="font-mono text-sm font-semibold text-amber-300">{name}</p>
      <p className="mt-1 text-sm text-zinc-300">{desc}</p>
      <div className="mt-2">{children}</div>
    </div>
  )
}
