import { describe, expect, it } from 'vitest'
import {
  excessByPurchaseItem,
  overReceivedLineIds,
  rejectionReasonText,
  summarizeQtyByUnit,
  type OrderedItemInput,
} from '~/shared/session-view'

/** The admin DB hands decimals back as strings, so the fixtures use strings on purpose. */
function ordered(entries: Array<[string, string, string]>): Map<string, OrderedItemInput> {
  return new Map(entries.map(([id, qty, receivedQty]) => [id, { qty, receivedQty }]))
}

describe('rejectionReasonText', () => {
  it('menerjemahkan ketiga kode penolakan permanen ke bahasa operator', () => {
    expect(rejectionReasonText('PURCHASE_NOT_CHECKED', 'PO is not CHECKED')).toBe(
      'PO ini sudah ditutup di admin.',
    )
    expect(rejectionReasonText('PURCHASE_NOT_FOUND', null)).toBe('PO ini sudah tidak ada di admin.')
    expect(rejectionReasonText('VALIDATION', null)).toBe('Isi dokumen ini ditolak server.')
  })

  it('kode yang tidak dikenal memakai pesan server apa adanya', () => {
    expect(rejectionReasonText('SOMETHING_NEW', '  Vendor mismatch  ')).toBe('Vendor mismatch')
  })

  it('tanpa kode dan tanpa pesan, tetap mengembalikan kalimat yang bisa dibaca', () => {
    expect(rejectionReasonText(null, null)).toBe('Dokumen ini ditolak server.')
    expect(rejectionReasonText(null, '   ')).toBe('Dokumen ini ditolak server.')
    expect(rejectionReasonText(undefined, undefined)).toBe('Dokumen ini ditolak server.')
  })
})

describe('summarizeQtyByUnit', () => {
  it('menjumlahkan per satuan dan TIDAK mencampur satuan', () => {
    expect(
      summarizeQtyByUnit([
        { qty: 10, unit: 'KRT' },
        { qty: 4, unit: 'DUS' },
        { qty: 30, unit: 'KRT' },
      ]),
    ).toBe('40 KRT · 4 DUS')
  })

  it('urutannya mengikuti kemunculan pertama, bukan abjad', () => {
    expect(
      summarizeQtyByUnit([
        { qty: 1, unit: 'ZAK' },
        { qty: 1, unit: 'BOX' },
      ]),
    ).toBe('1 ZAK · 1 BOX')
  })

  it('tanpa baris, mengembalikan string kosong', () => {
    expect(summarizeQtyByUnit([])).toBe('')
  })

  it('memformat desimal lewat formatQty (lokal id-ID)', () => {
    expect(summarizeQtyByUnit([{ qty: 2.5, unit: 'KRT' }])).toBe('2,5 KRT')
  })
})

