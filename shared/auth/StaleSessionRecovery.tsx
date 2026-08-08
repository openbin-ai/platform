import { useEffect, useRef } from 'react'
import { useAuth } from 'react-oidc-context'

/**
 * Repairs a zombie session on app load.
 *
 * The OIDC user is persisted in localStorage (see oidcConfig.ts), so a
 * returning visitor can rehydrate a user whose access token expired while the
 * browser was closed — automaticSilentRenew only runs while a tab is open.
 * Left alone, the UI renders as "signed in" while every API call fails.
 *
 * On mount, if the rehydrated user is expired: try one silent renew (uses the
 * refresh token when present, else the Keycloak SSO cookie via iframe). If
 * that fails — refresh token expired, SSO session gone, or third-party
 * cookies blocked (Firefox ETP) — drop the stale user so the app honestly
 * shows signed-out instead of a zombie session.
 *
 * Renders nothing; mount once directly inside AuthProvider.
 */
export function StaleSessionRecovery() {
  const auth = useAuth()
  // One attempt per page load — also guards StrictMode's double effect run.
  const attempted = useRef(false)

  useEffect(() => {
    if (attempted.current) return
    if (auth.isLoading || auth.activeNavigator) return
    if (!auth.user?.expired) return
    attempted.current = true
    auth
      .signinSilent()
      // signinSilent can resolve null instead of throwing when no renewal
      // path exists — treat that as failure too.
      .then((user) => (user ? undefined : auth.removeUser()))
      .catch(() => auth.removeUser())
  }, [auth])

  return null
}
