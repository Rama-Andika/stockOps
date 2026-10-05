/**
 * UOM semantics (BR-7, PRD 12.4).
 *
 * - qty           : received qty IN PO UNITS (used for validation vs order)
 * - uom_id        : smallest stock unit (pos_item_master.uom_stock_id)
 * - uom_purchase_id: PO unit (pos_purchase_item.uom_id)
 * - qty_purchase  : qty converted to stock units (for stock accounting)
 *
 * Conversion is retrieved from pos_vendor_item.conv_qty using key
 * (vendor_id, item_master_id, uom_purchase). If not found, the factor
 * used is 1 AND the result is flagged `found = false` so the UI can
 * display a warning.
 */

import { dec2 } from './num'

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

/** Round qty to 2 decimals (DB column: decimal(10,2)/(22,2)). */

/**
 * Computes qty_purchase = qty (PO unit) x conv_qty.
 * Result is rounded to 2 decimals to match the decimal(22,2) column.
 */
export function computeQtyPurchase(qtyInPoUom: number, convQty: number): number {
  return dec2(toQty(qtyInPoUom) * toQty(convQty))
}
