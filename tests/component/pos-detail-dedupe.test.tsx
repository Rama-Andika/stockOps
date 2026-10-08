// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Dedupe sesi per PO, sebagaimana diterapkan LAYAR DETAIL PO — bukan sebagaimana didefinisikan
 * `session-owner.ts`. Di sinilah aturannya bisa bocor, dan kedua arah kebocoran sama-sama mahal:
 * terlalu longgar berarti satu kiriman tercatat pada dua dokumen, terlalu ketat berarti operator
 * kedua (atau pengiriman kedua yang sah) kehilangan jalan untuk memulai penerimaan sama sekali.
 */

type SesiLokal = {
  sessionId: string
  purchaseId: string
  userId: string
  userFullName: string | null
  userLoginId: string | null
  createdAt: string
}

let currentUser: { userId: string; loginId: string; fullName: string; companyId: string } | null =
  null
let runningRows: SesiLokal[] = []
/**
 * Baris `sessionItems` tiruan. Setiap baris membawa `sessionId` DAN `purchaseId`, dan mock di bawah
 * benar-benar menyaring menurut kolom yang diminta — tanpa itu, query yang menyaring kolom yang
 * SALAH (mis. `where('purchaseId')`, atau `equals(existing.purchaseId)`) mengembalikan angka yang
 * sama dan test tetap hijau, padahal lembar lalu melaporkan jumlah item seluruh sesi untuk PO itu
 * — termasuk sesi rekan — sebagai "item sudah discan" pada dokumen operator ini.
 */
let sessionItemRows: Array<{ sessionId: string; purchaseId: string }> = []

const navigate = vi.fn()
const createSession = vi.fn(async (_input: unknown) => ({ sessionId: 'S-BARU' }))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  // AppBar merender <Link> untuk tombol kembali; stub mengubahnya menjadi <a> biasa.
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))

vi.mock('~/app/store/app-store', () => ({
  useAppStore: (selector: (state: { user: typeof currentUser; deviceId: string }) => unknown) =>
    selector({ user: currentUser, deviceId: 'PDT-1' }),
}))

/**
 * `useLive` diganti tiruan yang setia pada aslinya: menjalankan querier di dalam effect lalu
 * menyimpan hasilnya di state. Alternatif yang lebih pendek — mengembalikan nilai kalengan menurut
 * urutan pemanggilan — akan pecah begitu ada live query baru atau urutannya berubah, dan layar ini
 * punya tiga.
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
      }, deps as unknown[])
      return value
    },
  }
})

vi.mock('~/data/local-repo', () => ({
  localRepo: {
    getPurchaseDetail: async () => ({
      purchase: {
        purchaseId: 'P1',
        number: 'PO10250001',
        vendorName: 'CV Berkah Jaya',
        purchDate: '2026-10-01',
      },
      // Sengaja kosong: `allItemsFull` butuh `items.length > 0`, jadi daftar kosong membuat tombol
      // "Mulai Penerimaan" tetap hidup — itulah yang diuji di sini.
      items: [],
      progress: {
        progress: 'NONE',
        orderedTotal: 10,
        serverReceivedTotal: 0,
        localPendingTotal: 0,
      },
    }),
    runningSessions: async () => runningRows,
    createSession,
    ensureDeviceId: async () => 'PDT-1',
    db: {
      units: { toArray: async () => [] },
      sessionItems: {
        where: (field: 'sessionId' | 'purchaseId') => ({
          equals: (value: unknown) => ({
            count: async () => sessionItemRows.filter((row) => row[field] === value).length,
          }),
        }),
      },
    },
  },
}))

const { PoDetail } = await import('~/features/purchase-orders/po-detail')

const SAYA = { userId: 'U1', loginId: 'op_rama', fullName: 'Rama', companyId: '0' }

function sesi(overrides: Partial<SesiLokal> = {}): SesiLokal {
  return {
    sessionId: 'S-LAMA',
    purchaseId: 'P1',
    userId: SAYA.userId,
    userFullName: SAYA.fullName,
    userLoginId: SAYA.loginId,
    createdAt: '2026-10-06T01:00:00.000Z',
    ...overrides,
  }
}

/** Menunggu detail PO selesai dimuat, lalu menekan tombol utama. */
async function tekanMulai() {
  fireEvent.click(await screen.findByRole('button', { name: 'Mulai Penerimaan' }))
}

beforeEach(() => {
  currentUser = SAYA
  runningRows = []
  sessionItemRows = []
  navigate.mockClear()
  createSession.mockClear()
})

