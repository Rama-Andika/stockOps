/**
 * Semantik UOM (BR-7, PRD 12.4).
 *
 * - qty           : qty diterima DALAM SATUAN PO (dipakai validasi vs pesanan)
 * - uom_id        : satuan stok terkecil (pos_item_master.uom_stock_id)
 * - uom_purchase_id: satuan PO (pos_purchase_item.uom_id)
 * - qty_purchase  : qty dikonversi ke satuan stok (untuk pembukuan stok)
 *
 * Konversi diambil dari pos_vendor_item.conv_qty dengan kunci
 * (vendor_id, item_master_id, uom_purchase). Bila tidak ditemukan, faktor
 * yang dipakai adalah 1 DAN hasilnya ditandai `found = false` agar UI bisa
 * memberi peringatan.
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
 * Mencari faktor konversi conv_qty dengan urutan:
 * 1. exact  : (vendor, item, uom_purchase) cocok
 * 2. vendor-item : (vendor, item) cocok dengan uom apa pun (fallback toleran)
 * 3. default: faktor 1 tanpa data konversi
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

/** Bulatkan qty ke 2 desimal (kolom DB: decimal(10,2)/(22,2)). */

/**
 * Menghitung qty_purchase = qty (satuan PO) x conv_qty.
 * Hasil dibulatkan 2 desimal agar cocok dengan kolom decimal(22,2).
 */
export function computeQtyPurchase(qtyInPoUom: number, convQty: number): number {
  return dec2(toQty(qtyInPoUom) * toQty(convQty))
}
