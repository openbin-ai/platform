import { useEffect, type ReactNode } from 'react'
import { useAuth } from 'react-oidc-context'

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth()

  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated && !auth.error) {
      void auth.signinRedirect()
    }
  }, [auth.isLoading, auth.isAuthenticated, auth.error, auth])

  if (auth.isLoading) {
    return <CenteredMessage>Loading…</CenteredMessage>
  }
  if (auth.error) {
    return (
      <CenteredMessage>
        <div className="text-red-400">Auth error: {auth.error.message}</div>
        <button
          className="mt-4 rounded bg-purple-600 px-4 py-2 hover:bg-purple-500"
          onClick={() => void auth.signinRedirect()}
        >
          Retry login
        </button>
      </CenteredMessage>
    )
  }
  if (!auth.isAuthenticated) {
    return <CenteredMessage>Redirecting to login…</CenteredMessage>
  }
  return <>{children}</>
}

function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-zinc-300">
      <div className="text-center">{children}</div>
    </div>
  )
}
