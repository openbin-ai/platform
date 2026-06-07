import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from 'react-oidc-context'
import { oidcConfig } from './auth/oidcConfig'
import { RequireAuth } from './auth/RequireAuth'
import { TosGate } from '@shared/components/TosGate'
import { Layout } from './components/Layout'
import { Landing } from './pages/Landing'
import { Home } from './pages/Home'
import { ApiKeys } from './pages/ApiKeys'
import { Projects } from './pages/Projects'
import { ProjectView } from './pages/ProjectView'
import { Report } from './pages/Report'
import { ReportPrint } from './pages/ReportPrint'
import { ReportTemplates } from './pages/ReportTemplates'
import { Usage } from './pages/Usage'
import { Community } from './pages/Community'
import { CommunityReport } from './pages/CommunityReport'
import { AuthorProfilePage } from './pages/AuthorProfilePage'
import { FollowListPage } from './pages/FollowListPage'
import { Terms } from './pages/Terms'
import { Privacy } from './pages/Privacy'
import { Profile } from './pages/Profile'

export default function App() {
  return (
    <AuthProvider {...oidcConfig}>
      <BrowserRouter>
        <Routes>
          {/* Public marketing landing — no auth required. */}
          <Route path="/" element={<Landing />} />

          {/* Community pages — anonymous browsing. Outside RequireAuth so
              signed-out visitors can read published research. */}
          <Route path="/community" element={<Community />} />
          <Route path="/community/reports/:id" element={<CommunityReport />} />
          {/* Public researcher profile. Mirrors /community in that it's
              accessible anonymously and shareable as a link. */}
          <Route path="/u/:id" element={<AuthorProfilePage />} />
          <Route path="/u/:id/followers" element={<FollowListPage mode="followers" />} />
          <Route path="/u/:id/following" element={<FollowListPage mode="following" />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />

          {/* Print view is chrome-free (no Layout) so what you see is what you print. */}
          <Route
            path="/projects/:id/report/print"
            element={
              <RequireAuth>
                <TosGate accent="amber"><ReportPrint /></TosGate>
              </RequireAuth>
            }
          />
          <Route
            element={
              <RequireAuth>
                <TosGate accent="amber"><Layout /></TosGate>
              </RequireAuth>
            }
          >
            <Route path="/dashboard" element={<Home />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectView />} />
            <Route path="/projects/:id/report" element={<Report />} />
            <Route path="/settings/api-keys" element={<ApiKeys />} />
            <Route path="/settings/report-templates" element={<ReportTemplates />} />
            <Route path="/settings/usage" element={<Usage />} />
            <Route path="/settings/profile" element={<Profile />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
