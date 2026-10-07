import { clampNonNegative, dec2 } from './num'

/**
 * The PO item list behind "Pilih item dari daftar PO" — shaped the way the picker needs it, and
 * nothing more.
 *
 * It lives in `src/shared/` and imports nothing from `client/`: the input types below are
 * structural, so the Dexie row types satisfy them without either side importing the other — the
 * same arrangement as `session-view.ts`. Unit names arrive through a `unitOf` callback for the same
 * reason: the unit table is Dexie data, and this file must not know it exists.
 */

/** One PO line as the picker shows it. Every qty is in the PO unit of that line. */
export interface PickerItem {
  purchaseItemId: string
  itemMasterId: string
  /** Item name, or the raw `itemMasterId` when the master row is missing from this device. */
  name: string
  code: string | null
  /** `barcode`, `barcode_2`, `barcode_3`. Nulls are kept so the search can simply skip them. */
  barcodes: ReadonlyArray<string | null>
  /** PO unit label, already resolved (e.g. "KRT"), or the raw uomId when it is unknown. */
  unit: string
  orderedQty: number
  /** What the server has already counted for this PO line. */
  serverReceivedQty: number
  /** What THIS session holds for this PO line. */
  sessionQty: number
  /** What other unsent sessions on this device hold for it — a colleague's, or an older own one. */
  otherSessionQty: number
  /** True when this session's line for the item ever received qty without a scan. */
  sessionPickedManually: boolean
  /**
   * False when the item master row is missing from this device. Such a line CANNOT be added: the
   * stock unit of a session line comes from `pos_item_master.uom_stock_id`, so without the master
   * row there is no honest `uomId` to store. The picker shows it, disabled, with the reason — it
   * does not hide it, because a line that silently disappears reads as "not part of this PO".
   */
  selectable: boolean
}

/** One PO line as it comes out of `localRepo.getPurchaseDetail`. */
export interface PickerSourceRow {
  purchaseItemId: string
  itemMasterId: string
  uomId: string
  orderedQty: number
  serverReceivedQty: number
  /** Unsent qty from EVERY session on this device, this one included — see `buildPickerItems`. */
  localPendingQty: number
  item?: {
    name: string
    code: string | null
    barcode: string | null
    barcode2: string | null
    barcode3: string | null
  }
}

/** One line of the session being filled. */
export interface PickerSourceLine {
  purchaseItemId: string
  qty: number
  pickedManually: boolean
}

/** Everything counted for a PO line: the server's number plus every unsent session on this device. */
export function pickerTotalReceived(row: PickerItem): number {
  return dec2(row.serverReceivedQty + row.sessionQty + row.otherSessionQty)
}

/**
 * "Nothing is outstanding on this line any more."
 *
 * Deliberately the same shape as `allItemsFull` on the PO detail screen
 * (`src/routes/pos/$purchaseId.tsx`): received >= ordered, with the finiteness guards, so the two
 * screens cannot disagree about which lines are done.
 *
 * A complete line is NOT hidden and NOT disabled. Over-receive is flagged, never rejected (BR-5),
 * and a second delivery against a line that already looks full is exactly the case an operator has
 * to be able to record. It only sinks to the bottom of the list.
 */
export function isPickerItemComplete(row: PickerItem): boolean {
  const received = pickerTotalReceived(row)
  if (!Number.isFinite(received) || !Number.isFinite(row.orderedQty)) return false
  return received >= row.orderedQty
}

/**
 * Lines that still need something first, finished lines last, each group keeping the order it came
 * in — which is the PO's own order, the same order as the "Item PO" card on the PO detail screen
 * and as the vendor's delivery note.
 *
 * Two buckets instead of a comparator. `Array.prototype.sort` stability is guaranteed by the spec,
 * but a comparator that reads "complete minus complete" is one sign flip away from scrambling a
 * thirty-line PO into an order that matches no piece of paper in the operator's hand, and nobody
 * would catch that in review.
 */
export function sortPickerItems(rows: readonly PickerItem[]): PickerItem[] {
  const pending: PickerItem[] = []
  const done: PickerItem[] = []
  for (const row of rows) {
    if (isPickerItemComplete(row)) done.push(row)
    else pending.push(row)
  }
  return [...pending, ...done]
}

/**
 * Case-insensitive "contains" over the name, the item code and all three barcodes.
 *
 * The barcodes are in here on purpose, even though the cockpit's scan field already accepts a typed
 * item code and an exact barcode (`getItemByBarcodeOrCode` falls back to `code`, B-4). That one is
 * an EXACT match against the whole master table; this one is a PARTIAL match against the twenty
 * lines of one PO. An operator who can still read four digits off a torn label finds the line here;
 * in the scan field those four digits are simply "not recognised".
 */
export function filterPickerItems(rows: readonly PickerItem[], term: string): PickerItem[] {
  const needle = term.trim().toLowerCase()
  if (!needle) return [...rows]
  return rows.filter((row) =>
    [row.name, row.code, ...row.barcodes].some(
      (value) => typeof value === 'string' && value.toLowerCase().includes(needle),
    ),
  )
}

/**
 * Builds the picker's rows out of a PO's lines and the session being filled.
 *
 * The one subtle part is `otherSessionQty`. `localPendingQty` comes from `getPurchaseProgress`,
 * which sums EVERY session on this device that is neither SYNCED nor REJECTED — a colleague's
 * running session for the same PO included. The picker must never show that number as "sudah di
 * sesi ini", because the qty panel ADDS to what the session already holds and the operator would
 * then be typing against somebody else's count. So this session's own total is subtracted out and
 * reported separately.
 *
 * `clampNonNegative` guards the one case where that subtraction can go negative: a `lines` snapshot
 * that is one Dexie tick ahead of the `localPendingQty` snapshot, which is normal with two live
 * queries.
 *
 * `sessionPickedManually` is true when ANY line of this session for that PO item carries the flag.
 * In practice there is at most one such line — `addOrIncrementLine` merges them — but it is written
 * as "any" so a future second line cannot silently drop the flag.
 */
export function buildPickerItems(
  rows: readonly PickerSourceRow[],
  lines: readonly PickerSourceLine[],
  unitOf: (uomId: string) => string,
): PickerItem[] {
  const sessionQty = new Map<string, number>()
  const sessionPicked = new Map<string, boolean>()
  for (const line of lines) {
    sessionQty.set(line.purchaseItemId, dec2((sessionQty.get(line.purchaseItemId) ?? 0) + line.qty))
    if (line.pickedManually) sessionPicked.set(line.purchaseItemId, true)
  }

  return rows.map((row) => {
    const mine = sessionQty.get(row.purchaseItemId) ?? 0
    return {
      purchaseItemId: row.purchaseItemId,
      itemMasterId: row.itemMasterId,
      name: row.item?.name ?? row.itemMasterId,
      code: row.item?.code ?? null,
      barcodes: [row.item?.barcode ?? null, row.item?.barcode2 ?? null, row.item?.barcode3 ?? null],
      unit: unitOf(row.uomId),
      orderedQty: row.orderedQty,
      serverReceivedQty: row.serverReceivedQty,
      sessionQty: mine,
      otherSessionQty: clampNonNegative(dec2(row.localPendingQty - mine)),
      sessionPickedManually: sessionPicked.get(row.purchaseItemId) ?? false,
      selectable: Boolean(row.item),
    }
  })
}
