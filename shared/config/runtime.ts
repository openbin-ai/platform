/**
 * Runtime configuration for the web apps.
 *
 * The hosted product bakes its endpoints in at build time through Vite env
 * (`VITE_API_BASE`, `VITE_KEYCLOAK_AUTHORITY`). A self-hosted install runs
 * the same build on hostnames nobody knew at build time, so the container
 * serves `/openbin-config.js`, which sets `window.__OPENBIN_CONFIG__` before
 * the bundle loads. Values from that object win; Vite env is the fallback;
 * the local dev stack is the fallback's fallback.
 *
 * `public/openbin-config.js` in each app is an empty placeholder so the
 * script tag resolves in dev and in the hosted build.
 */
export type RuntimeConfig = {
  /** Backend origin, no trailing slash. */
  apiBase?: string
  /** OIDC authority, e.g. https://auth.example/realms/openapk */
  authority?: string
  /** Where install.sh / install.ps1 / install-binny.* are served from. */
  installBase?: string
  /** True on self-hosted installs: swaps hosted-only copy for local guidance. */
  selfHosted?: boolean
}

declare global {
  interface Window {
    __OPENBIN_CONFIG__?: RuntimeConfig
  }
}

function fromWindow(): RuntimeConfig {
  if (typeof window === 'undefined') return {}
  const cfg = window.__OPENBIN_CONFIG__
  return cfg && typeof cfg === 'object' ? cfg : {}
}

function stripSlash(s: string): string {
  return s.replace(/\/+$/, '')
}

export function runtimeConfig(): Required<RuntimeConfig> {
  const w = fromWindow()
  const env = import.meta.env ?? {}
  return {
    apiBase: stripSlash(w.apiBase || env.VITE_API_BASE || 'http://localhost:8081'),
    authority: stripSlash(w.authority || env.VITE_KEYCLOAK_AUTHORITY || 'http://localhost:8080/realms/openapk'),
    installBase: stripSlash(w.installBase || 'https://openbin.ai'),
    selfHosted: Boolean(w.selfHosted),
  }
}

/** `https://openbin.ai/install.sh` on the hosted product, the instance's own copy when self-hosted. */
export function installScriptUrl(name: 'install.sh' | 'install.ps1' | 'install-binny.sh' | 'install-binny.ps1'): string {
  return `${runtimeConfig().installBase}/${name}`
}

export function isSelfHosted(): boolean {
  return runtimeConfig().selfHosted
}