describe('excessByPurchaseItem', () => {
  it('tidak mencatat item yang masih di dalam pesanan', () => {
    const result = excessByPurchaseItem(
      [{ lineId: 'L1', purchaseItemId: 'PI1', qty: 4 }],
      ordered([['PI1', '10', '0']]),
    )
    expect(result.size).toBe(0)
  })

  it('menjumlahkan beberapa baris untuk SATU item sebelum membandingkan', () => {
    // 6 + 6 = 12 terhadap pesanan 10 → kelebihan 2, dicatat SEKALI per item.
    const result = excessByPurchaseItem(
      [
        { lineId: 'L1', purchaseItemId: 'PI1', qty: 6 },
        { lineId: 'L2', purchaseItemId: 'PI1', qty: 6 },
      ],
      ordered([['PI1', '10', '0']]),
    )
    expect(result.size).toBe(1)
    expect(result.get('PI1')).toBe(2)
  })

  it('memperhitungkan qty yang sudah tercatat di server', () => {
    // Server sudah punya 8, perangkat menambah 5, pesanan 10 → kelebihan 3.
    const result = excessByPurchaseItem(
      [{ lineId: 'L1', purchaseItemId: 'PI1', qty: 5 }],
      ordered([['PI1', '10', '8']]),
    )
    expect(result.get('PI1')).toBe(3)
  })

  it('tepat sama dengan pesanan BUKAN kelebihan', () => {
    const result = excessByPurchaseItem(
      [{ lineId: 'L1', purchaseItemId: 'PI1', qty: 10 }],
      ordered([['PI1', '10', '0']]),
    )
    expect(result.size).toBe(0)
  })

  // Kedua test di bawah memaku perilaku yang sampai sekarang hanya dijaga komentar di `toQty`:
  // qty yang tidak bisa diparse membuat perbandingannya NaN, dan NaN > 0 selalu false, jadi
  // itemnya TIDAK ditandai. Menambahkan "penjagaan" seperti `Number(v) || 0` akan mengubahnya
  // menjadi pesanan 0 — sehingga setiap scan item itu jadi kelebihan terima — tanpa satu pun
  // test lain gagal.
  it('qty pesanan yang tidak bisa diparse TIDAK ditandai kelebihan', () => {
    const result = excessByPurchaseItem(
      [{ lineId: 'L1', purchaseItemId: 'PI1', qty: 99 }],
      ordered([['PI1', 'abc', '0']]),
    )
    expect(result.size).toBe(0)
  })

  it('receivedQty yang tidak bisa diparse TIDAK ditandai kelebihan', () => {
    const result = excessByPurchaseItem(
      [{ lineId: 'L1', purchaseItemId: 'PI1', qty: 99 }],
      ordered([['PI1', '10', 'abc']]),
    )
    expect(result.size).toBe(0)
  })

  it('qty pesanan string kosong tetap dibaca sebagai 0, seperti versi lama', () => {
    // `Number('' ?? 0)` adalah 0, bukan NaN — jadi di sini kelebihannya memang nyata.
    const result = excessByPurchaseItem(
      [{ lineId: 'L1', purchaseItemId: 'PI1', qty: 5 }],
      ordered([['PI1', '', '0']]),
    )
    expect(result.get('PI1')).toBe(5)
  })

  it('baris yang itemnya tidak ada di PO diabaikan, bukan dianggap kelebihan', () => {
    const result = excessByPurchaseItem(
      [{ lineId: 'L1', purchaseItemId: 'HILANG', qty: 99 }],
      ordered([['PI1', '10', '0']]),
    )
    expect(result.size).toBe(0)
  })

  it('size-nya adalah jumlah item yang kelebihan — angka yang dipakai callout review', () => {
    const result = excessByPurchaseItem(
      [
        { lineId: 'L1', purchaseItemId: 'PI1', qty: 12 },
        { lineId: 'L2', purchaseItemId: 'PI2', qty: 20 },
        { lineId: 'L3', purchaseItemId: 'PI3', qty: 1 },
      ],
      ordered([
        ['PI1', '10', '0'],
        ['PI2', '10', '0'],
        ['PI3', '10', '0'],
      ]),
    )
    expect(result.size).toBe(2)
  })
})

describe('overReceivedLineIds', () => {
  it('menandai SEMUA baris milik item yang kelebihan, bukan hanya yang melampaui', () => {
    // L1 sendiri (6) masih di bawah pesanan 10; itemnya yang kelebihan, jadi keduanya ditandai.
    const result = overReceivedLineIds(
      [
        { lineId: 'L1', purchaseItemId: 'PI1', qty: 6 },
        { lineId: 'L2', purchaseItemId: 'PI1', qty: 6 },
      ],
      ordered([['PI1', '10', '0']]),
    )
    expect([...result].sort()).toEqual(['L1', 'L2'])
  })

  it('tidak menandai baris dari item yang masih di dalam pesanan', () => {
    const result = overReceivedLineIds(
      [
        { lineId: 'L1', purchaseItemId: 'PI1', qty: 12 },
        { lineId: 'L2', purchaseItemId: 'PI2', qty: 3 },
      ],
      ordered([
        ['PI1', '10', '0'],
        ['PI2', '10', '0'],
      ]),
    )
    expect([...result]).toEqual(['L1'])
  })

  it('tanpa baris, mengembalikan Set kosong', () => {
    expect(overReceivedLineIds([], ordered([['PI1', '10', '0']])).size).toBe(0)
  })
})
