import type { AuthProviderProps } from 'react-oidc-context'
import { WebStorageStateStore } from 'oidc-client-ts'

/**
 * Build an OIDC config for either openapk-frontend or openbin-frontend.
 *
 * Both apps share the same Keycloak realm (`openapk`) and the same backend,
 * so the only thing that varies is the {@link clientId} — each frontend is
 * registered as its own OIDC client in Keycloak.
 *
 * Authority defaults to the local dev Keycloak; override via env when we
 * deploy.
 */
export type OidcConfigOptions = {
  clientId: string
  authority?: string
}

export function makeOidcConfig({
  clientId,
  authority = import.meta.env.VITE_KEYCLOAK_AUTHORITY ?? 'http://localhost:8080/realms/openapk',
}: OidcConfigOptions): AuthProviderProps {
  return {
    authority,
    client_id: clientId,
    redirect_uri: `${window.location.origin}/`,
    post_logout_redirect_uri: `${window.location.origin}/`,
    response_type: 'code',
    scope: 'openid profile email',
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    onSigninCallback: () => {
      window.history.replaceState({}, document.title, window.location.pathname)
    },
  }
}
