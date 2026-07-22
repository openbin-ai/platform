import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from 'react-oidc-context'
import { RequireAuth } from '@shared/auth/RequireAuth'
import { TosGate } from '@shared/components/TosGate'
import { oidcConfig } from './auth/oidcConfig'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'
import { Projects } from './pages/Projects'
import { ProjectViewRoute } from './pages/ProjectViewRoute'
import { ApiKeys } from './pages/ApiKeys'
import { Report } from './pages/Report'
import { ReportPrint } from './pages/ReportPrint'
import { ReportTemplates } from './pages/ReportTemplates'
import { Usage } from './pages/Usage'
import { CallGraph } from './pages/CallGraph'
import { Community } from './pages/Community'
import { CommunityReport } from './pages/CommunityReport'
import { PublicProject } from './pages/PublicProject'
import { AuthorProfilePage } from './pages/AuthorProfilePage'
import { FollowListPage } from './pages/FollowListPage'
import { ResearcherSearch } from './pages/ResearcherSearch'
import { Terms } from './pages/Terms'
import { Privacy } from './pages/Privacy'
import { Docs } from './pages/Docs'
import { CliDocs } from './pages/CliDocs'
import { Profile } from './pages/Profile'

// OpenBin frontend. Mirrors openapk-frontend's auth scaffolding (same
// Keycloak realm, different OIDC client_id) so a user logged in on either
// site can cross over without re-authenticating.
//
// IMPORTANT: `/` is the OIDC redirect_uri (see shared/auth/oidcConfig.ts).
// It MUST render real content directly, never a <Navigate>. A redirect at
// this path would rewrite the URL and strip the ?code=...&state=... query
// params before AuthProvider can consume them — which silently breaks the
// callback and re-triggers signinRedirect in a loop. Home (dashboard) is
// rendered at index so the callback lands on a real component.
//
// ProjectView intentionally lives OUTSIDE Layout — it uses the full viewport
// like an IDE; a top navbar would steal vertical space from the function /
// code panes that are the whole point of the page.
export default function App() {
  return (
    <AuthProvider {...oidcConfig}>
      <BrowserRouter>
        <Routes>
          {/* Community pages — anonymous browsing. Outside RequireAuth so
              signed-out visitors can read published research. */}
          <Route path="community" element={<Community />} />
          <Route path="community/researchers" element={<ResearcherSearch />} />
          <Route path="community/reports/:id" element={<CommunityReport />} />
          {/* Anonymous read-only project view — shareable public link. */}
          <Route path="public/projects/:id" element={<PublicProject />} />
          {/* Public researcher profile — anonymous-readable, shareable. */}
          <Route path="u/:id" element={<AuthorProfilePage />} />
          <Route path="u/:id/followers" element={<FollowListPage mode="followers" />} />
          <Route path="u/:id/following" element={<FollowListPage mode="following" />} />
          <Route path="terms" element={<Terms />} />
          <Route path="privacy" element={<Privacy />} />
          {/* How-to guide — anonymous-readable so prospective users can read
              it before signing in. Must be declared before the catch-all. */}
          <Route path="docs" element={<Docs />} />
          <Route path="docs/cli" element={<CliDocs />} />

          {/* Print view is chrome-free (no Layout) so what you see is what
              you print — matches openapk's /projects/:id/report/print. */}
          <Route
            path="projects/:id/report/print"
            element={
              <RequireAuth>
                <TosGate accent="purple"><ReportPrint /></TosGate>
              </RequireAuth>
            }
          />
          {/* Call graph is full-viewport like ProjectView — graph needs every
              pixel for the canvas + side rails. No Layout wrapper. */}
          <Route
            path="projects/:id/graph"
            element={
              <RequireAuth>
                <TosGate accent="purple"><CallGraph /></TosGate>
              </RequireAuth>
            }
          />
          <Route
            element={
              <RequireAuth>
                <TosGate accent="purple"><Layout /></TosGate>
              </RequireAuth>
            }
          >
            <Route index element={<Home />} />
            <Route path="dashboard" element={<Home />} />
            <Route path="projects" element={<Projects />} />
            <Route path="projects/:id" element={<ProjectViewRoute />} />
            <Route path="projects/:id/report" element={<Report />} />
            <Route path="settings/api-keys" element={<ApiKeys />} />
            <Route path="settings/report-templates" element={<ReportTemplates />} />
            <Route path="settings/usage" element={<Usage />} />
            <Route path="settings/profile" element={<Profile />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
