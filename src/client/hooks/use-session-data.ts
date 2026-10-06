import { useMemo } from 'react'
import { localRepo } from '~/client/db/local-repo'
import { useLive } from './use-live'
import {
  excessByPurchaseItem as excessByItem,
  overReceivedLineIds,
  summarizeQtyByUnit,
} from '~/shared/session-view'

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

  // Both derivations live in src/shared/session-view.ts so they can be unit-tested without a
  // React renderer. The memo wrappers stay: `lines` and `purchaseItemMap` change once per scan,
  // and the cockpit re-renders on every character the scanner types.
  const overLineIds = useMemo(
    () => overReceivedLineIds(lines, purchaseItemMap),
    [lines, purchaseItemMap],
  )

  const excessByPurchaseItem = useMemo(
    () => excessByItem(lines, purchaseItemMap),
    [lines, purchaseItemMap],
  )

  // The unit is resolved here, not inside the pure function: `unitMap` is Dexie data and
  // src/shared/ must not know about it.
  const qtySummary = useMemo(
    () =>
      summarizeQtyByUnit(
        lines.map((line) => ({
          qty: line.qty,
          unit: unitMap.get(line.uomPurchaseId) ?? line.uomPurchaseId,
        })),
      ),
    [lines, unitMap],
  )

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
