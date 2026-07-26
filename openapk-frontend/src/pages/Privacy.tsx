import { Link } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'

// Plain-English privacy stub. Mounted at /privacy outside RequireAuth so
// anonymous visitors can review before signing up. Linked from the landing
// footer and from Terms. Pairs with the SES + S3 cutover so we have a posted
// policy the moment we start sending transactional email or storing user
// uploads in cloud object storage.
export function Privacy() {
  const auth = useAuth()
  return (
    <div className="flex min-h-full flex-col bg-zinc-950 text-zinc-200">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <h1 className="mb-6 text-2xl font-semibold text-zinc-100">Privacy</h1>
        <div className="prose prose-invert prose-sm max-w-none prose-headings:text-zinc-200 prose-a:text-purple-400 text-zinc-300">
          <p>
            OpenAPK is bring-your-own-key by design. Your APK, your decompiled tree, your
            reports, your LLM provider - we hold the workspace, you hold the intelligence.
            This page lists what we store, where, and what we do not do.
          </p>

          <h2>What we store</h2>
          <ul>
            <li>
              <strong>Account</strong> - email and display name from your Keycloak identity.
              We never display your raw email publicly; community authorship is rendered as a
              Gravatar identifier (MD5 of your email).
            </li>
            <li>
              <strong>Provider credentials</strong> - your Anthropic / OpenAI / Bedrock API
              keys, encrypted at rest with a key-encryption key (KEK) the operator controls.
            </li>
            <li>
              <strong>Project content</strong> - APKs you upload, decompiled source, screenshots,
              annotations, reports, and audit entries. Stored in Postgres + object storage
              owned by the operator of the instance.
            </li>
            <li>
              <strong>Usage audit</strong> - per-call token counts and cost estimates for your
              own LLM spend, visible on your Usage page.
            </li>
          </ul>

          <h2>What we do not do</h2>
          <ul>
            <li>No analytics, no third-party trackers, no telemetry pings.</li>
            <li>
              We do not proxy your LLM calls. Your prompts and responses go directly between
              your browser/server and your chosen provider; we never see them in transit.
            </li>
            <li>We do not sell, share, or train models on your project content.</li>
          </ul>

          <h2>Third parties</h2>
          <p>
            When you run an analysis, your prompts and the relevant source/strings are sent to
            the LLM provider you configured. Their terms apply to that data. We send
            transactional email (account flows, abuse responses) through Amazon SES; no
            marketing email.
          </p>

          <h2>Community publishing</h2>
          <p>
            Reports you publish to the community are public to anyone on the internet. Drafts
            and unpublished projects are private to you. See <Link to="/terms">Terms</Link>{' '}
            for what is allowed.
          </p>

          <h2>Cookies</h2>
          <p>
            We use a session cookie for sign-in (issued by Keycloak). No third-party cookies,
            no advertising cookies.
          </p>

          <h2>Deletion</h2>
          <p>
            Delete a project from the Projects page to remove its content. To delete your
            entire account, email us at{' '}
            <a href="mailto:husam@openbin.ai">husam@openbin.ai</a>. Community
            reports already published may be retained as already-public content; we will
            unpublish on request.
          </p>

          <h2>Changes</h2>
          <p>
            We may update this notice as the product evolves. Continued use after a change
            constitutes acceptance.
          </p>
        </div>
        <div className="mt-8 flex items-center gap-4 border-t border-zinc-900 pt-4 text-sm">
          <Link to="/terms" className="text-purple-400 hover:underline">Terms →</Link>
          {auth.isAuthenticated && (
            <Link to="/projects" className="text-zinc-400 hover:text-zinc-200">My projects</Link>
          )}
        </div>
      </main>
    </div>
  )
}
