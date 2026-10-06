import { formatQty } from './format'

/**
 * Pure derivations for the receiving-session screens. This file lives in `shared/` and therefore
 * imports nothing from `client/`: the input shapes below are structural, and the Dexie row types
 * in `client/db/local-db.ts` satisfy them without either side importing the other.
 *
 * Three of these were inline `useMemo` blocks in `client/hooks/use-session-data.ts`. Moving them
 * here is what makes them testable at all: a hook needs a React renderer AND fake-indexeddb,
 * while a pure function needs only `tests/unit/`.
 */

/** What one scanned line contributes. */
export interface SessionLineInput {
  lineId: string
  purchaseItemId: string
  qty: number
}

/**
 * What the PO ordered for one item, and what the server already recorded against it. Both are
 * `string | number | null` because the admin database stores decimals as strings and mysql2
 * hands them back that way.
 */
export interface OrderedItemInput {
  qty: string | number | null
  receivedQty: string | number | null
}

/**
 * Operator-language reason a document was refused, keyed by the code the sync engine stores in
 * `session.failureCode`. The keys are exactly `PERMANENT_REJECT_CODES` in `constants.ts`: a
 * session only ever reaches REJECTED through one of those.
 *
 * Each sentence names what happened AND what it implies, because a rejected document is the one
 * state the operator cannot resolve by pressing send again.
 */
export const REJECTION_REASON: Readonly<Record<string, string>> = {
  PURCHASE_NOT_FOUND: 'PO ini sudah tidak ada di admin.',
  PURCHASE_NOT_CHECKED: 'PO ini sudah ditutup di admin.',
  VALIDATION: 'Isi dokumen ini ditolak server.',
}

/**
 * Falls back to the server's own message, then to a generic line — so a failure code added on the
 * server later still shows the operator something true instead of an empty row.
 */
export function rejectionReasonText(
  failureCode: string | null | undefined,
  lastError: string | null | undefined,
): string {
  const mapped = failureCode ? REJECTION_REASON[failureCode] : undefined
  if (mapped) return mapped
  const fallback = lastError?.trim()
  if (fallback) return fallback
  return 'Dokumen ini ditolak server.'
}

/**
 * Scanned totals per purchase unit, joined — "40 KRT · 6 DUS". Quantities in different units are
 * never added together: one number across mixed UOMs would be meaningless. Units read in order of
 * first appearance, so the one the operator scanned first reads first.
 *
 * Returns an empty string when there are no lines, which is what callers test to decide whether
 * to render the row at all.
 */
export function summarizeQtyByUnit(
  lines: ReadonlyArray<{ qty: number; unit: string }>,
): string {
  const byUnit = new Map<string, number>()
  for (const line of lines) {
    byUnit.set(line.unit, (byUnit.get(line.unit) ?? 0) + line.qty)
  }
  return [...byUnit.entries()].map(([unit, qty]) => `${formatQty(qty)} ${unit}`).join(' · ')
}

/**
 * Excess per PO ITEM, in that item's purchase unit: what the server already holds, plus what this
 * device holds pending, minus what was ordered. Keyed by purchaseItemId because that is the level
 * the order is placed at.
 *
 * It also sums several lines for one item before comparing. Locally that is defensive rather than
 * necessary — `addOrIncrementLine` looks up `[sessionId+purchaseItemId]` and merges into the
 * existing row, so one item is always exactly one line per session. It is kept because the server
 * side (`evaluateSession`) must handle a payload that does contain duplicates, and because a
 * per-line comparison would be wrong the moment that local guarantee changed.
 *
 * Items within their ordered quantity are absent from the map, so `map.size` is the number of
 * over-received items and `map.get(id) ?? 0` is correct for the rest.
 *
 * This is the number `session.excessTotal` does not have before a session is sent: that field is
 * written only by `markSynced`, i.e. after the server answers.
 */
export function excessByPurchaseItem(
  lines: ReadonlyArray<SessionLineInput>,
  ordered: ReadonlyMap<string, OrderedItemInput>,
): Map<string, number> {
  const scanned = totalQtyByPurchaseItem(lines)
  const excess = new Map<string, number>()
  for (const [purchaseItemId, scannedQty] of scanned) {
    const item = ordered.get(purchaseItemId)
    if (!item) continue
    const over = toQty(item.receivedQty) + scannedQty - toQty(item.qty)
    if (over > 0) excess.set(purchaseItemId, over)
  }
  return excess
}

/**
 * Lines belonging to an item that is over-received — every line of such an item, including the
 * ones that did not themselves cross the ordered quantity. The ITEM is what went over; these are
 * the lines that make it up.
 *
 * A Set, not an array: the item list looks this up once per rendered line.
 */
export function overReceivedLineIds(
  lines: ReadonlyArray<SessionLineInput>,
  ordered: ReadonlyMap<string, OrderedItemInput>,
): Set<string> {
  const excess = excessByPurchaseItem(lines, ordered)
  const ids = new Set<string>()
  for (const line of lines) {
    if (excess.has(line.purchaseItemId)) ids.add(line.lineId)
  }
  return ids
}

function totalQtyByPurchaseItem(
  lines: ReadonlyArray<SessionLineInput>,
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const line of lines) {
    totals.set(line.purchaseItemId, (totals.get(line.purchaseItemId) ?? 0) + line.qty)
  }
  return totals
}

/**
 * Deliberately NOT guarded against NaN. The inline versions this replaces compared with `>`, and
 * every comparison against NaN is false, so unparseable admin data left an item UNFLAGGED. A
 * guard that turned NaN into 0 would start flagging those items instead — a behaviour change
 * wearing a refactor's clothes. If the admin data really can be unparseable, that deserves its
 * own decision, not a silent one here.
 */
function toQty(value: string | number | null): number {
  return Number(value ?? 0)
}
