// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ItemPicker } from '~/components/item-picker'
import type { PickerItem } from '~/shared/item-picker'

function item(overrides: Partial<PickerItem> = {}): PickerItem {
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

/**
 * Four rows that cover every state the list can be in: partly received with qty in this session,
 * partly received by somebody else's session, unusable because the master row is missing, and
 * already full. The order here is the PO's order — the component is what moves the full one down.
 */
const ROWS: PickerItem[] = [
  item({
    purchaseItemId: 'PI1',
    name: 'MINYAK GORENG 2L',
    code: '48000123',
    orderedQty: 40,
    serverReceivedQty: 6,
    sessionQty: 12,
  }),
  item({
    purchaseItemId: 'PI2',
    name: 'KECAP MANIS 600ML',
    code: '48000124',
    barcodes: [null, '8991002199999', null],
    unit: 'DUS',
    orderedQty: 10,
    otherSessionQty: 4,
  }),
  item({
    purchaseItemId: 'PI3',
    name: 'IM3',
    code: null,
    barcodes: [null, null, null],
    unit: 'SAK',
    orderedQty: 5,
    selectable: false,
  }),
  item({
    purchaseItemId: 'PI4',
    name: 'BERAS PREMIUM 5KG',
    code: '48000001',
    orderedQty: 20,
    serverReceivedQty: 20,
  }),
]

function renderPicker(overrides: { onPick?: (id: string, qty: number) => void; onClose?: () => void } = {}) {
  const onPick = overrides.onPick ?? vi.fn()
  const onClose = overrides.onClose ?? vi.fn()
  const result = render(
    <ItemPicker purchaseLabel="PO10250001" items={ROWS} onPick={onPick} onClose={onClose} />,
  )
  return { ...result, onPick, onClose }
}

const searchField = () => screen.getByLabelText('Cari nama, kode, atau barcode')

describe('ItemPicker — daftar', () => {
  it('menyebut qty sesi ini, sesi lain, dan sistem secara terpisah', () => {
    renderPicker()

    // Ketiganya harus terbaca sebagai angka yang berbeda: panel qty MENAMBAH ke "sesi ini", jadi
    // mencampurnya dengan qty rekan akan membuat operator mengetik total yang salah.
    expect(screen.getByText(/Sudah 12 di sesi ini/)).toBeInTheDocument()
    expect(screen.getByText(/6 di sistem/)).toBeInTheDocument()
    expect(screen.getByText(/4 di sesi lain/)).toBeInTheDocument()
  })

  it('item yang sudah penuh turun ke bawah, sisanya tetap urutan PO', () => {
    renderPicker()

    const rows = screen.getAllByRole('listitem').map((row) => row.textContent ?? '')
    expect(rows[0]).toContain('MINYAK GORENG 2L')
    expect(rows[1]).toContain('KECAP MANIS 600ML')
    expect(rows[2]).toContain('IM3')
    expect(rows[3]).toContain('BERAS PREMIUM 5KG')
    expect(rows[3]).toContain('Lengkap')
  })

  it('pencarian menyempitkan daftar, termasuk lewat sebagian barcode', () => {
    renderPicker()

    fireEvent.change(searchField(), { target: { value: 'kecap' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('KECAP MANIS 600ML')).toBeInTheDocument()

    // Empat digit yang masih terbaca dari label yang rusak — ini gunanya barcode ikut dicari.
    fireEvent.change(searchField(), { target: { value: '2199' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('KECAP MANIS 600ML')).toBeInTheDocument()
  })

  it('pencarian tanpa hasil mengatakannya, bukan menampilkan daftar kosong', () => {
    renderPicker()

    fireEvent.change(searchField(), { target: { value: 'zzz' } })
    expect(screen.getByText('Tidak ada item PO yang cocok dengan pencarian itu.')).toBeInTheDocument()
  })

  it('baris tanpa master barang dimatikan dan menyebutkan apa yang harus dilakukan', () => {
    renderPicker()

    const row = screen.getByText('IM3').closest('button')
    expect(row).toBeDisabled()
    expect(
      screen.getByText('Data barang belum lengkap — unduh ulang data lewat Pengaturan.'),
    ).toBeInTheDocument()
  })

  it('panah bawah lalu Enter membuka panel qty item KEDUA', () => {
    renderPicker()

    fireEvent.keyDown(searchField(), { key: 'ArrowDown' })
    fireEvent.keyDown(searchField(), { key: 'Enter' })

    // Bukan item pertama: tanpa penanganan panah, Enter akan selalu membuka baris teratas.
    expect(screen.getByRole('heading', { name: 'KECAP MANIS 600ML' })).toBeInTheDocument()
  })

  it('Tab dari kontrol terakhir kembali ke kontrol pertama, tidak keluar dialog', () => {
    renderPicker()

    const lastRow = screen.getByText('BERAS PREMIUM 5KG').closest('button')
    lastRow?.focus()
    fireEvent.keyDown(lastRow as HTMLElement, { key: 'Tab' })

    expect(document.activeElement).toBe(screen.getByLabelText('Tutup daftar item PO'))
  })

  it('fokus masuk ke field cari saat dibuka dan kembali ke pemicu saat ditutup', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()

    const { unmount } = renderPicker()
    expect(document.activeElement).toBe(searchField())

    unmount()
    // Tanpa pemulihan ini, setiap penutupan menjatuhkan fokus ke <body>, tempat tidak ada satu pun
    // keystroke keypad yang sampai ke mana-mana.
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('Esc di daftar menutup picker', () => {
    const onClose = vi.fn()
    renderPicker({ onClose })

    fireEvent.keyDown(searchField(), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ItemPicker — panel qty', () => {
  function openFirstRow() {
    const rendered = renderPicker()
    fireEvent.click(screen.getByText('MINYAK GORENG 2L'))
    return rendered
  }

  it('default 1, dan menambahkan qty yang diketik ke baris yang dipilih', () => {
    const { onPick } = openFirstRow()

    const qtyField = screen.getByLabelText('Qty dalam satuan PO')
    expect(qtyField).toHaveValue('1')

    fireEvent.change(qtyField, { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tambahkan ke sesi' }))

    expect(onPick).toHaveBeenCalledWith('PI1', 3)
  })

  it('menyebut qty yang sudah ada di sesi ini, karena qty baru DITAMBAHKAN ke situ', () => {
    openFirstRow()

    expect(screen.getByText(/Sudah 12 di sesi ini/)).toBeInTheDocument()
    // 6 (server) + 12 (sesi ini) + 1 (draf) = 19
    expect(screen.getByText(/Total jadi 19 dari 40 KRT/)).toBeInTheDocument()
  })

  it('memperingatkan sebelum menulis bila total melewati pesanan', () => {
    openFirstRow()

    fireEvent.change(screen.getByLabelText('Qty dalam satuan PO'), { target: { value: '25' } })
    // 6 + 12 + 25 = 43, lebih 3 dari 40.
    expect(screen.getByText(/Lebih 3 KRT dari pesanan/)).toBeInTheDocument()
    // Tanpa qty sesi lain, tidak ada klausa tambahan apa pun — kartu hasil setelahnya akan setuju.
    expect(screen.queryByText(/sesi lain di perangkat ini/)).toBeNull()
  })

  /**
   * Angka panel ini menghitung sesi lain di perangkat yang sama; kartu OVER setelah penulisan
   * (`addedHero`) tidak. Perbedaan itu disengaja, tapi tanpa penyebutan sumber angkanya peringatan di
   * sini akan terbaca seperti dibatalkan oleh kartu hijau sesudahnya. Kedua test di bawah mengunci
   * penyebutan itu — satu untuk barisnya, satu untuk peringatannya.
   */
  it('menyebut asal angka ketika sesi lain di perangkat ini ikut terhitung', () => {
    renderPicker()
    fireEvent.click(screen.getByText('KECAP MANIS 600ML'))

    // 0 (server) + 0 (sesi ini) + 4 (sesi lain) + 1 (draf) = 5
    expect(
      screen.getByText(/Total jadi 5 dari 10 DUS — termasuk 4 dari sesi lain di perangkat ini/),
    ).toBeInTheDocument()
  })

  it('peringatan over-receive menjelaskan kenapa kartu hasil bisa belum menandainya', () => {
    renderPicker()
    fireEvent.click(screen.getByText('KECAP MANIS 600ML'))

    fireEvent.change(screen.getByLabelText('Qty dalam satuan PO'), { target: { value: '8' } })
    // 4 (sesi lain) + 8 = 12, lebih 2 dari 10.
    const warning = screen.getByText(/Lebih 2 DUS dari pesanan/)
    expect(warning).toHaveTextContent('kartu hasil setelah ini bisa belum menandainya')
    expect(warning).toHaveTextContent('dihitung server setelah semua dokumen terkirim')
  })

  it('qty nol atau kosong tidak bisa dikirim', () => {
    const { onPick } = openFirstRow()

    fireEvent.change(screen.getByLabelText('Qty dalam satuan PO'), { target: { value: '0' } })
    const submit = screen.getByRole('button', { name: 'Tambahkan ke sesi' })
    expect(submit).toBeDisabled()

    fireEvent.click(submit)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('Esc kembali ke daftar, BUKAN keluar dari picker', () => {
    const onClose = vi.fn()
    renderPicker({ onClose })
    fireEvent.click(screen.getByText('MINYAK GORENG 2L'))
    expect(screen.getByLabelText('Qty dalam satuan PO')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByLabelText('Qty dalam satuan PO'), { key: 'Escape' })

    // Satu langkah: operator yang salah ketik qty tidak boleh kehilangan item yang baru ia temukan.
    expect(searchField()).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Enter di kolom qty langsung menambahkan', () => {
    const { onPick } = openFirstRow()

    fireEvent.change(screen.getByLabelText('Qty dalam satuan PO'), { target: { value: '2' } })
    fireEvent.keyDown(screen.getByLabelText('Qty dalam satuan PO'), { key: 'Enter' })

    expect(onPick).toHaveBeenCalledWith('PI1', 2)
  })
})
