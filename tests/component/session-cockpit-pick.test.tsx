// @vitest-environment jsdom
import type { ComponentType, ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalSession, LocalSessionItem } from '~/client/db/local-db'
import { savePreferences } from '~/client/preferences'
import { SESSION_STATUS, type SessionStatus } from '~/shared/constants'

/**
 * How the two session screens behave once a line can also arrive WITHOUT a scan.
 *
 * Three modules are stubbed so no router, no IndexedDB and no store are needed. The live queries
 * inside the cockpit need no stub at all: `useLive` skips its querier when `indexedDB` is undefined,
 * which is the case in jsdom, so `pickerItems` is simply empty here. The picker still opens — which
 * is all these tests need from it; its own behaviour is locked in
 * tests/component/item-picker.test.tsx.
 */

const RAMA = { userId: 'U1', loginId: 'op_rama', fullName: 'Rama', companyId: '0' }

let currentSession: LocalSession | undefined
let currentLines: LocalSessionItem[] = []

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useParams: () => ({ sessionId: 'S1' }),
  }),
  useNavigate: () => () => undefined,
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))

vi.mock('~/client/state/store/app-store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      user: RAMA,
      online: true,
      sync: async () => ({ ok: true, message: '' }),
    }),
}))

vi.mock('~/client/hooks/use-session-data', () => ({
  useSessionData: () => ({
    session: currentSession,
    lines: currentLines,
    items: {
      IM1: { name: 'MINYAK GORENG 2L', code: '48000123' },
    },
    purchaseItemMap: new Map(),
    unitMap: new Map([['U-KRT', 'KRT']]),
    purchaseProgress: null,
    overLineIds: new Set<string>(),
    excessByPurchaseItem: new Map<string, number>(),
    qtySummary: '12 KRT',
  }),
}))

const { Route: CockpitRoute } = await import('~/routes/sessions/$sessionId')
const { Route: ReviewRoute } = await import('~/routes/sessions/review.$sessionId')
const Cockpit = CockpitRoute.options.component as ComponentType
const Review = ReviewRoute.options.component as ComponentType

function session(status: SessionStatus): LocalSession {
  return {
    sessionId: 'S1',
    purchaseId: 'P1',
    purchaseNumber: 'PO10250001',
    vendorName: 'CV Berkah Jaya',
    userId: RAMA.userId,
    userFullName: RAMA.fullName,
    userLoginId: RAMA.loginId,
    deviceId: 'D1',
    status,
    invoiceNumber: 'INV-1',
    doNumber: 'DO-1',
    receiveDate: '2026-10-06 08:00:00',
    createdAt: '2026-10-06T01:00:00.000Z',
    updatedAt: '2026-10-06T01:00:00.000Z',
    finalizedAt: status === SESSION_STATUS.RUNNING ? null : '2026-10-06T02:00:00.000Z',
    syncedAt: null,
    receiveId: null,
    number: 'IN10260001',
    lastError: null,
    failureCode: null,
    overReceive: false,
    excessTotal: 0,
    sequence: 1,
  }
}

function line(pickedManually: boolean): LocalSessionItem {
  return {
    lineId: 'L1',
    sessionId: 'S1',
    purchaseItemId: 'PI1',
    itemMasterId: 'IM1',
    barcode: pickedManually ? null : '8991002103458',
    qty: 12,
    uomPurchaseId: 'U-KRT',
    uomId: 'U-PCS',
    convQty: 12,
    convFound: true,
    pickedManually,
    createdAt: '2026-10-06T01:05:00.000Z',
  }
}

function setPreference(manualPick: boolean) {
  savePreferences({
    feedbackBeep: false,
    feedbackVibrate: false,
    highContrast: false,
    manualPick,
  })
}

beforeEach(() => {
  localStorage.clear()
  currentSession = session(SESSION_STATUS.RUNNING)
  currentLines = []
  setPreference(true)
})

