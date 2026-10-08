import { describe, expect, it } from 'vitest'
import {
  buildPickerItems,
  filterPickerItems,
  isPickerItemComplete,
  pickerTotalReceived,
  sortPickerItems,
  type PickerItem,
  type PickerSourceRow,
} from '~/features/receiving/logic/item-picker'

const UNITS: Record<string, string> = { 'U-KRT': 'KRT', 'U-PCS': 'PCS' }
const unitOf = (uomId: string): string => UNITS[uomId] ?? uomId

function sourceRow(overrides: Partial<PickerSourceRow> = {}): PickerSourceRow {
  return {
    purchaseItemId: 'PI1',
    itemMasterId: 'IM1',
    uomId: 'U-KRT',
    orderedQty: 40,
    serverReceivedQty: 0,
    localPendingQty: 0,
    item: {
      name: 'MINYAK GORENG 2L',
      code: '48000123',
      barcode: '8991002103458',
      barcode2: null,
      barcode3: null,
    },
    ...overrides,
  }
}

function pickerItem(overrides: Partial<PickerItem> = {}): PickerItem {
  return {
    purchaseItemId: 'PI1',
    itemMasterId: 'IM1',
    name: 'MINYAK GORENG 2L',
    code: '48000123',
    barcodes: ['8991002103458', null, null],
    unit: 'KRT',
    orderedQty: 40,
    serverReceivedQty: 0,
    sessionQty: 0,
    otherSessionQty: 0,
    sessionPickedManually: false,
    selectable: true,
    ...overrides,
  }
}

describe('buildPickerItems', () => {
  it('memisahkan qty sesi ini dari qty sesi lain di perangkat yang sama', () => {
    // localPendingQty menghitung SEMUA sesi yang belum terkirim, termasuk sesi rekan.
    const [row] = buildPickerItems(
      [sourceRow({ serverReceivedQty: 6, localPendingQty: 18 })],
      [
        { purchaseItemId: 'PI1', qty: 8, pickedManually: false },
        { purchaseItemId: 'PI1', qty: 4, pickedManually: false },
      ],
      unitOf,
    )

    expect(row?.sessionQty).toBe(12)
    // 18 − 12 = 6 milik sesi lain. Angka inilah yang tidak boleh ikut terbaca sebagai "sesi ini",
    // karena panel qty MENAMBAH ke angka itu.
    expect(row?.otherSessionQty).toBe(6)
    expect(row?.serverReceivedQty).toBe(6)
    expect(row?.unit).toBe('KRT')
  })

  it('tidak pernah menghasilkan qty sesi lain negatif', () => {
    // Dua live query: snapshot `lines` bisa selangkah di depan snapshot `localPendingQty`.
    const [row] = buildPickerItems(
      [sourceRow({ localPendingQty: 0 })],
      [{ purchaseItemId: 'PI1', qty: 5, pickedManually: false }],
      unitOf,
    )

    expect(row?.sessionQty).toBe(5)
    expect(row?.otherSessionQty).toBe(0)
  })

  it('menandai baris bila ADA satu saja penambahan manual untuk item itu', () => {
    const [row] = buildPickerItems(
      [sourceRow()],
      [
        { purchaseItemId: 'PI1', qty: 3, pickedManually: false },
        { purchaseItemId: 'PI1', qty: 2, pickedManually: true },
      ],
      unitOf,
    )

    expect(row?.sessionPickedManually).toBe(true)
  })

  it('baris tanpa master barang tetap muncul tapi tidak bisa dipilih', () => {
    const [row] = buildPickerItems([sourceRow({ item: undefined })], [], unitOf)

    expect(row?.selectable).toBe(false)
    // Jatuh ke itemMasterId, bukan string kosong: operator setidaknya punya sesuatu untuk
    // dilaporkan ke admin.
    expect(row?.name).toBe('IM1')
    expect(row?.code).toBeNull()
    expect(row?.barcodes).toEqual([null, null, null])
  })

  it('mengumpulkan ketiga barcode dan menerjemahkan satuan PO', () => {
    const [row] = buildPickerItems(
      [
        sourceRow({
          uomId: 'U-PCS',
          item: {
            name: 'KECAP MANIS 600ML',
            code: '48000124',
            barcode: '111',
            barcode2: '222',
            barcode3: '333',
          },
        }),
      ],
      [],
      unitOf,
    )

    expect(row?.barcodes).toEqual(['111', '222', '333'])
    expect(row?.unit).toBe('PCS')
  })

  it('satuan yang tidak dikenal dipakai apa adanya, bukan string kosong', () => {
    const [row] = buildPickerItems([sourceRow({ uomId: 'U-XXX' })], [], unitOf)

    expect(row?.unit).toBe('U-XXX')
  })
})

