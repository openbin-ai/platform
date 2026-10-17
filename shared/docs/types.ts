import type { ComponentType, ReactNode } from 'react'

export type InstallScript = 'install.sh' | 'install.ps1' | 'install-binny.sh' | 'install-binny.ps1'

/** Which app is rendering the docs. Pages can be limited to one. */
export type DocApp = 'openbin' | 'openapk'

/**
 * What a page body receives. The app supplies the screenshots (shared/ cannot
 * import image assets) and the runtime-aware install URLs, so one content
 * tree serves both apps and self-hosted installs.
 */
export type DocCtx = {
  app: DocApp
  /** Product name for prose: "OpenBin" or "OpenAPK". */
  appName: string
  /** Where the web app lives, for absolute links in prose. */
  appUrl: string
  /** Screenshot lookup by key; a missing key renders no figure. */
  images: Record<string, string | undefined>
  installScriptUrl: (file: InstallScript) => string
  /** Router link for cross-references between pages. */
  Link: LinkComponent
}

export type DocPage = {
  slug: string
  title: string
  /** One sentence under the title; also what search matches on. */
  summary: string
  /** Omit for both apps. */
  apps?: DocApp[]
  /** Extra search terms, lower-case. */
  keywords?: string[]
  /** Key into DocCtx.images for the hero figure, with its alt text. */
  image?: { key: string; alt: string }
  body: (ctx: DocCtx) => ReactNode
}

export type DocSection = {
  id: string
  title: string
  apps?: DocApp[]
  pages: DocPage[]
}

/** The router's Link, injected so shared/ stays free of react-router. */
export type LinkComponent = ComponentType<{
  to: string
  className?: string
  children?: ReactNode
  'aria-current'?: 'page'
  onClick?: () => void
}>

export function pageVisible(app: DocApp, item: { apps?: DocApp[] }): boolean {
  return !item.apps || item.apps.includes(app)
}
