import { Link } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'

// Plain-English T&Cs for community-published reports. Deliberately short
// for v1 - covers the absolute non-negotiables (no CSAM, no doxing, no
// content that violates third-party rights, we may remove anything). A
// fuller legal-reviewed version is in the post-launch backlog.
//
// Mounted at /terms outside RequireAuth so anonymous readers can review.
export function Terms() {
  const auth = useAuth()
  return (
    <div className="flex min-h-full flex-col bg-zinc-950 text-zinc-200">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <h1 className="mb-6 text-2xl font-semibold text-zinc-100">Community Terms</h1>
        <div className="prose prose-invert prose-sm max-w-none prose-headings:text-zinc-200 prose-a:text-purple-400 text-zinc-300">
          <p>
            When you publish a report to the OpenAPK community, you make it visible to anyone
            on the internet, including users without an account. By publishing, you confirm:
          </p>
          <ul>
            <li>
              You have the legal right to share the content of the report and any artifacts
              referenced in it.
            </li>
            <li>
              The report does not contain content that is unlawful in your jurisdiction or
              ours, including but not limited to: child sexual abuse material, content that
              targets or doxes individuals, content that infringes third-party copyright or
              trade-secret rights, and content that violates export-control laws.
            </li>
            <li>
              You will not use community publishing to distribute malware, exploit code that
              targets live production services without prior authorization, or material whose
              primary purpose is to facilitate criminal activity.
            </li>
            <li>
              You understand that we may remove any report at our sole discretion, including
              in response to abuse reports, DMCA notices, or our own judgment, without prior
              notice.
            </li>
          </ul>
          <h2>Authorship and attribution</h2>
          <p>
            Reports are displayed with your chosen display name. We never display your raw
            email address publicly; only a Gravatar identifier (an MD5 hash of your email)
            is shared with anonymous readers.
          </p>
          <h2>Liability</h2>
          <p>
            Community submissions reflect the views of their authors only. We make no
            representations as to accuracy, completeness, or fitness for any purpose, and
            disclaim liability for losses arising from reliance on community content to the
            maximum extent permitted by law.
          </p>
          <h2>Reporting abuse</h2>
          <p>
            Use the "Report abuse" button on any community report to flag content for review.
            We review every flagged submission. Persistent abuse may result in account
            termination.
          </p>
          <h2>Changes</h2>
          <p>
            We may update these terms as the product evolves. Continued use after a change
            constitutes acceptance.
          </p>
        </div>
        <div className="mt-8 flex items-center gap-4 border-t border-zinc-900 pt-4 text-sm">
          <Link to="/community" className="text-purple-400 hover:underline">← Community</Link>
          {auth.isAuthenticated && (
            <Link to="/projects" className="text-zinc-400 hover:text-zinc-200">My projects</Link>
          )}
        </div>
      </main>
    </div>
  )
}
