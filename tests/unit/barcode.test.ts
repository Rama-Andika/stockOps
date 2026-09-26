import { describe, expect, it } from 'vitest'
import { findItemByBarcode, findItemByCode, findItemsByBarcode } from '~/shared/barcode'

const items = [
  {
    itemMasterId: '1',
    code: '48000001',
    barcode: '22001771',
    barcode_2: '899123',
    barcode_3: null,
  },
  {
    itemMasterId: '2',
    code: '48000002',
    barcode: '22001773',
    barcode_2: null,
    barcode_3: 'ALT-2',
  },
  {
    itemMasterId: '3',
    code: '48000003',
    barcode: null,
    barcode_2: null,
    barcode_3: null,
  },
]

describe('barcode matching', () => {
  it('cocok dengan barcode utama', () => {
    expect(findItemByBarcode(items, '22001771')?.itemMasterId).toBe('1')
  })

  it('cocok dengan barcode_2 dan barcode_3', () => {
    expect(findItemByBarcode(items, '899123')?.itemMasterId).toBe('1')
    expect(findItemByBarcode(items, 'ALT-2')?.itemMasterId).toBe('2')
  })

  it('mengabaikan spasi & besar-kecil huruf', () => {
    expect(findItemByBarcode(items, '  alt-2 ')?.itemMasterId).toBe('2')
  })

  it('mengembalikan null bila barcode tidak dikenali', () => {
    expect(findItemByBarcode(items, 'TIDAK-ADA')).toBeNull()
    expect(findItemByBarcode(items, '')).toBeNull()
  })

  it('mengembalikan semua kandidat bila barcode ganda', () => {
    const duplicated = [...items, { ...items[0]!, itemMasterId: '9' }]
    expect(findItemsByBarcode(duplicated, '22001771').map((i) => i.itemMasterId)).toEqual(['1', '9'])
  })

  it('pencarian manual berdasarkan kode (barcode rusak, B-4)', () => {
    expect(findItemByCode(items, '48000003')?.itemMasterId).toBe('3')
    expect(findItemByCode(items, ' 48000003 ')?.itemMasterId).toBe('3')
    expect(findItemByCode(items, 'tidak-ada')).toBeNull()
  })
})