describe('kokpit — pintu masuk picker', () => {
  it('slot kanan menawarkan picker selama field barcode kosong', () => {
    render(<Cockpit />)

    expect(screen.getByLabelText('Pilih item dari daftar PO')).toBeInTheDocument()
    // Satu slot, dua fungsi: tombol tambah tidak ikut dirender.
    expect(screen.queryByLabelText('Tambah ke sesi')).toBeNull()
  })

  it('begitu ada isi di field barcode, slot itu kembali jadi tombol tambah', () => {
    render(<Cockpit />)

    fireEvent.change(screen.getByLabelText('Barcode atau kode barang'), {
      target: { value: '8991002103458' },
    })

    expect(screen.getByLabelText('Tambah ke sesi')).toBeEnabled()
    expect(screen.queryByLabelText('Pilih item dari daftar PO')).toBeNull()
  })

  it('saklar Pengaturan OFF menutup kedua pintu masuk', () => {
    setPreference(false)
    render(<Cockpit />)

    expect(screen.queryByLabelText('Pilih item dari daftar PO')).toBeNull()
    // Perilaku lama kembali utuh: tombol tambah ada, dan mati karena field masih kosong.
    expect(screen.getByLabelText('Tambah ke sesi')).toBeDisabled()
  })

  it('scanner wedge mati selama picker terbuka, dan hidup lagi setelah ditutup', () => {
    render(<Cockpit />)
    const barcode = screen.getByLabelText('Barcode atau kode barang')

    fireEvent.click(screen.getByLabelText('Pilih item dari daftar PO'))
    expect(screen.getByRole('dialog', { name: 'Pilih item dari PO10250001' })).toBeInTheDocument()

    // Keystroke yang jatuh di luar field teks. Dengan wedge masih aktif, karakter ini akan
    // dialihkan ke field barcode DI BELAKANG overlay — tidak terlihat, dan field cari picker jadi
    // tidak bisa diketik.
    fireEvent.keyDown(document.body, { key: 'a' })
    expect(barcode).toHaveValue('')

    fireEvent.keyDown(screen.getByLabelText('Cari nama, kode, atau barcode'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    // Arah sebaliknya: wedge memang harus hidup saat picker tertutup, kalau tidak scan yang jatuh
    // di area mati akan hilang tanpa suara.
    fireEvent.keyDown(document.body, { key: 'a' })
    expect(barcode).toHaveValue('a')
  })

  /**
   * Pasangan test di atas, untuk effect yang SATUNYA. `pickerOpen` ada di empat tempat — kondisi dan
   * dep pada effect wedge DAN pada effect penarik fokus — dan test wedge hanya mengunci dua di
   * antaranya. Tanpa test ini, kedua penjaga pada effect fokus bisa dicabut tanpa satu test pun
   * gagal, padahal akibatnya terasa langsung di dermaga: field cari kehilangan fokus sesaat setelah
   * picker dibuka, dan gejalanya terbaca seperti keyboard rusak.
   *
   * Effect itu memakai `requestAnimationFrame`, jadi setiap assertion harus menunggu satu frame —
   * pencurian fokusnya tidak terjadi pada commit render yang sama.
   */
  it('effect penarik fokus melepaskan fokus selama picker terbuka, dan mengambilnya lagi setelah ditutup', async () => {
    render(<Cockpit />)
    const barcode = screen.getByLabelText('Barcode atau kode barang')
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))

    fireEvent.click(screen.getByLabelText('Pilih item dari daftar PO'))
    const search = screen.getByLabelText('Cari nama, kode, atau barcode')
    await nextFrame()
    // Tanpa `pickerOpen` di KONDISI effect itu, frame ini yang menarik fokus ke field barcode.
    expect(document.activeElement).toBe(search)

    fireEvent.keyDown(search, { key: 'Escape' })
    await nextFrame()
    // Tanpa `pickerOpen` di DEP-nya, effect tidak dijalankan ulang saat picker tertutup, jadi fokus
    // tertinggal di tombol picker dan scan berikutnya mengaktifkan tombol itu, bukan mengisi field.
    expect(document.activeElement).toBe(barcode)
  })
})

describe('penanda baris manual', () => {
  it('kokpit menandai baris yang pernah ditambah manual', () => {
    // Sesi baca-saja: kartu daftar item dirender tanpa syarat di sana, sedangkan tab "Item" pada
    // sesi yang masih berjalan butuh IndexedDB (lihat bagian 2.2 rencana).
    currentSession = session(SESSION_STATUS.SYNCED)
    currentLines = [line(true)]
    render(<Cockpit />)

    expect(screen.getByText('Manual')).toBeInTheDocument()
  })

  it('kokpit tidak menandai baris hasil scan', () => {
    currentSession = session(SESSION_STATUS.SYNCED)
    currentLines = [line(false)]
    render(<Cockpit />)

    expect(screen.queryByText('Manual')).toBeNull()
  })

  it('layar review menyebut baris manual tepat sebelum dokumen dikirim', () => {
    currentLines = [line(true)]
    render(<Review />)

    expect(
      screen.getByText(
        'Sebagian/seluruhnya dipilih manual dari daftar PO — tidak diverifikasi barcode.',
      ),
    ).toBeInTheDocument()
  })

  it('layar review tidak menyebut apa pun untuk baris hasil scan', () => {
    currentLines = [line(false)]
    render(<Review />)

    expect(screen.queryByText(/dipilih manual dari daftar PO/)).toBeNull()
  })
})
