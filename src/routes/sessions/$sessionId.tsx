import { createFileRoute } from '@tanstack/react-router'
import { SessionCockpit } from '~/features/receiving/cockpit/session-cockpit'

export const Route = createFileRoute('/sessions/$sessionId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { sessionId } = Route.useParams()
  return <SessionCockpit sessionId={sessionId} />
}
