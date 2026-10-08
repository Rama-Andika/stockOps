/**
 * Financial calculation for receiving documents (pos_receive & pos_receive_item).
 *
 * Rules (aligned with admin website data):
 * - amount             = unit price in PO unit (copied from pos_purchase_item.amount).
 * - discount_amount    = item discount, prorated against received qty.
 * - item total_amount  = received qty x amount - discount_amount.
 * - header total_amount = sum of all item total_amounts.
 * - discount_percent   = copied from pos_purchase.discount_percent.
 * - discount_total     = total_amount x discount_percent / 100.
 * - tax base           = total_amount - discount_total.
 * - total_tax:
 *     price_include_tax = 0 -> tax base x tax_percent / 100
 *     price_include_tax = 1 -> tax base x tax_percent / (100 + tax_percent)
 * - All results rounded to 2 decimals (round half-up) using dec2().
 */

import { dec2 } from '~/core/money/num'

export interface LineFinanceInput {
  /** Received qty (PO unit). */
  qtyReceived: number
  /** Ordered qty on PO item (pos_purchase_item.qty). */
  qtyOrdered: number
  /** Unit price in PO unit (pos_purchase_item.amount). */
  amount: number
  /** Total item discount for full ordered qty (pos_purchase_item.discount_amount). */
  discountAmountOrdered: number
}

export interface LineFinance {
  amount: number
  discountAmount: number
  totalAmount: number
}

/** Calculate finance for a single receiving item line. */
export function computeLineFinance(input: LineFinanceInput): LineFinance {
  const qtyOrdered = input.qtyOrdered > 0 ? input.qtyOrdered : 1
  const amount = dec2(input.amount)
  const discountAmount = dec2((input.discountAmountOrdered * input.qtyReceived) / qtyOrdered)
  const totalAmount = dec2(dec2(input.qtyReceived * amount) - discountAmount)
  return { amount, discountAmount, totalAmount }
}

export interface HeaderFinanceInput {
  /** Sum of all item totalAmount (computed per line). */
  itemsTotalAmount: number
  /** pos_purchase.discount_percent. */
  discountPercent: number
  /** pos_purchase.tax_percent. */
  taxPercent: number
  /** pos_purchase.price_include_tax (0 = price excludes tax, 1 = price includes tax). */
  priceIncludeTax: number
}

export interface HeaderFinance {
  totalAmount: number
  discountPercent: number
  discountTotal: number
  totalTax: number
}

/** Calculate total for receiving document (header). */
export function computeHeaderFinance(input: HeaderFinanceInput): HeaderFinance {
  const totalAmount = dec2(input.itemsTotalAmount)
  const discountPercent = dec2(input.discountPercent)
  const discountTotal = dec2((totalAmount * discountPercent) / 100)
  const taxBase = dec2(totalAmount - discountTotal)
  const divisor = input.priceIncludeTax === 1 ? 100 + input.taxPercent : 100
  const totalTax = dec2((taxBase * input.taxPercent) / divisor)
  return { totalAmount, discountPercent, discountTotal, totalTax }
}
