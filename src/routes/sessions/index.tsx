import { createFileRoute } from '@tanstack/react-router'
import { SessionList } from '~/features/receiving/session/session-list'

export const Route = createFileRoute('/sessions/')({
  component: SessionList,
})