describe('isPickerItemComplete & pickerTotalReceived', () => {
  it('menjumlahkan server + sesi ini + sesi lain', () => {
    expect(
      pickerTotalReceived(
        pickerItem({ serverReceivedQty: 6.5, sessionQty: 1.25, otherSessionQty: 2.25 }),
      ),
    ).toBe(10)
  })

  it('lengkap ketika total diterima mencapai qty dipesan', () => {
    expect(isPickerItemComplete(pickerItem({ orderedQty: 40, serverReceivedQty: 40 }))).toBe(true)
    expect(
      isPickerItemComplete(
        pickerItem({ orderedQty: 40, serverReceivedQty: 30, sessionQty: 6, otherSessionQty: 4 }),
      ),
    ).toBe(true)
  })

  it('belum lengkap ketika masih ada sisa', () => {
    expect(isPickerItemComplete(pickerItem({ orderedQty: 40, serverReceivedQty: 39.99 }))).toBe(
      false,
    )
  })

  it('melebihi pesanan tetap dihitung lengkap (over-receive ditandai, bukan ditolak)', () => {
    expect(isPickerItemComplete(pickerItem({ orderedQty: 10, serverReceivedQty: 12 }))).toBe(true)
  })
})

describe('sortPickerItems', () => {
  it('yang belum lengkap di atas, dan urutan PO dipertahankan di tiap kelompok', () => {
    const rows = [
      pickerItem({ purchaseItemId: 'A', orderedQty: 10, serverReceivedQty: 10 }),
      pickerItem({ purchaseItemId: 'B', orderedQty: 10, serverReceivedQty: 0 }),
      pickerItem({ purchaseItemId: 'C', orderedQty: 10, serverReceivedQty: 10 }),
      pickerItem({ purchaseItemId: 'D', orderedQty: 10, serverReceivedQty: 3 }),
    ]

    expect(sortPickerItems(rows).map((row) => row.purchaseItemId)).toEqual(['B', 'D', 'A', 'C'])
  })

  it('tidak mengubah array masukan', () => {
    const rows = [
      pickerItem({ purchaseItemId: 'A', orderedQty: 10, serverReceivedQty: 10 }),
      pickerItem({ purchaseItemId: 'B', orderedQty: 10, serverReceivedQty: 0 }),
    ]
    sortPickerItems(rows)

    expect(rows.map((row) => row.purchaseItemId)).toEqual(['A', 'B'])
  })
})

describe('filterPickerItems', () => {
  const rows = [
    pickerItem({ purchaseItemId: 'A', name: 'MINYAK GORENG 2L', code: '48000123' }),
    pickerItem({
      purchaseItemId: 'B',
      name: 'KECAP MANIS 600ML',
      code: '48000124',
      barcodes: [null, '8991002199999', null],
    }),
    pickerItem({
      purchaseItemId: 'C',
      name: 'TEPUNG SEGITIGA 1KG',
      code: null,
      barcodes: [null, null, null],
    }),
  ]

  it('kata kunci kosong mengembalikan semuanya', () => {
    expect(filterPickerItems(rows, '   ')).toHaveLength(3)
  })

  it('mencocokkan nama tanpa peduli huruf besar-kecil', () => {
    expect(filterPickerItems(rows, 'kecap').map((row) => row.purchaseItemId)).toEqual(['B'])
  })

  it('mencocokkan sebagian kode item', () => {
    expect(filterPickerItems(rows, '0123').map((row) => row.purchaseItemId)).toEqual(['A'])
  })

  it('mencocokkan sebagian barcode kedua — gunanya saat label rusak', () => {
    expect(filterPickerItems(rows, '2199').map((row) => row.purchaseItemId)).toEqual(['B'])
  })

  it('baris tanpa kode dan tanpa barcode tetap bisa dicari lewat namanya', () => {
    expect(filterPickerItems(rows, 'segitiga').map((row) => row.purchaseItemId)).toEqual(['C'])
  })

  it('tidak ada yang cocok mengembalikan daftar kosong', () => {
    expect(filterPickerItems(rows, 'zzz')).toEqual([])
  })
})
