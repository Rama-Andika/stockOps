import { createFileRoute } from '@tanstack/react-router'
import { PoDetail } from '~/features/purchase-orders/po-detail'

export const Route = createFileRoute('/pos/$purchaseId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { purchaseId } = Route.useParams()
  return <PoDetail purchaseId={purchaseId} />
}
