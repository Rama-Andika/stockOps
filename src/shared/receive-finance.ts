/**
 * Perhitungan finansial dokumen penerimaan (pos_receive & pos_receive_item).
 *
 * Aturan (diselaraskan dengan data website admin):
 * - amount             = harga satuan dalam satuan PO (disalin dari pos_purchase_item.amount).
 * - discount_amount    = diskon item, diprorata terhadap qty yang diterima.
 * - total_amount item  = qty diterima x amount - discount_amount.
 * - total_amount header = jumlah seluruh total_amount item.
 * - discount_percent   = disalin dari pos_purchase.discount_percent.
 * - discount_total     = total_amount x discount_percent / 100.
 * - dasar pajak        = total_amount - discount_total.
 * - total_tax:
 *     price_include_tax = 0 -> dasar pajak x tax_percent / 100
 *     price_include_tax = 1 -> dasar pajak x tax_percent / (100 + tax_percent)
 * - Semua hasil dibulatkan 2 desimal (round half-up) memakai dec2().
 */

import { dec2 } from './num'

export interface LineFinanceInput {
  /** Qty diterima (satuan PO). */
  qtyReceived: number
  /** Qty dipesan pada item PO (pos_purchase_item.qty). */
  qtyOrdered: number
  /** Harga satuan dalam satuan PO (pos_purchase_item.amount). */
  amount: number
  /** Total diskon item untuk qty pesanan penuh (pos_purchase_item.discount_amount). */
  discountAmountOrdered: number
}

export interface LineFinance {
  amount: number
  discountAmount: number
  totalAmount: number
}

/** Hitung finansial satu baris item penerimaan. */
export function computeLineFinance(input: LineFinanceInput): LineFinance {
  const qtyOrdered = input.qtyOrdered > 0 ? input.qtyOrdered : 1
  const amount = dec2(input.amount)
  const discountAmount = dec2((input.discountAmountOrdered * input.qtyReceived) / qtyOrdered)
  const totalAmount = dec2(dec2(input.qtyReceived * amount) - discountAmount)
  return { amount, discountAmount, totalAmount }
}

export interface HeaderFinanceInput {
  /** Jumlah seluruh totalAmount item (hasil komputasi per baris). */
  itemsTotalAmount: number
  /** pos_purchase.discount_percent. */
  discountPercent: number
  /** pos_purchase.tax_percent. */
  taxPercent: number
  /** pos_purchase.price_include_tax (0 = harga belum termasuk pajak, 1 = sudah termasuk). */
  priceIncludeTax: number
}

export interface HeaderFinance {
  totalAmount: number
  discountPercent: number
  discountTotal: number
  totalTax: number
}

/** Hitung total dokumen penerimaan (header). */
export function computeHeaderFinance(input: HeaderFinanceInput): HeaderFinance {
  const totalAmount = dec2(input.itemsTotalAmount)
  const discountPercent = dec2(input.discountPercent)
  const discountTotal = dec2((totalAmount * discountPercent) / 100)
  const taxBase = dec2(totalAmount - discountTotal)
  const divisor = input.priceIncludeTax === 1 ? 100 + input.taxPercent : 100
  const totalTax = dec2((taxBase * input.taxPercent) / divisor)
  return { totalAmount, discountPercent, discountTotal, totalTax }
}
