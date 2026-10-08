// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearScrollMemory } from '~/ui/virtual/virtual-list'
import { ScrollHarness } from './virtual-layout'
import { PO_CARD_HEIGHT } from '~/features/purchase-orders/row-heights'

/**
 * Dua hal yang dijaga di sini, dan keduanya hanya bisa pecah di LAYAR ini, bukan di VirtualList:
 *
 * 1. Daftar 2000 PO tidak boleh menaruh 2000 kartu di DOM. Itu alasan virtualisasi ada.
 * 2. Menyaring atau mengetik di kotak cari harus mengembalikan scroll ke atas. Tanpa itu,
 *    operator yang scroll jauh lalu mengetik akan melihat daftar yang TAMPAK kosong — scroller
 *    masih berada di luar hasil yang baru. Yang menyelesaikannya adalah `restoreKey` yang memuat
 *    filter + kata kunci, jadi yang diuji di sini adalah apakah layar ini menyusun kuncinya dengan
 *    benar.
 */

type Summary = {
  purchaseId: string
  number: string | null
  status: string | null
  vendorId: string
  vendorName: string
  locationId: string
  userId: string
  companyId: string
  purchDate: string | null
  totalAmount: string
  updatedAt: string
  orderedTotal: number
  serverReceivedTotal: number
  localPendingTotal: number
  totalReceivedTotal: number
  progress: 'NONE' | 'PARTIAL' | 'FULL' | 'OVER'
}

function summary(index: number): Summary {
  const padded = String(index).padStart(4, '0')
  return {
    purchaseId: `P${padded}`,
    number: `PO-${padded}`,
    status: 'CHECKED',
    vendorId: 'V1',
    vendorName: `PT VENDOR ${padded}`,
    locationId: 'L1',
    userId: 'U1',
    companyId: 'C1',
    /**
     * The SAME date for every row on purpose. The screen sorts by date descending and falls back
     * to the PO number descending (`pos/index.tsx:66-85`), so one shared date makes the order
     * fully predictable: PO-0079 first, PO-0000 last. A date that varied with `index` would make
     * "which row is off screen" depend on arithmetic nobody reading this test would redo.
     */
    purchDate: '2026-10-08 07:00:00',
    totalAmount: '0',
    updatedAt: '2026-10-08 00:00:00',
    orderedTotal: 40,
    serverReceivedTotal: 0,
    localPendingTotal: 0,
    totalReceivedTotal: 0,
    progress: 'NONE',
  }
}

let summaryRows: Summary[] = []

vi.mock('@tanstack/react-router', () => ({
  // The PO card and the "continue session" banner render <Link>; a plain <a> is enough here.
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

vi.mock('~/data/local-repo', () => ({
  localRepo: {
    listPurchaseSummaries: () => Promise.resolve(summaryRows),
    runningSessions: () => Promise.resolve([]),
  },
}))

vi.mock('~/app/store/app-store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      online: true,
      pullProgress: { running: false },
      downloadData: () => Promise.resolve({ ok: true, message: 'ok' }),
      user: { userId: 'U1', loginId: 'pdt', fullName: 'Operator Satu', companyId: 'C1' },
    }),
}))

/**
 * `useLive` diganti tiruan yang setia pada aslinya: menjalankan querier di dalam effect lalu
 * menyimpan hasilnya di state. Alternatif yang lebih pendek — nilai kalengan menurut urutan
 * pemanggilan — akan pecah begitu jumlah atau urutan live query berubah.
 */
vi.mock('~/data/use-live', async () => {
  const { useEffect, useState } = await import('react')
  return {
    useLive: <T,>(querier: () => Promise<T>, deps: readonly unknown[], fallback: T) => {
      const [value, setValue] = useState<T>(fallback)
      useEffect(() => {
        let alive = true
        void querier().then((next) => {
          if (alive) setValue(next)
        })
        return () => {
          alive = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps)
      return value
    },
  }
})

/**
 * Impor DINAMIS, dan ini bukan gaya-gayaan: `vi.mock` diangkat ke atas berkas, tapi pabrik mock di
 * atas MENYEBUT `summaryRows`, yang baru terinisialisasi di scope modul ini. Dengan impor statis,
 * pabrik itu berjalan sebelum konstanta tersebut ada dan test langsung mati dengan "Cannot access
 * before initialization". Jangan "disederhanakan" menjadi impor biasa di atas.
 */
const { PoList } = await import('~/features/purchase-orders/po-list')

const searchField = () => screen.getByLabelText('Cari PO')

beforeEach(() => {
  clearScrollMemory()
  summaryRows = []
})

describe('daftar PO tervirtualisasi', () => {
  it('di bawah ambang merender setiap kartu', async () => {
    summaryRows = Array.from({ length: 5 }, (_, index) => summary(index))

    render(
      <ScrollHarness contentHeight={5 * PO_CARD_HEIGHT}>
        <PoList />
      </ScrollHarness>,
    )

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(5))
    // Urutan: nomor menurun, jadi PO-0004 di atas dan PO-0000 di bawah. Keduanya ada di DOM.
    expect(screen.getByText('PO-0004')).toBeInTheDocument()
    expect(screen.getByText('PO-0000')).toBeInTheDocument()
  })

  it('di atas ambang hanya menaruh jendela di DOM, tapi menyebut jumlah penuh', async () => {
    summaryRows = Array.from({ length: 80 }, (_, index) => summary(index))

    render(
      <ScrollHarness contentHeight={80 * PO_CARD_HEIGHT}>
        <PoList />
      </ScrollHarness>,
    )

    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0))
    const items = screen.getAllByRole('listitem')
    expect(items.length).toBeLessThan(80)
    expect(items[0]).toHaveAttribute('aria-setsize', '80')
    expect(items[0]).toHaveAttribute('aria-posinset', '1')
    // Baris teratas (nomor menurun) ada; yang paling bawah TIDAK ada di DOM — itu seluruh gunanya.
    expect(screen.getByText('PO-0079')).toBeInTheDocument()
    expect(screen.queryByText('PO-0000')).not.toBeInTheDocument()
  })

  it('mengetik di kotak cari mengembalikan scroll ke atas', async () => {
    summaryRows = Array.from({ length: 80 }, (_, index) => summary(index))

    render(
      <ScrollHarness contentHeight={80 * PO_CARD_HEIGHT}>
        <PoList />
      </ScrollHarness>,
    )
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0))

    const scroller = screen.getByTestId('scroller')
    scroller.scrollTop = 2000
    expect(scroller.scrollTop).toBe(2000)

    fireEvent.change(searchField(), { target: { value: 'PO-0007' } })

    // Kunci restore berubah (memuat kata kunci), jadi tidak ada offset tersimpan untuk kunci baru
    // dan daftar mulai dari atas.
    await waitFor(() => expect(scroller.scrollTop).toBe(0))
    expect(screen.getByText('PO-0007')).toBeInTheDocument()
  })

  it('mengganti filter progres juga mengembalikan scroll ke atas', async () => {
    summaryRows = Array.from({ length: 80 }, (_, index) => summary(index))

    render(
      <ScrollHarness contentHeight={80 * PO_CARD_HEIGHT}>
        <PoList />
      </ScrollHarness>,
    )
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0))

    const scroller = screen.getByTestId('scroller')
    scroller.scrollTop = 2000

    fireEvent.click(screen.getByRole('button', { name: 'Belum' }))

    await waitFor(() => expect(scroller.scrollTop).toBe(0))
  })
})
