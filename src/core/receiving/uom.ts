/**
 * Unit-of-measure semantics of a receiving line.
 *
 * The operator always enters qty in the PO unit (a carton), never in the smallest stock unit
 * (a piece), because the PO is what they are checking the delivery against. The columns
 * written to pos_receive_item keep the two worlds apart:
 *
 * - qty             : received qty IN PO UNITS — the only figure compared against the order
 * - uom_id          : smallest stock unit (pos_item_master.uom_stock_id)
 * - uom_purchase_id : the PO unit (pos_purchase_item.uom_id)
 * - qty_purchase    : the conversion FACTOR itself (conv_qty), not qty x factor
 * - conv_unit       : always 1 — the numerator of "1 PO unit = conv_qty stock units"
 *
 * qty_purchase holding a ratio rather than a product is the easiest thing to get wrong here:
 * with 1 carton = 12 pcs it is 12 whether the operator received 1 carton or 40. Admin's stock
 * accounting does the multiplication itself.
 *
 * The factor comes from pos_vendor_item.conv_qty keyed by (vendor_id, item_master_id,
 * uom_purchase). A vendor item with no usable conversion row falls back to factor 1 and is
 * flagged `found: false`, so the UI can warn instead of silently booking a carton as a piece.
 */

import { dec2 } from '~/core/money/num'

export { dec2 }

export interface VendorItemRow {
  vendorId: string
  itemMasterId: string
  uomPurchase: string
  convQty: string | number
}

export interface ConvKey {
  vendorId: string
  itemMasterId: string
  uomPurchaseId: string
}

export type ConvSource = 'exact' | 'vendor-item' | 'default'

export interface ConvResult {
  convQty: number
  found: boolean
  source: ConvSource
}

function toQty(value: string | number): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Resolves conv_qty conversion factor in order of priority:
 * 1. exact  : (vendor, item, uom_purchase) matches
 * 2. vendor-item : (vendor, item) matches with any uom (tolerant fallback)
 * 3. default: factor 1 without conversion data
 */
export function resolveConvQty(rows: readonly VendorItemRow[], key: ConvKey): ConvResult {
  const samePair = rows.filter(
    (row) => row.vendorId === key.vendorId && row.itemMasterId === key.itemMasterId,
  )

  const exact = samePair.find((row) => row.uomPurchase === key.uomPurchaseId)
  if (exact) {
    const convQty = toQty(exact.convQty)
    if (convQty > 0) return { convQty, found: true, source: 'exact' }
  }

  const fallback = samePair.find((row) => toQty(row.convQty) > 0)
  if (fallback) {
    return { convQty: toQty(fallback.convQty), found: true, source: 'vendor-item' }
  }

  return { convQty: 1, found: false, source: 'default' }
}

/**
 * The received quantity expressed in stock units: qty (PO unit) x conv_qty, rounded to 2
 * decimals to match the decimal(22,2) columns.
 *
 * Careful: this is NOT what sync writes into qty_purchase — that column stores the bare
 * conversion factor, see the module header. Nothing in the app writes this value today; it is
 * kept as the single definition of the stock-unit total, and tests/unit/uom.test.ts locks its
 * rounding.
 */
export function computeQtyPurchase(qtyInPoUom: number, convQty: number): number {
  return dec2(toQty(qtyInPoUom) * toQty(convQty))
}
