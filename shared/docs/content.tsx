import type { ReactNode } from 'react'
import { Bullets, Clicks, Cmd, Code, Ext, H2, Kbd, Note, P, Pre, Table, Tip, Warn, focusRing } from './primitives'
import type { DocCtx, DocSection } from './types'

// Every page in the docs. One tree, filtered per app by DocsShell. Each page
// body is a function of the context so prose can say "OpenBin" or "OpenAPK",
// pull the right screenshot, and link to the right install script.
//
// Rule for this file: describe only what the UI actually does, with the
// labels it actually shows. The inventory this was written from lives in the
// code itself; when a button is renamed, rename it here.

function L({ ctx, to, children }: { ctx: DocCtx; to: string; children: ReactNode }) {
  const Link = ctx.Link
  return (
    <Link to={to} className={`rounded text-amber-300 underline decoration-amber-400/40 underline-offset-4 hover:decoration-amber-300 ${focusRing}`}>
      {children}
    </Link>
  )
}

const isApk = (ctx: DocCtx) => ctx.app === 'openapk'

export const DOC_SECTIONS: DocSection[] = [
  // ------------------------------------------------------------------ start
  {
    id: 'start',
    title: 'Start here',
    pages: [
      {
        slug: 'overview',
        title: 'What this is',
        summary: 'A shared workspace for reverse engineering: decompile on your machine, analyze in the browser with an agent that reads the code, publish what you found.',
        keywords: ['intro', 'overview', 'what is', 'loop', 'workflow'],
        body: (ctx) => (
          <>
            <P>
              {ctx.appName} is one of two apps on the same account. OpenBin takes native binaries
              (ELF, PE, Mach-O) and npm, PyPI, PowerShell and shell packages. OpenAPK takes Android
              APKs and XAPKs. Your API keys, your community profile, your messages and your sign-in
              are shared between them.
            </P>
            <H2>The loop</H2>
            <Clicks
              items={[
                <>
                  <strong>Decompile on your machine.</strong> The <Code>openbin</Code> CLI runs Ghidra or JADX in a
                  local Docker container and uploads the decompiled result as a project. See{' '}
                  <L ctx={ctx} to="/docs/start/first-project">your first project</L>.
                </>,
                <>
                  <strong>Read it like an IDE.</strong> Functions or files on the left, code in the middle, an
                  inspector on the right with analysis, cross references, highlights, screenshots and the report.
                  See <L ctx={ctx} to="/docs/workspace/navigating-code">navigating code</L>.
                </>,
                <>
                  <strong>Ask BINNY.</strong> The in-browser agent reads the functions or files it needs, cites
                  where it looked, and on request pins highlights, writes report sections and saves scripts.
                  In the terminal, the full BINNY harness runs a whole investigation. See{' '}
                  <L ctx={ctx} to="/docs/binny/light">BINNY light</L> and <L ctx={ctx} to="/docs/binny/terminal">BINNY in the terminal</L>.
                </>,
                <>
                  <strong>Write and publish.</strong> The report lives next to the code. Publish it to the
                  community feed, make the project public so others can fork it, discuss, follow. See{' '}
                  <L ctx={ctx} to="/docs/reports/editor">reports</L> and <L ctx={ctx} to="/docs/community/browse">community</L>.
                </>,
              ]}
            />
            <H2>What it costs</H2>
            <P>
              Nothing from us. The platform is free and AGPL-3.0 licensed. Model calls go to your own
              provider with your own key, so the only AI bill is the one your provider sends you. See{' '}
              <L ctx={ctx} to="/docs/binny/providers">providers and keys</L>.
            </P>
            <H2>Where things live</H2>
            <Table
              head={['Place', 'What is there']}
              rows={[
                ['Dashboard', 'Your recent projects, the community feed, this month’s token usage' + (isApk(ctx) ? '' : ', the weekly CTF') + '.'],
                ['Projects', 'Every project you own or were invited to' + (isApk(ctx) ? '.' : ', plus the upload card for npm, PyPI and shell packages.')],
                ['Community', 'Published reports, researcher search, profiles.'],
                ['Messages', 'Direct messages and project team chats.'],
                ['Settings', 'Profile, API Keys, Templates, Usage.'],
                ['Docs', 'This.'],
              ]}
            />
          </>
        ),
      },
      {
        slug: 'account-and-key',
        title: 'Sign in and add a model key',
        summary: 'One account for both apps. BINNY and the AI panels stay disabled until you save a key.',
        keywords: ['sign in', 'login', 'account', 'api key', 'byok', 'credential', 'anthropic', 'openai'],
        image: { key: 'api-keys', alt: 'The API Keys settings page with the Add credential form' },
        body: (ctx) => (
          <>
            <H2>Sign in</H2>
            <Clicks
              items={[
                <>Click <Kbd>Sign in</Kbd> at the top right. It opens the shared sign-in page.</>,
                <>Create an account or use an existing one. The same account works on app.openbin.ai and openapk.ai.</>,
                <>On first sign-in you accept the Terms. You land on the dashboard.</>,
              ]}
            />
            <H2>Add a key</H2>
            <P>
              Go to <Kbd>Settings</Kbd> then <Kbd>API Keys</Kbd>. Pick a <Kbd>Provider</Kbd>, give the key a <Kbd>Label</Kbd>, paste the
              key, click <Kbd>Add credential</Kbd>. Then click <Kbd>Test</Kbd> on the saved row to confirm it works.
            </P>
            <Table
              head={['Provider', 'What it needs']}
              rows={[
                ['Anthropic', 'API key. Optional Gateway URL if your key belongs to a service that hosts Claude behind its own domain.'],
                ['OpenAI', 'API key.'],
                ['Google Gemini', 'API key.'],
                ['DeepSeek', 'API key.'],
                ['Qwen (Alibaba)', 'API key.'],
                ['Kimi (Moonshot)', 'API key.'],
                ['OpenAI-compatible (custom)', 'API key and Base URL ending in /v1. Any server that speaks the Chat Completions API.'],
                ['AWS Bedrock', 'Access key ID, Secret access key, Region (default us-east-1), optional Session token.'],
              ]}
            />
            <P>
              Keys are encrypted at rest with AES-256-GCM and belong to you, not to a project. One key saved on
              OpenBin is available on OpenAPK and the other way round. Models are discovered live from the
              provider when you pick a credential in a panel, so there is no model field here.
            </P>
            <Tip>
              If <Kbd>BINNY</Kbd> or <Kbd>Run analysis</Kbd> is greyed out, this is why. Add a key, come back, pick it in the
              Credential dropdown of the panel.
            </Tip>
            <H2>Put a ceiling on spend</H2>
            <P>
              <Kbd>Settings</Kbd> then <Kbd>Usage</Kbd> has a daily and a monthly token cap, enforced on the server. Leave
              them blank for no limit. See <L ctx={ctx} to="/docs/account/usage">usage and caps</L>.
            </P>
          </>
        ),
      },
      {
        slug: 'first-project',
        title: 'Your first project',
        summary: 'Install the CLI, sign in once, decompile a file. The CLI prints a project URL when it is done.',
        keywords: ['first', 'getting started', 'quick start', 'decompile', 'upload', 'docker'],
        image: { key: 'cli-decompile', alt: 'The CLI finishing a decompile and printing a project URL' },
        body: (ctx) => (
          <>
            <Note title="Docker first">
              Decompiling runs on your machine, in a Docker container the CLI manages. Docker Desktop (with
              the WSL 2 backend on Windows) or Docker Engine must be installed and running before step 3.
            </Note>
            <Clicks
              items={[
                <>
                  Install the CLI. macOS and Linux:
                  <Cmd>{`curl -fsSL ${ctx.installScriptUrl('install.sh')} | sh`}</Cmd>
                  Windows, in PowerShell:
                  <Cmd prompt="PS>">{`irm ${ctx.installScriptUrl('install.ps1')} | iex`}</Cmd>
                  Open a new terminal afterwards so the PATH change is picked up.
                </>,
                <>
                  Sign in once. It prints a URL and a code; open the URL, confirm the code, done.
                  <Cmd>openbin login</Cmd>
                </>,
                isApk(ctx) ? (
                  <>
                    Decompile an APK or XAPK. The first run downloads the JADX worker image once.
                    <Cmd>openbin apk ./app.apk</Cmd>
                  </>
                ) : (
                  <>
                    Decompile a binary. The first run downloads the Ghidra worker image once.
                    <Cmd>openbin decompile ./sample.elf</Cmd>
                  </>
                ),
                <>
                  Wait for <Code>Done! https://{isApk(ctx) ? 'openapk.ai' : 'app.openbin.ai'}/projects/...</Code> and open that URL.
                  That is your project.
                </>,
              ]}
            />
            <P>
              {isApk(ctx)
                ? 'Only the APK and its decompiled tree are uploaded. If the app ships native libraries, the CLI says so and the project gets a Native tab where each .so can be decompiled with Ghidra.'
                : 'Your binary is never uploaded. Only the decompiled JSON leaves your machine. If a public analysis of the same file already exists, the CLI offers to fork it instead of decompiling again.'}
            </P>
            <H2>Then</H2>
            <Bullets
              items={[
                <>Open the <Kbd>{isApk(ctx) ? 'Analysis' : 'AI Analysis'}</Kbd> tab on the right and click <Kbd>Run {isApk(ctx) ? 'Analysis' : 'analysis'}</Kbd> for a first pass: summary, hotspots, IoCs, next steps.</>,
                <>Open the <Kbd>BINNY</Kbd> tab and ask what a {isApk(ctx) ? 'file' : 'function'} does.</>,
                <>Read <L ctx={ctx} to="/docs/workspace/navigating-code">navigating code</L> for the rest of the workspace.</>,
              ]}
            />
          </>
        ),
      },
    ],
  },

  // -------------------------------------------------------------------- cli
  {
    id: 'cli',
    title: 'The CLI',
    pages: [
      {
        slug: 'install',
        title: 'Install and update',
        summary: 'One command per platform. The binary goes in your user directory, no sudo.',
        keywords: ['install', 'cli', 'windows', 'macos', 'linux', 'path', 'update', 'docker'],
        body: (ctx) => (
          <>
            <H2>macOS and Linux</H2>
            <Cmd>{`curl -fsSL ${ctx.installScriptUrl('install.sh')} | sh`}</Cmd>
            <P>
              Detects your OS and CPU (amd64 or arm64), downloads the matching release from GitHub, installs
              to <Code>~/.local/bin/openbin</Code>, and adds that directory to your PATH in <Code>~/.profile</Code> and in
              an existing <Code>~/.bashrc</Code> or <Code>~/.zshrc</Code>. Needs <Code>curl</Code> and <Code>tar</Code>. Override the
              target with <Code>OPENBIN_INSTALL_DIR</Code>.
            </P>
            <H2>Windows</H2>
            <Cmd prompt="PS>">{`irm ${ctx.installScriptUrl('install.ps1')} | iex`}</Cmd>
            <P>
              Installs <Code>openbin.exe</Code> to <Code>%LOCALAPPDATA%\Programs\openbin</Code> and adds it to your user PATH.
              ARM64 machines get the amd64 build under emulation. Docker Desktop with the WSL 2 backend must
              be installed and running.
            </P>
            <H2>Docker</H2>
            <P>
              The CLI runs Ghidra and JADX inside a container it manages. It does not pull from a registry: on first
              use it downloads a worker image tarball from the latest release into <Code>~/.local/share/openbin/</Code> and
              loads it with <Code>docker load</Code>. You see <Code>Loading worker image (first run only)...</Code> once.
              Images are about 700 MB for native binaries and 350 MB for APKs.
            </P>
            <Table
              head={['Message', 'What to do']}
              rows={[
                ['Docker is required to run the local analysis worker', 'Install Docker Desktop (macOS, Windows) or Docker Engine (Linux).'],
                ['Docker is installed but its daemon isn’t responding', 'Start Docker Desktop. On Linux: sudo systemctl start docker, and make sure your user is in the docker group.'],
              ]}
            />
            <H2>Update</H2>
            <Cmd>openbin update</Cmd>
            <P>
              Replaces the binary in place with the latest release and tells you the version. Worker images update
              separately, on the next decompile. The CLI also prints a one-line notice after a run when a newer
              version exists. <Code>openbin --version</Code> prints what you have.
            </P>
          </>
        ),
      },
      {
        slug: 'login',
        title: 'Sign in from the terminal',
        summary: 'openbin login opens a browser flow and saves a token locally. Self-hosted installs point the CLI at their own server.',
        keywords: ['login', 'whoami', 'device code', 'self-hosted', 'server', 'credentials', 'config'],
        body: () => (
          <>
            <Cmd>openbin login</Cmd>
            <Pre>{`Open this URL in your browser:
  https://auth.openapk.ai/...
And confirm this code:
  ABCD-EFGH
Waiting for confirmation...
Logged in. Credentials saved to ~/.config/openbin/credentials.json`}</Pre>
            <P>
              The token file is mode 0600 under <Code>~/.config/openbin/</Code> (or <Code>$XDG_CONFIG_HOME/openbin/</Code>).
              BINNY in the terminal reuses this sign-in. <Code>openbin whoami</Code> prints the signed-in identity as JSON.
            </P>
            <H2>Self-hosted servers</H2>
            <Cmd>openbin login --server https://api.re.example.com</Cmd>
            <P>
              Fetches the server’s public config (auth URL, web hosts, where worker images come from), saves it to{' '}
              <Code>~/.config/openbin/server.json</Code>, and uses it for every later command. Go back to the hosted service with:
            </P>
            <Cmd>openbin login --reset-server</Cmd>
            <P>
              The environment variables <Code>OPENBIN_API_URL</Code>, <Code>OPENBIN_AUTH_URL</Code> and <Code>OPENBIN_RELEASE_BASE</Code> override
              the saved server for one shell.
            </P>
          </>
        ),
      },
      {
        slug: 'decompile',
        title: 'openbin decompile',
        summary: 'Native binaries: ELF, PE, Mach-O and raw firmware. One file, several files, or a whole directory.',
        apps: ['openbin'],
        keywords: ['decompile', 'ghidra', 'elf', 'pe', 'mach-o', 'firmware', 'processor', 'bundle', 'dedup', 'fork', 'timeout'],
        body: (ctx) => (
          <>
            <Cmd>openbin decompile ./sample.elf</Cmd>
            <Pre>{`Hashing...
Decompiling sample.elf (2.1 MB, sha256=3f9c1a2b7d4e) locally...
Local decompile finished in 1m12s. Uploading...
Done! https://app.openbin.ai/projects/8b1e...`}</Pre>
            <P>
              Ghidra runs in the local Docker worker. Only the decompiled JSON is uploaded. The binary stays on your disk.
            </P>
            <H2>Already analyzed by someone?</H2>
            <P>
              Before decompiling, the CLI checks whether a public analysis of the same SHA-256 exists. If so it lists the
              matches with owner and upvotes and asks <Code>Fork the top match (#1) instead of decompiling? [Y/n]</Code>.
              Enter accepts. A fork gives you the same analysis in your own editable project in seconds. See{' '}
              <L ctx={ctx} to="/docs/community/publish-and-fork">publish and fork</L>.
            </P>
            <H2>Flags</H2>
            <Table
              head={['Flag', 'What it does']}
              rows={[
                [<Code>--processor ID</Code>, 'Force a Ghidra language, for example ARM:LE:32:v7 or MIPS:BE:32:default. Required for raw firmware Ghidra cannot autodetect. Headerless files also get the raw-binary loader.'],
                [<Code>--arch LABEL</Code>, 'A label stored in project metadata (auto, x86_64, x86, arm64, arm). It does not change how Ghidra decompiles.'],
                [<Code>--name NAME</Code>, 'Project display name. Single file only.'],
                [<Code>--fork</Code>, 'If a public analysis exists, fork it without asking.'],
                [<Code>--no-dedup</Code>, 'Skip the hash check and always decompile locally.'],
                [<Code>--timeout SEC</Code>, 'Hard cap for the whole decompile. Default 1500 seconds. Raise it for very large binaries.'],
                [<Code>--analysis-timeout SEC</Code>, 'Cap for Ghidra’s auto-analysis phase. Default 1200. Must be lower than --timeout.'],
                [<Code>--bundle NAME</Code>, 'Group the results into a bundle, created if missing.'],
                [<Code>--project UUID</Code>, 'Upload as an additional sample of an existing project. --name sets the sample label. One file only, not with --bundle.'],
                [<Code>--image IMAGE</Code>, 'Use a different ghidra-worker image. OPENBIN_GHIDRA_IMAGE works too.'],
              ]}
            />
            <H2>Several files at once</H2>
            <Cmd>openbin decompile ./firmware-dump/</Cmd>
            <P>
              A directory is swept recursively for ELF, PE and Mach-O files, up to 100, and the results land in a
              bundle. Bundle runs skip the dedup prompt. The CLI prints one line per file and then{' '}
              <Code>View bundle: https://app.openbin.ai/bundles/...</Code>. See{' '}
              <L ctx={ctx} to="/docs/workspace/samples-and-bundles">samples and bundles</L> for the difference between a bundle and a multi-sample project.
            </P>
            <Tip>
              Not sure about the architecture of a raw image? Run <Code>openbin tui</Code>. The wizard runs firmware detection
              (uImage, embedded ELF, opcode signatures, binwalk if installed) before it asks.
            </Tip>
          </>
        ),
      },
      {
        slug: 'apk',
        title: 'openbin apk and attach-native',
        summary: 'Android APKs and XAPKs through JADX, and native libraries inside them through Ghidra.',
        keywords: ['apk', 'xapk', 'jadx', 'android', 'native', '.so', 'attach-native', 'split'],
        body: (ctx) => (
          <>
            <Cmd>openbin apk ./app.apk</Cmd>
            <Pre>{`Decompiling app.apk (14.2 MB) locally with JADX...
Local decompile finished in 48s. Uploading...
Done! https://openapk.ai/projects/5c7a...
This app ships 3 native libraries — open the project's Native tab to decompile them with Ghidra.`}</Pre>
            <P>
              <Code>.xapk</Code> and <Code>.apks</Code> split containers are merged into one project. The APK and the decompiled tree
              are both uploaded, which is what makes the in-browser source tree, search and BINNY work. The only flag is{' '}
              <Code>--image</Code> (or <Code>OPENAPK_JADX_IMAGE</Code>) to use a different jadx-worker image.
            </P>
            <H2>Native libraries</H2>
            <P>
              Cloud Ghidra is off, so <Code>.so</Code> files are decompiled on your machine too. In the project’s{' '}
              <Kbd>Native</Kbd> tab, click <Kbd>Decompile via CLI</Kbd> on a library. The modal gives you three steps: download
              the <Code>.so</Code>, run the command it shows, wait. The command looks like:
            </P>
            <Cmd>openbin attach-native ./libnative.so --project 5c7a... --lib-path resources/lib/arm64-v8a/libnative.so</Cmd>
            <P>
              <Code>--project</Code> and <Code>--lib-path</Code> are required; the lib path must match the location inside the APK.
              When it finishes, the Native tab shows functions, strings, imports and metadata for that library, with the
              same split view and cross-highlighting as a native project.
              {isApk(ctx) ? '' : ' Open the project on openapk.ai to see it.'}
            </P>
          </>
        ),
      },
      {
        slug: 'tui',
        title: 'The interactive wizard',
        summary: 'openbin tui walks you through file, architecture and target project. Useful for firmware and multi-sample work.',
        apps: ['openbin'],
        keywords: ['tui', 'wizard', 'interactive', 'firmware', 'arch', 'sample'],
        body: () => (
          <>
            <Cmd>openbin tui</Cmd>
            <P>Also <Code>openbin --tui</Code>, or <Code>openbin tui ./file.bin</Code> to skip the first step.</P>
            <Clicks
              items={[
                <>Pick a binary from the current directory, or type a path.</>,
                <>Pick the architecture: autodetect, or force a Ghidra processor. Raw images run firmware detection first.</>,
                <>Pick a target: a new project, or add the result as a sample to an existing multi-sample project.</>,
              ]}
            />
            <P>It ends with the same <Code>Done! https://...</Code> line as <Code>openbin decompile</Code>, or <Code>Cancelled — nothing decompiled.</Code></P>
          </>
        ),
      },
    ],
  },

  // -------------------------------------------------------------- workspace
  {
    id: 'workspace',
    title: 'The workspace',
    pages: [
      {
        slug: 'navigating-code',
        title: 'Navigating code',
        summary: 'Three columns: what to open on the left, the code in the middle, the inspector on the right.',
        keywords: ['navigate', 'functions', 'files', 'pseudocode', 'disassembly', 'split', 'jump', 'back', 'forward', 'tabs', 'cross-highlight'],
        image: { key: 'ask-ai', alt: 'The project workspace with the function list, decompiled code and the inspector' },
        body: (ctx) =>
          isApk(ctx) ? (
            <>
              <H2>Left: files, search, symbols</H2>
              <Bullets
                items={[
                  <>The source tree is the decompiled app: Java and Kotlin, smali, resources, the manifest. Click a file to open it in a tab.</>,
                  <>When the project opens, the whole tree is downloaded to your browser (<Code>⚡ local mode</Code>). After that, opening files and searching do not touch the server.</>,
                  <>Search <Kbd>Search files…</Kbd> with toggles <Kbd>Aa</Kbd> (case), <Kbd>.*</Kbd> (regex) and <Kbd>SDKs</Kbd> (include SDK packages). Results are grouped by file; click to jump to the line.</>,
                  <>Symbols: <Kbd>Cmd/Ctrl-click</Kbd> a name to go to its definition, <Kbd>right-click</Kbd> for usages. The panel lists <Kbd>Definitions</Kbd> and <Kbd>Usages</Kbd> and has <Kbd>include SDKs</Kbd>. The <Kbd>▶</Kbd> on a method starts a call chain.</>,
                ]}
              />
              <H2>Middle: the editor</H2>
              <Bullets
                items={[
                  <>Files open in tabs. <Kbd>×</Kbd> or middle-click closes one. Open tabs are remembered per project in this browser.</>,
                  <>Jumps flash the target line so you can find it after the scroll.</>,
                  <>Very large files are cut and marked <Code>truncated</Code>.</>,
                  <>The header has <Kbd>✨ Suggest renames</Kbd> (editors) and the two screenshot buttons <Kbd>📷</Kbd> and <Kbd>📸</Kbd>.</>,
                  <><Code>.so</Code> files open the native viewer instead. See <L ctx={ctx} to="/docs/workspace/native-libraries">native libraries</L>.</>,
                ]}
              />
              <H2>Right: the AI panel</H2>
              <P>
                A Credential and Model row sits above the tabs and applies to all of them. Tabs: <Kbd>Analysis</Kbd>,{' '}
                <Kbd>BINNY</Kbd>, <Kbd>Report</Kbd>, <Kbd>Gallery</Kbd>, <Kbd>Highlights</Kbd>, <Kbd>Renames</Kbd>, <Kbd>Crypto</Kbd>,{' '}
                <Kbd>Call chain</Kbd>, <Kbd>Network</Kbd>, <Kbd>DBs</Kbd>, <Kbd>Entry points</Kbd>, <Kbd>Native</Kbd>, <Kbd>Chat</Kbd>, <Kbd>Tools</Kbd>.
                Each has its own page in this section.
              </P>
              <H2>Header</H2>
              <P>
                Rename the project with <Kbd>✎</Kbd> (editors). Switch the analysis mode between <Kbd>MAR · Malware</Kbd> and{' '}
                <Kbd>VRR · Vuln Research</Kbd>; it changes the analysis prompt and the default report sections. Set the workflow
                state. Owners see the visibility toggle and <Kbd>Share</Kbd>. <Kbd>Report ↗</Kbd> opens the full report page.
              </P>
            </>
          ) : (
            <>
              <H2>Left: symbols</H2>
              <P>Tabs with counts. The rail collapses to <Kbd>Symbols</Kbd> when you want the width back.</P>
              <Table
                head={['Tab', 'What is in it']}
                rows={[
                  ['Funcs', 'Every function, with a filter box. Tags: ext (external), thunk, stub.'],
                  ['Entry', 'Entry points.'],
                  ['Exports', 'Exported symbols.'],
                  ['TLS', 'Thread-local storage callbacks.'],
                  ['Data', 'Data symbols, with a detail view.'],
                  ['Secs', 'Memory sections. Clicking one opens it in the full listing.'],
                ]}
              />
              <P><Kbd>Call Graph ↗</Kbd> at the top opens the graph page for the current function in a new tab.</P>
              <H2>Middle: the code</H2>
              <Bullets
                items={[
                  <><Kbd>Pseudocode</Kbd>, <Kbd>Disassembly</Kbd> and <Kbd>✨ Deobf</Kbd> views. Disassembly is disabled for externals and thunks.</>,
                  <><Kbd>⇆ Split</Kbd> shows pseudocode and disassembly side by side. The choice is remembered.</>,
                  <>Cross-highlight: click a variable to light it up in both panes with its instructions; click a disassembly row to light up its C line; click a C line to light up its instructions. <Kbd>Esc</Kbd> clears. Older analyses without a line map do not have this.</>,
                  <>Underlined function names, <Code>DAT_</Code> symbols and hex addresses are links. Click to jump.</>,
                  <><Kbd>←</Kbd> and <Kbd>→</Kbd>, or <Kbd>Alt+←</Kbd> and <Kbd>Alt+→</Kbd>, move through your jump history.</>,
                  <><Kbd>☰ Listing</Kbd> swaps the pane for the full program listing with a <Kbd>Jump to section…</Kbd> dropdown and an address box.</>,
                  <>Rename the function with <Kbd>Rename</Kbd> next to its name; double-click a variable to rename it. See <L ctx={ctx} to="/docs/workspace/renames-and-deobfuscation">renames and deobfuscation</L>.</>,
                ]}
              />
              <H2>Right: the inspector</H2>
              <P>
                Tabs: <Kbd>AI Analysis</Kbd>, <Kbd>Xrefs</Kbd>, <Kbd>Chain</Kbd>, <Kbd>Network</Kbd>, <Kbd>BINNY</Kbd>, <Kbd>Crypto</Kbd>,{' '}
                <Kbd>Renames</Kbd>, <Kbd>Report</Kbd>, <Kbd>Gallery</Kbd>, <Kbd>Highlights</Kbd>, <Kbd>Strings</Kbd>, <Kbd>Imports</Kbd>,{' '}
                <Kbd>Chat</Kbd>, <Kbd>Tools</Kbd>. Drag the edge to resize. Each has its own page in this section.
              </P>
              <H2>Header</H2>
              <P>
                <Kbd>← Project</Kbd> goes to the project overview. Badges show the active sample, your role, and fork status.
                Editors get <Kbd>＋ Sample</Kbd>; everyone gets the screenshot buttons <Kbd>📷</Kbd> and <Kbd>📸</Kbd>; owners get the
                visibility toggle and <Kbd>Share</Kbd>. <Kbd>Report ↗</Kbd> opens the full report page.
              </P>
            </>
          ),
      },
      {
        slug: 'ai-analysis',
        title: 'The first-pass analysis',
        summary: 'One click gives you a summary, hotspots, indicators and next steps, cached on the project.',
        keywords: ['analysis', 'run analysis', 'hotspots', 'ioc', 'summary', 'mar', 'vrr', 'malware', 'vulnerability'],
        image: { key: 'ai-analysis', alt: 'The analysis tab with summary, hotspots and IoCs' },
        body: (ctx) => (
          <>
            <Clicks
              items={[
                <>Open <Kbd>{isApk(ctx) ? 'Analysis' : 'AI Analysis'}</Kbd> on the right.</>,
                <>Pick a mode: <Kbd>{isApk(ctx) ? 'Malware Analysis' : 'Malware analysis'}</Kbd> or <Kbd>{isApk(ctx) ? 'Vulnerability Research' : 'Vulnerability research'}</Kbd>. It changes the questions the model is asked and the report template that fits.</>,
                <>Pick a Credential and a Model.</>,
                <>Click <Kbd>Run {isApk(ctx) ? 'Analysis' : 'analysis'}</Kbd>. Editors only. The result is stored on the project for everyone with access.</>,
              ]}
            />
            <H2>What comes back</H2>
            <Bullets
              items={[
                <><strong>Summary</strong>, with the model that wrote it{isApk(ctx) ? ' and the cost' : ''}.</>,
                <><strong>Hotspots</strong>: the {isApk(ctx) ? 'files' : 'functions'} worth reading first, with a severity. Click one to open it.</>,
                <><strong>IoCs</strong>: URLs, hosts, paths, keys the model spotted.</>,
                <><strong>Next steps</strong>: what to look at after this.</>,
                <>Token counts, so you know what the call cost you.</>,
              ]}
            />
            <P>
              Report sections such as Static Analysis Findings and Indicators of Compromise can pull from this result with
              their <Kbd>Pull from analysis</Kbd> button. See <L ctx={ctx} to="/docs/reports/editor">the report editor</L>.
            </P>
            <Note>
              This is a static read of the decompiled output by a model. Treat it as a starting list, not a verdict. The
              workspace exists so you can check each claim against the code.
            </Note>
          </>
        ),
      },
      {
        slug: 'symbols-strings-data',
        title: 'Xrefs, strings, imports and data',
        summary: 'Who calls what, which strings and imports exist, and the raw data behind a symbol.',
        apps: ['openbin'],
        keywords: ['xrefs', 'callers', 'callees', 'strings', 'imports', 'data', 'sections', 'listing'],
        body: () => (
          <>
            <H2>Xrefs</H2>
            <P>
              The <Kbd>Xrefs</Kbd> tab lists <Kbd>Called by</Kbd> and <Kbd>Calls</Kbd> for the open function. Click a caller to land on
              the exact call site.
            </P>
            <H2>Strings and imports</H2>
            <P>
              <Kbd>Strings</Kbd> is the full string table with a filter box. <Kbd>Imports</Kbd> is the import list. Both are read-only
              lists; use <Kbd>Tools</Kbd> to decode anything that looks encoded, and the <Kbd>Network</Kbd> tab for URLs and IPs
              pulled out of the strings with the call sites that use them.
            </P>
            <H2>Data and sections</H2>
            <P>
              <Kbd>Data</Kbd> on the left lists data symbols; clicking one shows its bytes. <Kbd>Secs</Kbd> lists memory sections and
              opens the chosen one in the program listing. From the code pane, <Kbd>☰ Listing</Kbd> opens the same listing at
              the current function; type an address like <Code>0x401000</Code> and <Kbd>Go</Kbd> to move around.
            </P>
          </>
        ),
      },
      {
        slug: 'call-graph-and-hotspots',
        title: 'Call chains and the call graph',
        summary: 'Walk callers and callees from any function, narrate a chain, or open the full graph.',
        apps: ['openbin'],
        keywords: ['call graph', 'call chain', 'callers', 'callees', 'graph', 'narrate'],
        image: { key: 'graph', alt: 'The call graph page with a root function and its callers and callees' },
        body: () => (
          <>
            <H2>Chain tab</H2>
            <P>
              <Kbd>Chain</Kbd> shows the current function as <Kbd>Root</Kbd> with <Kbd>Callers</Kbd> above and <Kbd>Callees</Kbd> below,
              one to five levels deep. <Kbd>✨ Narrate with AI</Kbd> asks your model to explain the chain in prose; the text stays
              in this browser. <Kbd>＋ Report</Kbd> appends the chain as a Markdown section to the project report.
            </P>
            <H2>Call graph page</H2>
            <P>
              <Kbd>Call Graph ↗</Kbd> opens a full-screen graph. Pick the <Kbd>Root</Kbd>, set <Kbd>Callee depth</Kbd> and{' '}
              <Kbd>Caller depth</Kbd>, toggle <Kbd>Show externals</Kbd> and <Kbd>Show thunks</Kbd>, flip the <Kbd>Direction</Kbd>.
              Click a node for its details and <Kbd>Recenter here</Kbd>. <Kbd>← Code</Kbd> takes you back.
            </P>
          </>
        ),
      },
      {
        slug: 'highlights',
        title: 'Highlights',
        summary: 'The project’s pinboard: functions, files or screenshots that matter, with a tag and a note, in your order.',
        keywords: ['highlights', 'pin', 'bookmark', 'tag', 'note', 'board'],
        body: (ctx) => (
          <>
            <P>
              Highlights are how a project remembers what you found. Each is a card with a type, an optional tag and note, an
              optional screenshot, and the author. They show in the <Kbd>Highlights</Kbd> tab and on the public project page.
            </P>
            <H2>Three ways to add one</H2>
            <Clicks
              items={[
                <>After every screenshot, the <Kbd>Add to Highlights?</Kbd> prompt offers to pin it, anchored to the open {isApk(ctx) ? 'file' : 'function'}. <Kbd>Add to Highlights</Kbd> or <Kbd>Skip</Kbd>.</>,
                <><Kbd>+ Add</Kbd> on the board (editors). Choose <Kbd>ƒ Function</Kbd>, <Kbd>📄 File</Kbd> or <Kbd>🖼 Visual</Kbd>, give it a target, a tag of up to 48 characters, a note, and <Kbd>Add highlight</Kbd>.</>,
                <>Ask BINNY to highlight something. It uses the same card and shows a <Kbd>Highlights</Kbd> link on its tool card.</>,
              ]}
            />
            <H2>On the board</H2>
            <Bullets
              items={[
                <>Filter chips: <Kbd>All</Kbd> plus one per tag.</>,
                <><Kbd>↑</Kbd> and <Kbd>↓</Kbd> reorder (not while a filter is on). <Kbd>✎</Kbd> edits tag and note, and can add, replace or remove the screenshot. <Kbd>✕</Kbd> removes the card; the screenshot stays in the Gallery.</>,
                <>Click an anchored card to jump to its {isApk(ctx) ? 'file' : 'function'}.</>,
              ]}
            />
            <Tip>Use tags as your working categories: c2, persistence, crypto, todo. The chips then become a filter over your own notes.</Tip>
          </>
        ),
      },
      {
        slug: 'screenshots-and-gallery',
        title: 'Screenshots and the gallery',
        summary: 'Capture a region of the screen, annotate it, keep it on the project, drop it into a report section.',
        keywords: ['screenshot', 'capture', 'annotate', 'gallery', 'evidence', 'image', 'paste'],
        image: { key: 'screenshot-annotate', alt: 'Annotating a captured screenshot with a rectangle and an arrow' },
        body: () => (
          <>
            <H2>Capture</H2>
            <Bullets
              items={[
                <><Kbd>📸</Kbd> captures a region of the screen through the browser’s screen picker. Panels marked as chrome hide themselves during the grab. Drag on the image to crop, then <Kbd>Confirm crop</Kbd> or <Kbd>Use full image</Kbd>.</>,
                <><Kbd>📷</Kbd> takes an image you already have: paste with <Kbd>Ctrl/Cmd + V</Kbd>, drop a file, <Kbd>📋 Paste from clipboard</Kbd> or <Kbd>📁 Browse…</Kbd>.</>,
              ]}
            />
            <H2>Annotate</H2>
            <P>
              Tools: <Kbd>▭ Rect</Kbd>, <Kbd>↗ Arrow</Kbd>, <Kbd>T Text</Kbd>, <Kbd>✎ Free</Kbd>, with colour swatches, <Kbd>Undo</Kbd> and{' '}
              <Kbd>Clear</Kbd>. <Kbd>Save &amp; Insert</Kbd> stores the image on the project, switches to the Gallery, and offers to add a highlight.
            </P>
            <H2>Gallery</H2>
            <P>
              The <Kbd>Gallery</Kbd> tab is a thumbnail grid. Click to view full size, <Kbd>Esc</Kbd> to close, <Kbd>✕</Kbd> to delete.
              Deleting breaks the image in any report section that references it, and the confirm says so.
            </P>
            <H2>Into the report</H2>
            <P>
              Every report section has <Kbd>🖼 Insert</Kbd>. It opens <Kbd>Pick a screenshot</Kbd>, you choose one, <Kbd>Insert this
              screenshot</Kbd>, and a Markdown image lands at the cursor. Exports inline the image bytes, so the .md stands alone.
            </P>
          </>
        ),
      },
      {
        slug: 'renames-and-deobfuscation',
        title: 'Renames and deobfuscation',
        summary: 'Rename functions and variables by hand, accept suggested names from the model, or generate a cleaned-up view of a function.',
        apps: ['openbin'],
        keywords: ['rename', 'variable', 'deobfuscate', 'deobf', 'suggest names', 'cleanup'],
        body: () => (
          <>
            <H2>By hand</H2>
            <Bullets
              items={[
                <><Kbd>Rename</Kbd> next to the function name opens an inline editor. <Kbd>Save</Kbd>, <Kbd>Cancel</Kbd>, or <Kbd>Esc</Kbd>. Function renames apply project-wide: every call site shows the new name.</>,
                <>Double-click a variable in the pseudocode to rename it. Variable renames affect only that function.</>,
                <>Renames are a display layer over the analysis. The decompiled output underneath is unchanged, and forks start with none.</>,
              ]}
            />
            <H2>Suggested by the model</H2>
            <P>
              In the <Kbd>Renames</Kbd> tab, <Kbd>✨ Suggest for &lt;function&gt;</Kbd> (editors) asks your model for names with reasons.
              Tick the ones you want, <Kbd>Apply selected</Kbd>. <Kbd>Active</Kbd> lists what is applied; <Kbd>✕</Kbd> reverts one.
            </P>
            <H2>Deobfuscated view</H2>
            <P>
              The <Kbd>✨ Deobf</Kbd> view in the code pane holds a cleaned version of the current function written by your model.
              <Kbd>Estimate</Kbd> shows the input tokens first; <Kbd>✨ Generate deobfuscation</Kbd> runs it (editors). The result is
              cached on the project with a verdict chip, <Kbd>✨ cleaned</Kbd> or <Kbd>○ unchanged</Kbd>, and can be regenerated or deleted.
            </P>
          </>
        ),
      },
      {
        slug: 'crypto-and-network',
        title: 'Crypto, network and string tools',
        summary: 'Generate a decryptor for a routine, see every URL and IP with its call site, decode strings in place.',
        apps: ['openbin'],
        keywords: ['crypto', 'decryptor', 'network', 'url', 'ip', 'string tools', 'base64', 'hex', 'rot13'],
        body: () => (
          <>
            <H2>Crypto</H2>
            <P>
              With a function open, <Kbd>🔓 Generate decryptor</Kbd> in the <Kbd>Crypto</Kbd> tab asks your model to identify the
              algorithm and write a Python script that reverses it. You get <Kbd>Algorithm</Kbd>, <Kbd>Explanation</Kbd> and the script
              with <Kbd>Copy</Kbd>. Results are kept in this browser for the project. Read the script before you run it.
            </P>
            <H2>Network</H2>
            <P>
              <Kbd>Network</Kbd> is computed in your browser from the analysis: <Kbd>URLs</Kbd>, <Kbd>IP addresses</Kbd>,{' '}
              <Kbd>Networking imports</Kbd> and <Kbd>Call sites</Kbd>. Click a call site to land on its pseudocode line or
              disassembly address.
            </P>
            <H2>String tools</H2>
            <P>
              <Kbd>Tools</Kbd> is one input and every conversion at once: Base64 decode and encode, hex to text and back, hex to
              decimal and back, URL decode and encode, ROT13, reverse, upper and lower case. Each result has a copy action.
              Paste a suspicious string from the Strings tab and read all of them.
            </P>
          </>
        ),
      },
      {
        slug: 'samples-and-bundles',
        title: 'Samples and bundles',
        summary: 'Two ways to keep related binaries together: samples inside one project, or a bundle of separate projects.',
        apps: ['openbin'],
        keywords: ['samples', 'multi-sample', 'bundle', 'dropper', 'payload', 'firmware', 'combine'],
        body: () => (
          <>
            <Table
              head={['', 'Multi-sample project', 'Bundle']}
              rows={[
                ['Use it for', 'A dropper and its payloads, firmware revisions: one story, one report.', 'A sweep of a directory: many unrelated or loosely related files.'],
                ['Report, renames, highlights', 'Live on the primary sample. Attached samples are read-only views.', 'Each binary is its own project with its own report.'],
                ['In the workspace', 'A tab bar above the code switches samples.', 'A bar links the sibling projects and the bundle page.'],
                ['Create', '＋ Sample in the header, or openbin decompile --project', 'openbin decompile --bundle, or a directory'],
              ]}
            />
            <H2>Add a sample</H2>
            <P>
              <Kbd>＋ Sample</Kbd> (editors) opens <Kbd>Add a sample to &lt;project&gt;</Kbd> with two tabs. <Kbd>Move from my projects</Kbd> picks
              one of your other BIN projects and moves it in; its own project page goes away. <Kbd>Decompile a new binary</Kbd> shows the
              command to run:
            </P>
            <Cmd>openbin decompile --project &lt;project-id&gt; ./payload.bin</Cmd>
            <P>
              The sample bar above the code lists the primary and every sample. <Kbd>⚙ manage</Kbd> exposes rename and remove. On the
              Projects page, <Kbd>Combine into one project</Kbd> merges existing projects the same way.
            </P>
            <H2>Bundles</H2>
            <Cmd>openbin decompile --bundle "router-fw-2.4" ./bins/</Cmd>
            <P>
              The bundle page lists every file with format, architecture, size and status, and can be renamed or deleted. Add more
              later with the same <Code>--bundle</Code> name.
            </P>
          </>
        ),
      },
      {
        slug: 'identifiers-and-crypto',
        title: 'Identifier recovery and crypto',
        summary: 'Turn a, b, c back into names, and turn an obfuscator into a decoder script.',
        apps: ['openapk'],
        keywords: ['rename', 'identifiers', 'proguard', 'obfuscation', 'crypto', 'decoder', 'cyberchef', 'xor', 'base64', 'ciphertext'],
        image: { key: 'crypto', alt: 'The Crypto tab with a detected routine and its generated decoder' },
        body: () => (
          <>
            <H2>Suggest renames</H2>
            <Clicks
              items={[
                <>Open an obfuscated file and click <Kbd>✨ Suggest renames</Kbd> in the editor header (editors). Files over 1,500 lines ask you to confirm.</>,
                <>In the <Kbd>Renames</Kbd> tab, read the proposals and their reasons under <Kbd>Suggested</Kbd>. Tick what you agree with and <Kbd>Apply selected</Kbd>.</>,
                <>Applied renames show under <Kbd>Active</Kbd>. Each can be reverted. They apply project-wide with word-boundary safety.</>,
              ]}
            />
            <P>There is no manual rename in OpenAPK; names come from suggestions you accept.</P>
            <H2>Crypto</H2>
            <P>
              The <Kbd>Crypto</Kbd> tab scans for <Code>javax.crypto</Code> pipelines, hand-rolled XOR and Base64 obfuscators and custom
              decoder shapes. <Kbd>SDKs</Kbd> includes SDK packages; <Kbd>↻ Rescan</Kbd> runs it again. On a hit, <Kbd>✨ Generate</Kbd> (editors)
              produces an explanation, the class and methods involved, a runnable Python decoder, and when the algorithm maps
              cleanly, a <Kbd>↗ CyberChef</Kbd> recipe link.
            </P>
            <P>
              After a decoder exists, every ciphertext literal that flows into the routine’s entry methods is harvested, deduplicated,
              and decoded in the script output. The tab shows how many and previews them.
            </P>
          </>
        ),
      },
      {
        slug: 'apk-panels',
        title: 'Call chains, network, databases, entry points',
        summary: 'The structural panels: how code connects, where it talks, what it stores, what the manifest exposes.',
        apps: ['openapk'],
        keywords: ['call chain', 'network', 'retrofit', 'okhttp', 'database', 'schema', 'entry points', 'manifest', 'exported', 'activities', 'services'],
        image: { key: 'call-chain', alt: 'A call chain panel showing callers and callees of a method' },
        body: () => (
          <>
            <H2>Call chain</H2>
            <P>
              Start one with <Kbd>▶</Kbd> on a method in the Symbols panel. The <Kbd>Call chain</Kbd> tab shows <Kbd>ROOT</Kbd>, <Kbd>Callers</Kbd>{' '}
              and <Kbd>Callees</Kbd> to the chosen depth, with an SDK toggle. <Kbd>✨ Narrate with AI</Kbd> explains it; <Kbd>＋ Add to report</Kbd>{' '}
              appends it as a section.
            </P>
            <H2>Network</H2>
            <P>
              <Kbd>Network</Kbd> lists every network call it can find, with a kind filter and SDK toggle. Each shows the URL or{' '}
              <Code>(dynamic)</Code> when it is built at runtime, and jumps to the file and line that makes it.
            </P>
            <H2>DBs</H2>
            <P>Database schemas reconstructed from the code: tables with columns, types and constraints.</P>
            <H2>Entry points</H2>
            <P>
              Read from the manifest: <Kbd>Activities</Kbd>, <Kbd>Services</Kbd>, <Kbd>Receivers</Kbd>, <Kbd>Providers</Kbd>, each tagged exported,
              internal or disabled, with an <Kbd>exported only</Kbd> filter. The exported list is your attack surface.
            </P>
          </>
        ),
      },
      {
        slug: 'native-libraries',
        title: 'Native libraries',
        summary: 'See which .so files the app loads and from where, then decompile each one on your machine.',
        apps: ['openapk'],
        keywords: ['native', '.so', 'jni', 'system.load', 'ghidra', 'attach-native', 'bridge'],
        image: { key: 'native-code', alt: 'A decompiled native library inside an OpenAPK project' },
        body: (ctx) => (
          <>
            <H2>The bridge</H2>
            <P>
              The <Kbd>Native</Kbd> tab lists every <Code>.so</Code> with the call sites that load it, the <Code>native</Code> method declarations
              in Java, and <Code>System.load</Code> calls. <Kbd>Rescan</Kbd> rebuilds it (editors).
            </P>
            <H2>Decompile one</H2>
            <P>
              Open a <Code>.so</Code> from the tree or the bridge and click <Kbd>Decompile via CLI</Kbd>. The modal walks you through it:
              download the library, run the <Code>openbin attach-native</Code> command it shows, wait while the page polls. See{' '}
              <L ctx={ctx} to="/docs/cli/apk">the CLI page</L> for the command.
            </P>
            <P>
              Once analyzed, the viewer has <Kbd>Functions</Kbd>, <Kbd>Strings</Kbd>, <Kbd>Imports</Kbd> and <Kbd>Metadata</Kbd>, with back and
              forward, <Kbd>⇆ Split</Kbd> and the same cross-highlighting as a native project. Function and string lists cap at 5,000 entries.
            </P>
          </>
        ),
      },
      {
        slug: 'string-tools',
        title: 'String tools',
        summary: 'One box, every conversion at once.',
        apps: ['openapk'],
        keywords: ['string tools', 'base64', 'hex', 'rot13', 'url decode'],
        body: () => (
          <P>
            The <Kbd>Tools</Kbd> tab takes text, base64, hex or a number and shows Base64 decode and encode, hex to text and back, hex
            to decimal and back, URL decode and encode, ROT13, reverse, upper and lower case, each with a copy action. Paste a
            string literal from the code and read all of them.
          </P>
        ),
      },
    ],
  },

  // ------------------------------------------------------------------ binny
  {
    id: 'binny',
    title: 'BINNY',
    pages: [
      {
        slug: 'light',
        title: 'BINNY light, in the browser',
        summary: 'Ask about the open code. BINNY reads what it needs, shows every tool call, and on request writes to the project.',
        keywords: ['binny', 'ask ai', 'agent', 'chat', 'tools', 'highlight', 'report section', 'script', 'sessions'],
        image: { key: 'ask-ai', alt: 'The BINNY tab answering a question with tool cards above the answer' },
        body: (ctx) => (
          <>
            <P>
              The <Kbd>BINNY</Kbd> tab is a tool-calling agent that runs on your key. It is the lighter sibling of the terminal BINNY:
              it has no sandbox and never sees the raw sample bytes, only the decompiled output. The intro line in the panel says so.
            </P>
            <H2>Asking</H2>
            <Clicks
              items={[
                <>Open a {isApk(ctx) ? 'file' : 'function'}. BINNY needs one selected before it will send.</>,
                <>Pick a Credential and Model{isApk(ctx) ? ' in the row above the tabs' : ''}.</>,
                <>Choose the mode: <Kbd>{isApk(ctx) ? 'Per-file' : 'Per-function'}</Kbd> keeps one thread per {isApk(ctx) ? 'file' : 'function'}; <Kbd>Shared</Kbd> keeps one thread for the whole project.</>,
                <>Type and press <Kbd>⏎</Kbd>. <Kbd>⇧⏎</Kbd> makes a new line.</>,
              ]}
            />
            <P>
              Each answer shows the model, token counts and an estimated cost, and has <Kbd>Copy markdown</Kbd>. The{' '}
              <Kbd>≡ Sessions</Kbd> drawer lists threads with <Kbd>+ New</Kbd>, rename and delete. Threads live in this browser’s local
              storage, not on the server, so they do not follow you to another machine.
            </P>
            <H2>What it can do</H2>
            <Table
              head={['Tool card', 'What happened']}
              rows={
                isApk(ctx)
                  ? [
                      ['Read file', 'It opened another file in the tree.'],
                      ['Searched code', 'It searched the whole tree for a term.'],
                      ['Pinned highlight', 'It added a card to Highlights (editors only). The card links there.'],
                      ['Wrote report section', 'It wrote or replaced a section of the report (editors only). The report refreshes.'],
                      ['Saved script', 'It saved a script on the project. View, Copy or Download it from the card.'],
                    ]
                  : [
                      ['Read function', 'It fetched another function’s decompilation.'],
                      ['Searched functions', 'It searched function names.'],
                      ['Searched strings', 'It searched the string table.'],
                      ['Pinned highlight', 'It added a card to Highlights (editors only). The card links there.'],
                      ['Wrote report section', 'It wrote or replaced a section of the report (editors only). The report refreshes.'],
                      ['Saved script', 'It saved a script on the project. View, Copy or Download it from the card.'],
                    ]
              }
            />
            <P>
              Every tool call appears as a card above the answer, with its input and a one-line result, so you can see what it
              read before you trust what it wrote. It stops after eight rounds of tools per answer. Write tools only run for
              editors and owners; viewers get read-only answers.
            </P>
            <Tip>
              Ask for actions in plain words: "highlight this and note why", "write the IoC section from what you found",
              "save a script that decodes these strings". Scripts are saved, not run. Read them before running anything.
            </Tip>
            <Warn>
              A model can be steered by text inside the sample. Strings and comments in malware are untrusted input to BINNY
              as much as to you. Check what it pins and writes.
            </Warn>
          </>
        ),
      },
      {
        slug: 'terminal',
        title: 'BINNY in the terminal',
        summary: 'The full harness: it takes a whole project or a file on disk, runs triage, investigate, draft, and leaves you a report to review.',
        keywords: ['binny', 'terminal', 'harness', 'autonomous', 'supervised', 'collaborative', 'investigate', 'sandbox', 'local ghidra', 'resume'],
        body: (ctx) => (
          <>
            <P>
              BINNY is an open source agent harness: it brings the tools, the playbooks, the loop, the budgets and the report format,
              and you bring the model. Source and binaries are at{' '}
              <Ext href="https://github.com/openbin-ai/binny">github.com/openbin-ai/binny</Ext>.
            </P>
            <H2>Install</H2>
            <Cmd>curl -fsSL https://openbin.ai/install-binny.sh | sh</Cmd>
            <Cmd prompt="PS>">irm https://openbin.ai/install-binny.ps1 | iex</Cmd>
            <P>
              It reuses the CLI sign-in, so run <Code>openbin login</Code> once if you have not. Then <Code>binny</Code>. The first run asks
              for a provider and key, or a local server. Docker is needed only for <Code>/decompile</Code> and the sandbox tools.
            </P>
            <H2>What a run looks like</H2>
            <Clicks
              items={[
                <>Pick a project from your {ctx.appName} account, or <Code>/decompile ./file</Code> to run Ghidra locally and keep everything on disk.</>,
                <>Pick a run mode. <strong>Autonomous</strong> goes to a finished draft without stopping. <strong>Supervised</strong> pauses at phase boundaries and whenever BINNY is unsure, and asks you. <strong>Collaborative</strong> adds a short interview before the write-up: audience, depth, framing.</>,
                <>Type what you know as opening intel, or <Code>/investigate</Code>. Triage classifies the sample against the STIX malware vocabulary and picks playbooks; investigation works function by function; synthesis writes the draft.</>,
                <><Code>/draft</Code> to read it, <Code>/findings</Code> for findings, IoCs and coverage, <Code>/save</Code> to push it to the project report as a draft.</>,
              ]}
            />
            <H2>Questions instead of a pipeline</H2>
            <P>
              <Code>/ask</Code> picks up a project at its current state and answers questions with tools: verify a claim in an existing
              report, inspect one function, build a defensive proof of concept such as a config decryptor. An existing report is treated
              as claims to check, not as facts.
            </P>
            <H2>Tools and the sandbox</H2>
            <P>
              Read tools cover metadata, function list, decompiled function, strings, imports, exports, data symbols and raw data, and for
              Android projects file listing and file reads. <Code>/sample ./file</Code> attaches the raw binary and unlocks extraction. The{' '}
              <Code>run</Code> tool executes scripts in a Docker container with no network, a read-only root, a read-only sample mount,
              dropped capabilities and CPU, memory and pid limits. <Code>/workspace</Code> is a persistent directory mounted at{' '}
              <Code>/work</Code>.
            </P>
            <H2>Commands</H2>
            <Table
              head={['Command', 'What it does']}
              rows={[
                [<Code>/investigate</Code>, 'start the loop'],
                [<Code>/ask</Code>, 'Q&A mode on the current project'],
                [<Code>/autonomy &lt;mode&gt;</Code>, 'autonomous, supervised or collaborative'],
                [<Code>/mode malware|vuln</Code>, 'analysis lens: MAR or VRR'],
                [<Code>/continue</Code>, 'resume from a checkpoint or a budget pause'],
                [<Code>/stop</Code>, 'stop investigating and write the draft now'],
                [<Code>/sample &lt;path&gt;</Code>, 'attach the raw binary'],
                [<Code>/decompile &lt;path&gt; [proc]</Code>, 'local Ghidra, kept on disk; proc is a Ghidra ID for raw firmware'],
                [<><Code>/samples</Code>, <Code>/switch</Code></>, 'multi-sample projects'],
                [<><Code>/draft</Code>, <Code>/findings</Code>, <Code>/save</Code></>, 'the report'],
                [<><Code>/model</Code>, <Code>/key</Code>, <Code>/endpoint</Code>, <Code>/models</Code></>, 'providers'],
                [<Code>/budget [n]</Code>, 'per-project token budget'],
                [<><Code>/status</Code>, <Code>/settings</Code>, <Code>/project</Code></>, 'session'],
              ]}
            />
            <P>
              Type <Code>/</Code> for the command palette. Sessions auto-save after every step; reopen a project marked resumable and it
              continues where it stopped.
            </P>
          </>
        ),
      },
      {
        slug: 'local-models',
        title: 'Local models with Ollama or LM Studio',
        summary: 'The terminal BINNY runs on a model on your own machine. No key, nothing leaves the box.',
        keywords: ['ollama', 'lm studio', 'local', 'llama.cpp', 'vllm', 'qwen', 'gpt-oss', 'offline', 'context'],
        body: () => (
          <>
            <Clicks
              items={[
                <>Start Ollama with a bigger context window than its default. The default is 4k tokens, which cannot hold decompiled code.
                  <Cmd>OLLAMA_CONTEXT_LENGTH=32768 ollama serve</Cmd></>,
                <>Pull a model that can call tools. BINNY works entirely through tool calls, so a model without tool support fails outright.
                  <Cmd>ollama pull qwen3:14b</Cmd>
                  qwen3, gpt-oss, llama3.1 and newer, mistral-nemo and devstral work. Most small instruct models do not.</>,
                <>Run <Code>binny</Code>, pick <Code>ollama</Code> in setup (or <Code>/model ollama</Code>), and pick the model from the live list. No key is asked for.</>,
              ]}
            />
            <P>
              LM Studio works the same way as <Code>lmstudio</Code>. llama.cpp’s <Code>llama-server</Code> and vLLM speak the same API:
              point the preset at them with <Code>/endpoint ollama http://localhost:8080/v1</Code>. BINNY compacts its history earlier for
              local providers so the tool list is never pushed out of the window.
            </P>
            <Note title="Web vs terminal">
              This is terminal only. The in-browser BINNY light runs on the server and cannot reach a model on your laptop. Self-hosted
              installs can point the OpenAI-compatible provider at an internal server instead.
            </Note>
            <P>Expect report quality well below a frontier model on anything deep. For triage and questions it holds up.</P>
          </>
        ),
      },
      {
        slug: 'providers',
        title: 'Providers, keys and cost',
        summary: 'Which models work where, what you pay, and how to keep it under control.',
        keywords: ['providers', 'anthropic', 'openai', 'gemini', 'deepseek', 'qwen', 'kimi', 'bedrock', 'cost', 'tokens', 'caps', 'gateway'],
        body: (ctx) => (
          <>
            <Table
              head={['Provider', 'Web app', 'Terminal BINNY']}
              rows={[
                ['Anthropic', 'yes, optional gateway URL', 'yes, /endpoint for gateways'],
                ['OpenAI', 'yes', 'yes'],
                ['Google Gemini', 'yes', 'yes (OpenAI-compatible endpoint)'],
                ['DeepSeek', 'yes', 'yes'],
                ['Qwen (Alibaba)', 'yes', 'yes'],
                ['Kimi (Moonshot)', 'yes', 'yes'],
                ['OpenAI-compatible (custom)', 'yes, base URL', 'yes, /endpoint'],
                ['AWS Bedrock', 'yes', 'yes; no tool use, plain answers'],
                ['Ollama, LM Studio, local', 'no', 'yes'],
              ]}
            />
            <P>
              One key, saved once under <Kbd>Settings</Kbd> then <Kbd>API Keys</Kbd>, works on both apps. The terminal keeps its own
              config in <Code>~/.config/binny/config.json</Code>. See <L ctx={ctx} to="/docs/start/account-and-key">adding a key</L>.
            </P>
            <H2>Cost</H2>
            <P>
              We charge nothing for AI. Every call goes to your provider with your key. The panels print token counts and an estimate
              per answer; <Kbd>Settings</Kbd> then <Kbd>Usage</Kbd> shows the audit log of every call with provider, model, tokens in and
              out, and lets you set daily and monthly caps that are enforced on the server. The terminal has a per-project token budget
              (<Code>/budget</Code>) and pauses when it is reached instead of running on.
            </P>
            <P>
              Where the money goes: the first-pass analysis and deobfuscation send a lot of code; a BINNY light answer with several tool
              rounds adds up; a full terminal investigation on a frontier model is the expensive one. DeepSeek is a cheap second opinion.
            </P>
          </>
        ),
      },
    ],
  },

  // ---------------------------------------------------------------- reports
  {
    id: 'reports',
    title: 'Reports',
    pages: [
      {
        slug: 'editor',
        title: 'The report editor',
        summary: 'Markdown sections next to the code, with your screenshots, analysis pulls and templates.',
        keywords: ['report', 'editor', 'markdown', 'sections', 'save', 'preview', 'pull from analysis'],
        image: { key: 'report-in-project', alt: 'The report editor with sections, an inserted screenshot and the preview toggle' },
        body: (ctx) => (
          <>
            <P>
              Every project has one report. Edit it in the <Kbd>Report</Kbd> tab beside the code or in the full page behind{' '}
              <Kbd>Report ↗</Kbd>. Both are the same editor.
            </P>
            <H2>Sections</H2>
            <Bullets
              items={[
                <>Click a section title to rename it. <Kbd>▸</Kbd> collapses.</>,
                <><Kbd>👁 Preview</Kbd> renders the Markdown; <Kbd>✎ Edit</Kbd> goes back.</>,
                <><Kbd>🖼 Insert</Kbd> drops a screenshot from the Gallery at the cursor.</>,
                <><Kbd>Pull from analysis</Kbd> appears on findings, IoC, vulnerability, attack-surface and network sections and fills them from the first-pass analysis.</>,
                <><Kbd>↑</Kbd>, <Kbd>↓</Kbd> reorder, <Kbd>✕</Kbd> deletes with a confirm. <Kbd>+ Add section</Kbd> at the bottom.</>,
                <>The title is editable; the status line says <Code>Unsaved changes</Code>, <Code>Saved</Code> or <Code>Published</Code>. Click <Kbd>Save</Kbd>. Leaving with unsaved edits warns you.</>,
              ]}
            />
            <H2>Default sections</H2>
            <P>A new report starts with sections that match the project kind and the analysis mode set in the header.</P>
            <Table
              head={['Mode', 'Sections']}
              rows={
                isApk(ctx)
                  ? [
                      ['Malware (MAR)', 'Sample Overview, Static Analysis Findings, Indicators of Compromise, Recommendations, Analyst Notes'],
                      ['Vuln research (VRR)', 'Target Application, Attack Surface, Authentication & Data Storage, Network Security, Vulnerabilities, Reproduction Steps, Remediation, Researcher Notes'],
                    ]
                  : [
                      ['Malware (MAR)', 'Sample Overview, Static Analysis Findings, Indicators of Compromise, Suspicious Functions & Imports, Recommendations, Analyst Notes'],
                      ['Vuln research (VRR)', 'Target Binary, Attack Surface, Vulnerabilities, Reproduction Steps, Remediation / Mitigation, Researcher Notes'],
                    ]
              }
            />
            <P>
              BINNY light’s <Code>write_report_section</Code> and the Chain tab’s <Kbd>＋ Report</Kbd> add to the same sections, and the
              editor refreshes when they do, unless you have unsaved edits.
            </P>
          </>
        ),
      },
      {
        slug: 'templates',
        title: 'Report templates',
        summary: 'Save a section set once and apply it to any project. Yours only.',
        keywords: ['templates', 'sections', 'mar', 'vrr', 'reuse'],
        image: { key: 'report-templates', alt: 'The report templates settings page' },
        body: () => (
          <>
            <H2>From the editor</H2>
            <Bullets
              items={[
                <><Kbd>Save as template…</Kbd> snapshots the report’s saved sections. Give it a name, a description, a mode hint (<Kbd>Any mode</Kbd>, <Kbd>Malware (MAR)</Kbd>, <Kbd>Vulnerability research (VRR)</Kbd>), and tick <Kbd>Clear section content</Kbd> to keep only titles. It saves what is on the server, so save the report first.</>,
                <><Kbd>Apply template…</Kbd> lists your templates with a preview of their sections and an option to replace the report title too. Draft reports only.</>,
              ]}
            />
            <H2>From settings</H2>
            <P>
              <Kbd>Settings</Kbd> then <Kbd>Templates</Kbd> lists them with mode, section count and last update. <Kbd>+ New template</Kbd> opens
              an editor: name, mode, description, and sections with a title and optional starter Markdown each, reorderable. Templates are
              user-scoped; only you can see or apply yours.
            </P>
          </>
        ),
      },
      {
        slug: 'publish-and-share',
        title: 'Publish and share with the community',
        summary: 'Draft, then published and locked, then shared to the feed. Project visibility is a separate switch.',
        keywords: ['publish', 'share', 'community', 'visibility', 'public', 'private', 'unpublish', 'remove', 'lock'],
        image: { key: 'report-publish', alt: 'The Share with community dialog with malware type, tags and the project visibility checkbox' },
        body: (ctx) => (
          <>
            <H2>Three states</H2>
            <Clicks
              items={[
                <><strong>Draft.</strong> Editable by editors and the owner. Nobody else sees it.</>,
                <><strong>Published.</strong> <Kbd>Publish</Kbd> marks it final and locks it. You must save first. A banner says it is read-only; <Kbd>Unpublish</Kbd> reopens it for edits after a confirm.</>,
                <><strong>In the community.</strong> From a published report, <Kbd>🌐 Share with community</Kbd> opens the dialog: pick a malware type from the STIX list or leave it unspecified, add up to eight tags, and decide on <Kbd>Make the project public</Kbd>. <Kbd>🌐 Publish to community</Kbd>. Anyone on the internet can read it from then on, signed in or not.</>,
              ]}
            />
            <P>
              <Kbd>Remove from community</Kbd> takes the report out of the feed and keeps the locked report. Readers of the community
              page can flag a report with <Kbd>Report abuse</Kbd>; we review every flag by hand.
            </P>
            <H2>Project visibility</H2>
            <P>
              The <Kbd>🔒 Private</Kbd> / <Kbd>🌐 Public</Kbd> toggle in the header (owner only) is independent of the report. A public project
              shows a read-only page with metadata, report sections and highlights that anyone with the link can open
              {isApk(ctx) ? '. ' : ', and signed-in researchers can read the code and fork it. '}
              The share dialog ticks it on by default because a report with a browsable project is worth more to the reader.
            </P>
          </>
        ),
      },
      {
        slug: 'export',
        title: 'Export to Markdown or PDF',
        summary: 'Take the report with you.',
        keywords: ['export', 'markdown', 'pdf', 'print', 'download'],
        body: () => (
          <>
            <Bullets
              items={[
                <><Kbd>Download .md</Kbd> gives one Markdown file with every screenshot inlined as a data URL, so it stands alone.</>,
                <><Kbd>🖨 PDF</Kbd> opens a print view without the app chrome. Use the browser’s print dialog to save a PDF.</>,
              ]}
            />
          </>
        ),
      },
    ],
  },

  // -------------------------------------------------------------- community
  {
    id: 'community',
    title: 'Community',
    pages: [
      {
        slug: 'browse',
        title: 'Browsing research',
        summary: 'The feed of published reports, searchable by keyword or hash, open to everyone.',
        keywords: ['community', 'feed', 'search', 'sha256', 'hash', 'trending', 'tags', 'malware type'],
        image: { key: 'community', alt: 'The community feed of published reports' },
        body: (ctx) => (
          <>
            <P>
              <Kbd>Community</Kbd> in the top bar lists published {isApk(ctx) ? 'APK' : 'native binary and script'} reports. Each card has the
              title, author, project, a preview, the malware type, tags and a short hash. No sign-in needed to read.
            </P>
            <Bullets
              items={[
                <>Search by keyword. Paste a full SHA-256 and it becomes an exact hash filter: the fastest way to learn whether a sample has been written up.</>,
                <>Sort by <Kbd>Newest</Kbd> or <Kbd>Trending</Kbd>. Filter by malware type or by clicking a tag chip.</>,
                <>On a report: the author with a Follow button, the metadata, the sections, <Kbd>Discussion</Kbd>, and when the project is public, <Kbd>View project{isApk(ctx) ? '' : ' & fork'} →</Kbd>.</>,
                <>On your dashboard, <Kbd>For you</Kbd> shows reports from people you follow and <Kbd>Latest</Kbd> the three newest.</>,
              ]}
            />
            <P>Submissions reflect the views of their authors. Flag anything wrong with <Kbd>Report abuse</Kbd> on the report page.</P>
          </>
        ),
      },
      {
        slug: 'publish-and-fork',
        title: 'Publishing and forking',
        summary: 'Make your work public, and start from someone else’s instead of from zero.',
        keywords: ['publish', 'fork', 'public project', 'dedup', 'build on'],
        body: (ctx) => (
          <>
            <H2>Publishing</H2>
            <P>
              Publishing is done from the report: publish it, then share it with the community, optionally making the project
              public. The steps are on <L ctx={ctx} to="/docs/reports/publish-and-share">publish and share</L>.
            </P>
            <H2>Forking</H2>
            <P>
              A fork is your own editable copy of a public native binary project. It shares the decompiled analysis and starts with
              empty renames, highlights and report. {isApk(ctx) ? 'APK projects cannot be forked.' : 'Only native binary projects can be forked, and only once their analysis is ready.'}
            </P>
            <Bullets
              items={[
                <>On a public project page, click <Kbd>🍴 Fork</Kbd>. Signed-out visitors are sent to sign in first.</>,
                <>From the CLI, <Code>openbin decompile</Code> checks the file’s hash and offers to fork an existing public analysis instead of decompiling. <Code>--fork</Code> accepts without asking.</>,
                <>Forked projects carry a <Kbd>🍴 forked</Kbd> badge linking to the source, and the source shows its fork count.</>,
              ]}
            />
          </>
        ),
      },
      {
        slug: 'discuss-and-follow',
        title: 'Upvotes, discussion, following',
        summary: 'Vote for what helped you, talk under it, follow the people who wrote it.',
        keywords: ['upvote', 'comments', 'discussion', 'reply', 'follow', 'followers', 'profile', 'researchers', 'search'],
        body: (ctx) => (
          <>
            <H2>Upvotes and comments</H2>
            <Bullets
              items={[
                <>The upvote button sits on every report card and page. Click again to remove it.</>,
                <><Kbd>Discussion</Kbd> under a report sorts by hot, new or top. <Kbd>Post comment</Kbd> (up to 4,000 characters), <Kbd>Reply</Kbd> nests under a comment, <Kbd>Delete</Kbd> on your own leaves a <Code>[deleted]</Code> placeholder so the thread keeps its shape.</>,
              ]}
            />
            <H2>Following and profiles</H2>
            <Bullets
              items={[
                <><Kbd>+ Follow</Kbd> on a report or a profile. It becomes <Kbd>Following</Kbd>; click again to unfollow. Your follows feed the <Kbd>For you</Kbd> tab on the dashboard.</>,
                <>A profile shows display name, {isApk(ctx) ? '' : 'bio and links, '}join date, followers and following, published reports, and <Kbd>Collaborative reports</Kbd> the person contributed to{isApk(ctx) ? '.' : ', plus blog posts and CTF stats.'}</>,
                <><Kbd>✉ Message</Kbd> appears when that researcher’s message setting allows you. See <L ctx={ctx} to="/docs/collaborate/messages">messages</L>.</>,
                <><Kbd>Find researchers →</Kbd> on the community page searches by name (two characters minimum).</>,
              ]}
            />
            <P>
              Your own profile is under <Kbd>Settings</Kbd> then <Kbd>Profile</Kbd>. See <L ctx={ctx} to="/docs/account/profile">profile</L>.
            </P>
          </>
        ),
      },
      {
        slug: 'blog',
        title: 'The blog',
        summary: 'Write-ups and notes that do not belong to one project. Anyone signed in can post.',
        apps: ['openbin'],
        keywords: ['blog', 'post', 'write-up', 'markdown', 'draft'],
        body: () => (
          <>
            <P>
              <Kbd>Blog</Kbd> in the top bar. <Kbd>Write a post</Kbd> opens the editor: a title, an optional one-line summary for the feed,
              and a Markdown body. Drop a <Code>.md</Code> or <Code>.txt</Code> file anywhere in the editor to import it; a leading heading
              becomes the title. <Kbd>Show preview</Kbd> renders it.
            </P>
            <Bullets
              items={[
                <><Kbd>Save draft</Kbd> keeps it private; drafts show under <Kbd>Your drafts</Kbd> on the blog page.</>,
                <><Kbd>Publish</Kbd> gives it a permanent address under <Code>/blog/&lt;slug&gt;</Code> that does not change if you rename it later. <Kbd>Unpublish</Kbd> and <Kbd>Delete</Kbd> exist too.</>,
                <>Published posts get upvotes and comments like reports, and appear on your profile.</>,
              ]}
            />
          </>
        ),
      },
      {
        slug: 'ctf',
        title: 'The weekly CTF',
        summary: 'One crackme a week. First correct flag is Researcher of the Week. Leaderboards by week, season and all time.',
        apps: ['openbin'],
        keywords: ['ctf', 'crackme', 'flag', 'leaderboard', 'researcher of the week', 'first blood', 'writeup', 'season'],
        body: (ctx) => (
          <>
            <P>
              <Kbd>CTF</Kbd> in the top bar. Reading works signed out; submitting needs an account. Each challenge is a public project, so
              you can fork it and work in the browser with the listing, the decompiler and BINNY. When the challenge needs dynamic
              analysis, the raw binary is attached: <Kbd>Download binary</Kbd> on the challenge page, with its size and SHA-256, for
              your own debuggers and sandboxes.
            </P>
            <H2>Playing</H2>
            <Clicks
              items={[
                <>Open the live challenge. <Kbd>Open in OpenBin</Kbd> goes to the public project; <Kbd>🍴 Fork</Kbd> gives you your own copy. <Kbd>Download binary</Kbd>, when present, gives you the file itself.</>,
                <>Find the flag. The format is in the placeholder of the flag box, usually <Code>openbin{'{...}'}</Code>.</>,
                <>Paste it and <Kbd>Submit</Kbd>. Tick <Kbd>I used AI assistance</Kbd> if BINNY or another model helped; it shows as a tag next to your solve and nothing else changes.</>,
                <>Five attempts per ten minutes. Think before you paste.</>,
              ]}
            />
            <H2>Scoring</H2>
            <Table
              head={['Solve', 'Points']}
              rows={[
                ['First correct flag (first blood)', '100, and Researcher of the Week'],
                ['Each later solve inside the week', '10 fewer than the one before, down to 50'],
                ['After the week closes', '20, for practice; it does not count toward the week'],
              ]}
            />
            <P>
              Leaderboards: <Kbd>This week</Kbd>, <Kbd>Season</Kbd> (the calendar quarter) and <Kbd>All time</Kbd>. First bloods are counted
              separately. Flags are stored only as salted hashes.
            </P>
            <H2>Writeups</H2>
            <P>
              After you solve, attach a writeup: pick one of your public projects, typically your fork of the challenge with the report
              filled in, and <Kbd>Attach</Kbd>. Private projects are refused; make it public first. Writeups unlock for everyone when the week
              closes. New challenges and first bloods are announced on the <Ext href="https://discord.gg/HQsCZBHXwc">Discord</Ext>.
              Your CTF points and first bloods show on your <L ctx={ctx} to="/docs/account/profile">profile</L>.
            </P>
          </>
        ),
      },
    ],
  },

  // ------------------------------------------------------------ collaborate
  {
    id: 'collaborate',
    title: 'Working together',
    pages: [
      {
        slug: 'share-and-roles',
        title: 'Share a project and roles',
        summary: 'Invite researchers as viewers or editors. The owner keeps publishing and the roster.',
        keywords: ['share', 'invite', 'roles', 'viewer', 'editor', 'owner', 'collaborators', 'team', 'email'],
        body: () => (
          <>
            <P>
              <Kbd>Share</Kbd> in the project header (owner only) opens <Kbd>Share project</Kbd>. Find people under <Kbd>Search</Kbd>,{' '}
              <Kbd>Following</Kbd> or <Kbd>Followers</Kbd>, or invite by <Kbd>Email</Kbd>. Pick a <Kbd>Role</Kbd> and <Kbd>Add</Kbd>. The{' '}
              <Kbd>Collaborators</Kbd> list shows everyone with a role chip and <Kbd>Remove</Kbd>.
            </P>
            <Table
              head={['Role', 'Can']}
              rows={[
                ['Viewer', 'Read everything: code, analysis, highlights, gallery, report, chat.'],
                ['Editor', 'Everything a viewer can, plus run analysis, rename, deobfuscate, generate, add highlights and screenshots, edit the report, add samples.'],
                ['Owner', 'Everything, plus publish publicly, change project visibility, manage the roster, delete the project.'],
              ]}
            />
            <P>
              The avatar stack in the header opens <Kbd>Members</Kbd> with each person’s role and last activity. Invited people get an email
              if their preferences allow it, and the project appears in their Projects list.
            </P>
          </>
        ),
      },
      {
        slug: 'overview-and-chat',
        title: 'Project overview and team chat',
        summary: 'A home page per project and a chat everyone on the roster can read.',
        keywords: ['overview', 'description', 'status', 'workflow', 'team chat', 'chat', 'roster'],
        body: (ctx) => (
          <>
            {isApk(ctx) ? null : (
              <>
                <H2>Overview</H2>
                <P>
                  <Kbd>← Project</Kbd> in the workspace header, or the project’s name in Projects, opens the overview: an editable name and{' '}
                  <Kbd>Description</Kbd> (what the sample is, where it came from), a <Kbd>Status</Kbd> card with the workflow state (New,
                  Triaging, Analyzing, Drafting report, and Published once the report is locked) and the file facts, an <Kbd>Access</Kbd> card
                  with <Kbd>Share…</Kbd>, the visibility toggle and the member roster, the <Kbd>Samples</Kbd> list, and the team chat.
                  <Kbd>Open workspace</Kbd>, <Kbd>Report</Kbd> and <Kbd>🍴 Fork</Kbd> at the top; <Kbd>Delete project</Kbd> at the bottom for the owner.
                </P>
              </>
            )}
            <H2>Team chat</H2>
            <P>
              The <Kbd>Chat</Kbd> tab in the workspace{isApk(ctx) ? '' : ' and the chat on the overview page'} is one conversation per project.
              Everyone on the roster can read and post; nobody else can. It uses the same messaging as direct messages and shows up in
              your <Kbd>Messages</Kbd> inbox alongside them. Set the project’s workflow state in the header so the team sees where things stand.
            </P>
          </>
        ),
      },
      {
        slug: 'messages',
        title: 'Direct messages',
        summary: 'One-to-one messages between researchers, with a setting that decides who may start one with you.',
        keywords: ['messages', 'dm', 'direct message', 'inbox', 'who can message', 'policy', 'privacy'],
        body: () => (
          <>
            <P>
              <Kbd>Messages</Kbd> in the top bar opens the inbox. Start a conversation from the search box at the top, or with{' '}
              <Kbd>✉ Message</Kbd> on a profile. <Kbd>Enter</Kbd> sends, <Kbd>Shift+Enter</Kbd> adds a line, 4,000 characters per message, 30
              messages a minute. Conversations are shared between OpenBin and OpenAPK.
            </P>
            <H2>Who can message you</H2>
            <P>Under <Kbd>Settings</Kbd> then <Kbd>Profile</Kbd>. It applies on both apps and saves as soon as you pick one.</P>
            <Table
              head={['Setting', 'Effect']}
              rows={[
                ['Everyone', 'Any signed-in researcher can start a conversation with you. This is the default.'],
                ['Only people I follow', 'Your follows are your allowlist. Anyone else sees no Message button and is refused.'],
                ['Nobody', 'Direct messages off. Existing threads become read-only for the other side; you can still reply.'],
              ]}
            />
          </>
        ),
      },
    ],
  },

  // ---------------------------------------------------------------- scripts
  {
    id: 'scripts',
    title: 'Packages and scripts',
    apps: ['openbin'],
    pages: [
      {
        slug: 'npm-pypi-shell',
        title: 'npm, PyPI, PowerShell and shell',
        summary: 'Supply-chain samples go through the browser, not the CLI. Findings by severity, deobfuscation on demand, BINNY on the file.',
        apps: ['openbin'],
        keywords: ['npm', 'pypi', 'powershell', 'shell', 'script', 'package', 'tgz', 'whl', 'supply chain', 'postinstall', 'obfuscator'],
        body: () => (
          <>
            <H2>Upload</H2>
            <P>
              On <Kbd>Projects</Kbd>, the card <Kbd>Analyze an npm / PyPI package or loose shell script</Kbd> takes a <Code>.tgz</Code>,{' '}
              <Code>.whl</Code>, <Code>.zip</Code>, a single <Code>.js</Code>, <Code>.py</Code>, <Code>.ps1</Code> or <Code>.sh</Code> file, or a folder,
              up to 25 MB. <Kbd>Pick file</Kbd>, <Kbd>Pick folder</Kbd>, or drop it on the card. Analysis runs in the cloud for these; the
              status reads <Code>Analyzing in Lambda…</Code>. Compiled executables still go through the CLI.
            </P>
            <H2>The workspace</H2>
            <Bullets
              items={[
                <>Header: package and version, an ecosystem badge, severity pills, the screenshot buttons.</>,
                <>Left: <Kbd>Files</Kbd>, the package tree.</>,
                <>Middle: the file. <Kbd>Original</Kbd> or <Kbd>Auto (upload)</Kbd> shows the deobfuscated version produced at upload. Pick an engine (<Kbd>Auto</Kbd>, <Kbd>obfuscator.io</Kbd>, <Kbd>General JS</Kbd>, <Kbd>Caesar decode</Kbd>) and <Kbd>Deobfuscate</Kbd> for another pass. Double-click an identifier to rename it within the file.</>,
                <>Right: <Kbd>Findings</Kbd> grouped CRITICAL, HIGH, MEDIUM, INFO. Each has the rule, a <Code>file:line</Code> link, the message and a snippet; expand for <Kbd>What to do</Kbd> and <Kbd>Evidence</Kbd>. The summary flags a postinstall hook and how many files were deobfuscated.</>,
                <>Below that: <Kbd>BINNY</Kbd>, <Kbd>Report</Kbd>, <Kbd>Gallery</Kbd>. BINNY here receives the open file inline and can switch between <Kbd>Per file</Kbd> and <Kbd>Everything</Kbd>.</>,
              ]}
            />
            <P>Script projects publish to the community like any other and appear in the feed with their ecosystem.</P>
          </>
        ),
      },
    ],
  },

  // ---------------------------------------------------------------- account
  {
    id: 'account',
    title: 'Account and settings',
    pages: [
      {
        slug: 'api-keys',
        title: 'API Keys',
        summary: 'Add, test and remove provider credentials. Encrypted, yours, shared across both apps.',
        keywords: ['api keys', 'credentials', 'test', 'delete', 'encrypted', 'gateway', 'base url', 'bedrock'],
        body: (ctx) => (
          <>
            <P>
              <Kbd>Settings</Kbd> then <Kbd>API Keys</Kbd>. The providers and the fields each one needs are on{' '}
              <L ctx={ctx} to="/docs/start/account-and-key">sign in and add a key</L>.
            </P>
            <Bullets
              items={[
                <>Every stored credential shows its label, provider, when it was added and the last test result. <Kbd>Test</Kbd> makes a tiny call and reports ok or the provider’s error. <Kbd>Delete</Kbd> asks to confirm.</>,
                <>You can keep several credentials for one provider, for example a personal and a work key, and pick per call.</>,
                <>Keys are encrypted at rest with AES-256-GCM under a server-side key and are decrypted only to make your calls. They are never shown again after saving.</>,
                <>Deleting your account deletes the credentials with it.</>,
              ]}
            />
          </>
        ),
      },
      {
        slug: 'usage',
        title: 'Usage and caps',
        summary: 'Every model call you made, and the ceilings you set for yourself.',
        keywords: ['usage', 'tokens', 'caps', 'limit', 'audit log', 'cost'],
        body: () => (
          <>
            <P>
              <Kbd>Settings</Kbd> then <Kbd>Usage</Kbd>. <Kbd>Today</Kbd> and <Kbd>This month</Kbd> show tokens used against the cap and when
              each resets. <Kbd>Token caps</Kbd> takes a daily and a monthly number, combined input and output, enforced on the server. Blank
              means unlimited; zero blocks every call, which is a quick way to pause yourself.
            </P>
            <P>
              The <Kbd>Audit log</Kbd> lists each call: when, purpose, provider and model, tokens in and out, and ok or failed. Hover a
              failure to read the provider’s error.
            </P>
          </>
        ),
      },
      {
        slug: 'profile',
        title: 'Profile',
        summary: 'What other researchers see, and who gets to contact you.',
        keywords: ['profile', 'display name', 'avatar', 'gravatar', 'bio', 'links', 'byline', 'credit'],
        body: (ctx) => (
          <>
            <Bullets
              items={[
                <><Kbd>Display name</Kbd>, up to 60 characters; blank falls back to the name from sign-in.</>,
                <>Avatar comes from Gravatar for your sign-in email. There is no upload; set one at gravatar.com.</>,
                isApk(ctx) ? (
                  <>Bio and social links are edited on app.openbin.ai and shown there.</>
                ) : (
                  <><Kbd>Bio &amp; links</Kbd>: a bio up to 600 characters, plus GitHub, X, website, Mastodon and LinkedIn. Shown on your profile and beside your byline.</>
                ),
                <><Kbd>Public credit</Kbd> decides whether you appear in the contributor byline of reports you helped with. Reports you own and publish always credit you as lead.</>,
                <><Kbd>Who can message you</Kbd>: Everyone, only people you follow, or nobody. See <L ctx={ctx} to="/docs/collaborate/messages">messages</L>.</>,
              ]}
            />
          </>
        ),
      },
      {
        slug: 'notifications',
        title: 'Notifications and email',
        summary: 'The bell in the top bar, and which emails you want.',
        keywords: ['notifications', 'bell', 'email', 'preferences', 'follow', 'comment', 'invite'],
        body: () => (
          <>
            <P>
              The bell shows in-app notifications: follows, comments and replies on your reports, project invites, and system notices.
              Email for each kind is a toggle under <Kbd>Settings</Kbd> then <Kbd>Profile</Kbd>, <Kbd>Email preferences</Kbd>:
            </P>
            <Bullets
              items={[
                'When a decompile finishes',
                'When you publish a report to the community',
                'When you submit an abuse report',
                'When someone follows you',
                'When someone comments on your report',
                'When someone replies to your comment',
                'When someone invites you to a project',
              ]}
            />
            <P>Anti-abuse and security messages are sent regardless.</P>
          </>
        ),
      },
      {
        slug: 'theme-and-delete',
        title: 'Theme, Terms, deleting your account',
        summary: 'The small things, and the one you cannot undo.',
        keywords: ['theme', 'light mode', 'dark mode', 'terms', 'privacy', 'delete account', 'anonymize'],
        body: () => (
          <>
            <H2>Theme</H2>
            <P>The sun and moon toggle in the top bar switches between dark and light. The choice is remembered per app in this browser.</P>
            <H2>Terms and privacy</H2>
            <P>Linked in the footer of every page. You accept the Terms once at first sign-in.</P>
            <H2>Delete account</H2>
            <P>
              At the bottom of <Kbd>Settings</Kbd> then <Kbd>Profile</Kbd>. It permanently deletes your account and private data: projects
              and uploaded files, decompiled output, saved credentials, usage history. Anything you published to the community stays but is
              anonymized. Type <Code>DELETE</Code> or your email to confirm, then <Kbd>Delete my account</Kbd>. There is no undo.
            </P>
          </>
        ),
      },
    ],
  },

  // ------------------------------------------------------------------- more
  {
    id: 'more',
    title: 'More',
    pages: [
      {
        slug: 'troubleshooting',
        title: 'Troubleshooting',
        summary: 'The questions that come up most, with the fix.',
        keywords: ['troubleshooting', 'faq', 'docker', 'greyed out', 'disabled', 'viewer', 'unavailable', 'cross-highlight', 'path'],
        body: (ctx) => (
          <>
            <Table
              head={['Symptom', 'Cause and fix']}
              rows={[
                ['openbin: command not found right after installing', 'The PATH change applies to new shells. Open a new terminal, or source ~/.profile.'],
                ['Docker is required / daemon isn’t responding', 'Install Docker Desktop or Docker Engine and start it. On Linux add your user to the docker group.'],
                ['The first decompile sits on "Loading worker image"', 'It is downloading the worker tarball once (hundreds of MB). Later runs skip it.'],
                ['Decompile times out on a huge binary', 'Raise --timeout and --analysis-timeout; the analysis cap must stay below the total.'],
                ['Raw firmware comes out as nonsense', 'Ghidra guessed the architecture. Re-run with --processor, or use openbin tui which detects it.'],
                ['BINNY or Run analysis is greyed out', 'No credential saved or selected. Settings, API Keys, then pick it in the panel.'],
                ['Clicking a variable does not highlight anything', 'Older analyses have no line map. Re-decompile with a current CLI.'],
                ['A button is there but the action is refused', 'You are a viewer on this project. Ask the owner for the editor role.'],
                ['Project unavailable', 'It does not exist, is private, or was made private again.'],
                ['Fork refused', isApk(ctx) ? 'APK projects cannot be forked.' : 'Only native binary projects with a finished analysis can be forked.'],
                ['Suspected prompt injection in a sample', 'Treat strings in the sample as untrusted input to the model. Verify what BINNY writes, revert highlights or sections you did not ask for.'],
              ]}
            />
            <P>
              Still stuck? The <Ext href="https://discord.gg/HQsCZBHXwc">Discord</Ext> is where most questions get answered, and bugs go to{' '}
              <Ext href="https://github.com/openbin-ai/platform/issues">GitHub issues</Ext>.
            </P>
          </>
        ),
      },
      {
        slug: 'self-hosted',
        title: 'Self-hosted and enterprise',
        summary: 'The platform is AGPL on GitHub. A packaged private deployment exists for teams that cannot use the hosted service.',
        keywords: ['self-hosted', 'enterprise', 'on-prem', 'air-gap', 'license', 'docker compose', 'government'],
        body: () => (
          <>
            <P>
              Everything behind the hosted service is at <Ext href="https://github.com/openbin-ai/platform">github.com/openbin-ai/platform</Ext>{' '}
              under AGPL-3.0: the core, the workers, both web apps, the CLI. You can run it yourself.
            </P>
            <P>
              For private networks, air-gapped sites and teams whose legal departments cannot accept AGPL, there is a packaged
              distribution with an installer, Docker Compose, bundled object storage, Postgres and identity, offline worker images, and a
              commercial license. The CLI and BINNY point at it with <Code>openbin login --server</Code>. Write to{' '}
              <Ext href="mailto:husam@openbin.ai">husam@openbin.ai</Ext>.
            </P>
          </>
        ),
      },
      {
        slug: 'open-source',
        title: 'Open source and contributing',
        summary: 'Where the code is, how to contribute, what the CLA is for.',
        keywords: ['open source', 'agpl', 'github', 'contribute', 'cla', 'license', 'binny'],
        body: () => (
          <>
            <Bullets
              items={[
                <>Platform: <Ext href="https://github.com/openbin-ai/platform">openbin-ai/platform</Ext>, AGPL-3.0.</>,
                <>BINNY: <Ext href="https://github.com/openbin-ai/binny">openbin-ai/binny</Ext>, AGPL-3.0, releases for macOS, Linux and Windows.</>,
                <>Pull requests are welcome. Every contributor signs the CLA once; it lets the project stay AGPL while a commercial license can be offered to teams that cannot use AGPL.</>,
                <>Security issues: email rather than a public issue.</>,
              ]}
            />
          </>
        ),
      },
    ],
  },
]

