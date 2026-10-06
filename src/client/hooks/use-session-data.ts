import { useMemo } from 'react'
import { localRepo } from '~/client/db/local-repo'
import { useLive } from './use-live'
import { formatQty } from '~/shared/format'

/**
 * Everything the two session screens read out of Dexie: the receiving cockpit
 * (routes/sessions/$sessionId.tsx) and the review step (routes/sessions/review.$sessionId.tsx).
 * Extracted rather than copied because both need the same live queries and the same derived maps,
 * and a second copy would drift apart silently.
 *
 * Every read goes through `useLive`, so this hook is safe during SPA prerender in Node, where
 * there is no IndexedDB at all.
 */
export function useSessionData(sessionId: string) {
  const session = useLive(() => localRepo.getSession(sessionId), [sessionId], undefined)
  const lines = useLive(() => localRepo.sessionItems(sessionId), [sessionId], [])
  const purchaseItems = useLive(
    async () => {
      return session ? localRepo.getPurchaseItems(session.purchaseId) : []
    },
    [session?.purchaseId],
    [],
  )
  const itemIds = useMemo(
    () => [...new Set(lines.map((line) => line.itemMasterId))].sort(),
    [lines],
  )
  const itemIdsKey = useMemo(() => JSON.stringify(itemIds), [itemIds])
  const items = useLive(
    async () => {
      if (itemIds.length === 0) return {}
      const entries = await Promise.all(
        itemIds.map(async (id) => [id, await localRepo.getItemMaster(id)] as const),
      )
      return Object.fromEntries(entries) as Record<string, { name: string; code: string | null } | undefined>
    },
    [itemIdsKey],
    {},
  )
  const units = useLive(() => localRepo.db.units.toArray(), [], [])
  const purchaseProgress = useLive(
    async () => (session ? localRepo.getPurchaseProgress(session.purchaseId) : null),
    [session?.purchaseId],
    null,
  )

  const purchaseItemMap = useMemo(
    () => new Map(purchaseItems.map((row) => [row.purchaseItemId, row])),
    [purchaseItems],
  )
  const unitMap = useMemo(() => new Map(units.map((row) => [row.uomId, row.unit])), [units])

  const overLineIds = useMemo(() => {
    const qtyByPurchaseItem = new Map<string, number>()
    for (const line of lines) {
      qtyByPurchaseItem.set(
        line.purchaseItemId,
        (qtyByPurchaseItem.get(line.purchaseItemId) ?? 0) + line.qty,
      )
    }
    // A Set, not an array: the item list looks this up once per rendered line.
    const overLineIds = new Set<string>()
    for (const line of lines) {
      const purchaseItem = purchaseItemMap.get(line.purchaseItemId)
      if (!purchaseItem) continue
      const received = Number(purchaseItem.receivedQty ?? 0)
      const localQty = qtyByPurchaseItem.get(line.purchaseItemId) ?? 0
      if (received + localQty > Number(purchaseItem.qty ?? 0)) overLineIds.add(line.lineId)
    }
    return overLineIds
  }, [lines, purchaseItemMap])

  /**
   * Excess per PO ITEM, in that item's purchase unit: what the server already has, plus what this
   * device holds pending, minus what was ordered. Keyed by purchaseItemId and not by lineId
   * because the order is placed per PO item — two lines for one item share a single excess, so
   * keying by line would report it twice.
   *
   * This is the number `session.excessTotal` does NOT have before a session is sent: that field
   * is written only by `markSynced` (local-repo.ts), i.e. after the server answers.
   */
  const excessByPurchaseItem = useMemo(() => {
    const qtyByPurchaseItem = new Map<string, number>()
    for (const line of lines) {
      qtyByPurchaseItem.set(
        line.purchaseItemId,
        (qtyByPurchaseItem.get(line.purchaseItemId) ?? 0) + line.qty,
      )
    }
    const excess = new Map<string, number>()
    for (const [purchaseItemId, localQty] of qtyByPurchaseItem) {
      const purchaseItem = purchaseItemMap.get(purchaseItemId)
      if (!purchaseItem) continue
      const over = Number(purchaseItem.receivedQty ?? 0) + localQty - Number(purchaseItem.qty ?? 0)
      if (over > 0) excess.set(purchaseItemId, over)
    }
    return excess
  }, [lines, purchaseItemMap])

  /**
   * What was counted, totalled PER PURCHASE UNIT and joined — "40 KRT · 6 DUS". Units are never
   * added together: a single number across mixed UOMs would be meaningless, which is also why
   * the progress meter is the only place a cross-unit figure appears (there it is a ratio).
   */
  const qtySummary = useMemo(() => {
    const byUnit = new Map<string, number>()
    for (const line of lines) {
      const unit = unitMap.get(line.uomPurchaseId) ?? line.uomPurchaseId
      byUnit.set(unit, (byUnit.get(unit) ?? 0) + line.qty)
    }
    return [...byUnit.entries()].map(([unit, qty]) => `${formatQty(qty)} ${unit}`).join(' · ')
  }, [lines, unitMap])

  return {
    session,
    lines,
    items,
    purchaseItemMap,
    unitMap,
    purchaseProgress,
    overLineIds,
    excessByPurchaseItem,
    qtySummary,
  }
}
