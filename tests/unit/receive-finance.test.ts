import { describe, expect, it } from 'vitest'
import { computeHeaderFinance, computeLineFinance } from '~/core/money/receive-finance'

describe('computeLineFinance (finansial per baris penerimaan)', () => {
  it('memprorata diskon item sesuai qty diterima (contoh Receive1 admin)', () => {
    const result = computeLineFinance({
      qtyReceived: 2,
      qtyOrdered: 10,
      amount: 100000,
      discountAmountOrdered: 39403.99,
    })
    expect(result.amount).toBe(100000)
    expect(result.discountAmount).toBe(7880.8)
    expect(result.totalAmount).toBe(192119.2)
  })

  it('menghitung tanpa diskon (contoh Receive3 admin)', () => {
    const result = computeLineFinance({
      qtyReceived: 3,
      qtyOrdered: 5,
      amount: 100000,
      discountAmountOrdered: 0,
    })
    expect(result.discountAmount).toBe(0)
    expect(result.totalAmount).toBe(300000)
  })

  it('aman bila qtyOrdered = 0 (tidak membagi dengan nol)', () => {
    const result = computeLineFinance({
      qtyReceived: 2,
      qtyOrdered: 0,
      amount: 1000,
      discountAmountOrdered: 0,
    })
    expect(result.totalAmount).toBe(2000)
  })
})

describe('computeHeaderFinance (total dokumen penerimaan)', () => {
  it('pajak saat harga BELUM termasuk pajak (price_include_tax = 0)', () => {
    const result = computeHeaderFinance({
      itemsTotalAmount: 192119.2,
      discountPercent: 0,
      taxPercent: 11,
      priceIncludeTax: 0,
    })
    expect(result.discountTotal).toBe(0)
    expect(result.totalTax).toBe(21133.11)
  })

  it('diskon mengurangi dasar pajak (contoh Receive2 admin)', () => {
    const result = computeHeaderFinance({
      itemsTotalAmount: 194059.8,
      discountPercent: 1,
      taxPercent: 11,
      priceIncludeTax: 0,
    })
    // Round half-up yields 1940.60; admin data is 1940.59 (difference of ±1 cent is accepted).
    expect(result.discountTotal).toBe(1940.6)
    expect(result.totalTax).toBe(21133.11)
  })

  it('pajak saat harga SUDAH termasuk pajak (price_include_tax = 1)', () => {
    const result = computeHeaderFinance({
      itemsTotalAmount: 300000,
      discountPercent: 0,
      taxPercent: 11,
      priceIncludeTax: 1,
    })
    // Round half-up yields 29729.73; admin data is 29729.72 (difference of ±1 cent is accepted).
    expect(result.totalTax).toBe(29729.73)
  })

  it('kombinasi diskon + price_include_tax = 1 memakai angka bersih', () => {
    const result = computeHeaderFinance({
      itemsTotalAmount: 5000,
      discountPercent: 10,
      taxPercent: 25,
      priceIncludeTax: 1,
    })
    expect(result.discountTotal).toBe(500)
    expect(result.totalTax).toBe(900)
  })
})
