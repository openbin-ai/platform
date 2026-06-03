// Thin wrapper around the shared OIDC config factory. The only thing that
// varies per app is the OIDC client_id — each frontend is registered as its
// own client in the shared Keycloak realm.
import { makeOidcConfig } from '@shared/auth/oidcConfig'

export const oidcConfig = makeOidcConfig({ clientId: 'openapk-frontend' })
