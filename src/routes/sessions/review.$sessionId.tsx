import { createFileRoute } from '@tanstack/react-router'
import { SessionReview } from '~/features/receiving/review/session-review'

export const Route = createFileRoute('/sessions/review/$sessionId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { sessionId } = Route.useParams()
  return <SessionReview sessionId={sessionId} />
}
