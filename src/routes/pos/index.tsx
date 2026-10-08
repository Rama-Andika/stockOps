import { createFileRoute } from '@tanstack/react-router'
import { PoList } from '~/features/purchase-orders/po-list'

export const Route = createFileRoute('/pos/')({
  component: PoList,
})