describe('detail PO: tanpa duplikat, jalan seperti biasa', () => {
  it('tanpa sesi berjalan: sesi langsung dibuat, tanpa lembar konfirmasi', async () => {
    render(<PoDetail purchaseId="P1" />)
    await tekanMulai()

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1))
    // Kelima field ini fondasi dua fitur sekaligus: `userId` yang tertukar (mis. dengan `loginId`,
    // sama-sama string sehingga typecheck lolos) membuat `findRunningSessionForPurchase` selamanya
    // mengembalikan undefined — dedupe mati total — DAN `canEditSession` false, sehingga operator
    // terkunci dari dokumennya sendiri lewat SessionOwnerGate. Keduanya gagal tanpa suara.
    expect(createSession).toHaveBeenCalledWith({
      purchaseId: 'P1',
      userId: 'U1',
      userFullName: 'Rama',
      userLoginId: 'op_rama',
      deviceId: 'PDT-1',
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(navigate).toHaveBeenCalledWith({
      to: '/sessions/$sessionId',
      params: { sessionId: 'S-BARU' },
    })
  })

  it('sesi berjalan milik sendiri untuk PO LAIN bukan duplikat', async () => {
    runningRows = [sesi({ sessionId: 'S-PO-LAIN', purchaseId: 'P2' })]
    render(<PoDetail purchaseId="P1" />)
    await tekanMulai()

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sesi berjalan milik rekan untuk PO yang sama bukan duplikat, dan peringatannya tetap ada', async () => {
    // Arah sebaliknya dari dedupe: aturan ini tidak boleh ikut mengunci operator kedua, karena
    // memulai sesi sendiri untuk PO yang sama memang diizinkan.
    runningRows = [
      sesi({
        sessionId: 'S-BUDI',
        userId: 'U9',
        userFullName: 'Budi Santoso',
        userLoginId: 'op_budi',
      }),
    ]
    render(<PoDetail purchaseId="P1" />)

    const peringatan = await screen.findByText(/sedang menerima PO ini di perangkat ini/)
    expect(peringatan).toHaveTextContent('Budi Santoso')

    await tekanMulai()
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('detail PO: duplikat ditahan lembar konfirmasi', () => {
  it('sesi berjalan milik sendiri untuk PO ini: lembar muncul dan TIDAK ada sesi yang dibuat', async () => {
    runningRows = [sesi()]
    // 3 baris untuk sesi ini + 4 baris milik sesi rekan pada PO yang SAMA. Query yang benar
    // menghitung 3; query yang menyaring per PO akan menghitung 7 dan membuat assert di bawah gagal.
    sessionItemRows = [
      { sessionId: 'S-LAMA', purchaseId: 'P1' },
      { sessionId: 'S-LAMA', purchaseId: 'P1' },
      { sessionId: 'S-LAMA', purchaseId: 'P1' },
      { sessionId: 'S-BUDI', purchaseId: 'P1' },
      { sessionId: 'S-BUDI', purchaseId: 'P1' },
      { sessionId: 'S-BUDI', purchaseId: 'P1' },
      { sessionId: 'S-BUDI', purchaseId: 'P1' },
    ]
    render(<PoDetail purchaseId="P1" />)
    await tekanMulai()

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Sesi untuk PO ini sudah ada')
    expect(dialog).toHaveTextContent('PO10250001')
    expect(dialog).toHaveTextContent('3 item sudah discan')
    expect(createSession).not.toHaveBeenCalled()
    // `busy` dilepas tepat saat lembar dibuka, jadi tanpa penjaga `duplicate` aksi utama hidup lagi
    // di belakang scrim — terlindung oleh piksel, bukan oleh fokus.
    expect(screen.getByRole('button', { name: 'Mulai Penerimaan' })).toBeDisabled()
  })

  it('"Lanjutkan sesi berjalan" membuka sesi LAMA, bukan sesi baru', async () => {
    runningRows = [sesi()]
    render(<PoDetail purchaseId="P1" />)
    await tekanMulai()

    fireEvent.click(await screen.findByRole('button', { name: 'Lanjutkan sesi berjalan' }))

    expect(navigate).toHaveBeenCalledWith({
      to: '/sessions/$sessionId',
      params: { sessionId: 'S-LAMA' },
    })
    expect(createSession).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('"Buat dokumen baru" tetap membuat sesi kedua — jalan keluarnya tidak dihapus', async () => {
    // Pengiriman terpisah untuk satu PO memang sah. Lembar ini pengingat, bukan larangan.
    runningRows = [sesi()]
    render(<PoDetail purchaseId="P1" />)
    await tekanMulai()

    fireEvent.click(await screen.findByRole('button', { name: 'Buat dokumen baru' }))

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1))
    expect(navigate).toHaveBeenCalledWith({
      to: '/sessions/$sessionId',
      params: { sessionId: 'S-BARU' },
    })
  })

  it('menutup lembar tanpa memilih tidak membuat apa pun dan tidak berpindah layar', async () => {
    runningRows = [sesi()]
    render(<PoDetail purchaseId="P1" />)
    await tekanMulai()

    fireEvent.click(await screen.findByRole('button', { name: 'Batal' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(createSession).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})
