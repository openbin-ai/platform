import { Link, useLocation } from 'react-router-dom'
import { DocsShell } from '@shared/docs/DocsShell'
import { installScriptUrl } from '@shared/config/runtime'
import apiKeys from '../assets/docs/api-keys.png'
import crypto from '../assets/docs/crypto.png'
import callChain from '../assets/docs/call-chain.png'
import nativeCode from '../assets/docs/native-code.png'
import reportTemplates from '../assets/docs/report-templates.png'
import analysis from '../assets/docs/decompiled-code-ai-analysis.png'
import annotate from '../assets/docs/code-screenshot-annotating.png'

/**
 * The docs site at /docs/*. Same shared tree as OpenBin, filtered to the
 * pages that apply here. Anonymous-readable (outside RequireAuth).
 */
const IMAGES: Record<string, string> = {
  'api-keys': apiKeys,
  crypto,
  'call-chain': callChain,
  'native-code': nativeCode,
  'report-templates': reportTemplates,
  'ai-analysis': analysis,
  'ask-ai': analysis,
  'screenshot-annotate': annotate,
}

export function Docs() {
  const { pathname } = useLocation()
  return (
    <DocsShell
      app="openapk"
      appName="OpenAPK"
      appUrl="https://openapk.ai"
      pathname={pathname}
      Link={Link}
      images={IMAGES}
      installScriptUrl={installScriptUrl}
    />
  )
}
