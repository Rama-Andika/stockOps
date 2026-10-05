import { describe, expect, it } from 'vitest'
import { computeQtyPurchase, resolveConvQty, type VendorItemRow } from '~/shared/uom'

const VENDOR = '6000940'
const ITEM = '4022854'
const KARTON = '504404795314333035'
const PCS = '504404793498968532'

const rows: VendorItemRow[] = [
  { vendorId: VENDOR, itemMasterId: ITEM, uomPurchase: KARTON, convQty: '12' },
  { vendorId: VENDOR, itemMasterId: ITEM, uomPurchase: '504404795314357956', convQty: '6' },
  { vendorId: '999', itemMasterId: ITEM, uomPurchase: KARTON, convQty: '5' },
]

describe('resolveConvQty', () => {
  it('menemukan faktor konversi tepat (vendor + item + uom PO)', () => {
    const result = resolveConvQty(rows, {
      vendorId: VENDOR,
      itemMasterId: ITEM,
      uomPurchaseId: KARTON,
    })
    expect(result).toEqual({ convQty: 12, found: true, source: 'exact' })
  })

  it('tidak tertukar dengan vendor lain', () => {
    const result = resolveConvQty(rows, {
      vendorId: VENDOR,
      itemMasterId: ITEM,
      uomPurchaseId: 'tidak-ada',
    })
    // Fall back to any available vendor+item combination
    expect(result.found).toBe(true)
    expect(result.source).toBe('vendor-item')
  })

  it('default faktor 1 bila tidak ada data sama sekali (BR-7)', () => {
    const result = resolveConvQty(rows, {
      vendorId: '404',
      itemMasterId: '404',
      uomPurchaseId: KARTON,
    })
    expect(result).toEqual({ convQty: 1, found: false, source: 'default' })
  })

  it('mengabaikan conv_qty nol/negatif dan memakai default', () => {
    const result = resolveConvQty(
      [{ vendorId: VENDOR, itemMasterId: ITEM, uomPurchase: KARTON, convQty: '0' }],
      { vendorId: VENDOR, itemMasterId: ITEM, uomPurchaseId: KARTON },
    )
    expect(result).toEqual({ convQty: 1, found: false, source: 'default' })
  })
})

describe('computeQtyPurchase', () => {
  it('contoh PRD: 1 karton x conv 12 = 12 pcs', () => {
    expect(computeQtyPurchase(1, 12)).toBe(12)
  })

  it('membulatkan ke 2 desimal', () => {
    expect(computeQtyPurchase(0.333, 3)).toBe(1)
    expect(computeQtyPurchase(1.005, 100)).toBe(100.5)
  })
})
