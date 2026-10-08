import { createFileRoute } from '@tanstack/react-router'
import { OverReceiveWorklist } from '~/features/receiving/over-receive/over-receive-worklist'

export const Route = createFileRoute('/over-receive')({
  component: OverReceiveWorklist,
})
