import { useNavigate, useParams } from 'react-router-dom'
import { MessagesPage } from '@shared/components/dm/MessagesPage'

// Direct messages. The page itself is shared (DMs are user-level, the same
// conversation shows on openbin and openapk); this wrapper only maps the
// route param to the active conversation and navigation back to the router.
export function Messages() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  return (
    <MessagesPage
      activeId={id ?? null}
      accent="amber"
      onOpen={(cid) => navigate(cid ? `/messages/${cid}` : '/messages')}
    />
  )
}
