import { Link, useLocation } from 'react-router-dom'
import { DocsShell } from '@shared/docs/DocsShell'
import { installScriptUrl } from '@shared/config/runtime'
import cliDecompile from '../assets/docs/cli-decompile.png'
import askAi from '../assets/docs/project-view-ask-ai.png'
import screenshotAnnotate from '../assets/docs/screenshot-annotate.png'
import reportInProject from '../assets/docs/report-in-project.png'
import reportPublish from '../assets/docs/report-publish.png'
import aiAnalysis from '../assets/docs/ai-analysis.png'
import graph from '../assets/docs/graph.png'
import community from '../assets/docs/community.png'
import apiKeys from '../assets/docs/api-keys.png'

/**
 * The docs site at /docs/*. Content and shell live in shared/docs so OpenAPK
 * renders the same tree; this file only supplies what shared/ cannot import:
 * the router Link, the screenshots, and the runtime-aware install URL.
 * Anonymous-readable (declared outside RequireAuth in App.tsx).
 */
const IMAGES: Record<string, string> = {
  'cli-decompile': cliDecompile,
  'ask-ai': askAi,
  'screenshot-annotate': screenshotAnnotate,
  'report-in-project': reportInProject,
  'report-publish': reportPublish,
  'ai-analysis': aiAnalysis,
  graph,
  community,
  'api-keys': apiKeys,
}

export function Docs() {
  const { pathname } = useLocation()
  return (
    <DocsShell
      app="openbin"
      appName="OpenBin"
      appUrl="https://app.openbin.ai"
      pathname={pathname}
      Link={Link}
      images={IMAGES}
      installScriptUrl={installScriptUrl}
    />
  )
}
