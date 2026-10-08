// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalSession } from '~/data/local-db'
import { requestScanFocus } from '~/platform/scan-focus'
import { SESSION_STATUS, type SessionStatus } from '~/core/contracts/constants'

/**
 * The ownership rule as the SCAN COCKPIT applies it, not as `session-owner.ts` defines it. Both
 * halves are worth locking here because the route is where the rule can leak: every control that
 * changes a session hangs off a single `editable` flag, but the read-only branches hang off
 * `!editable` — so a block that is meant for "a document that can no longer be edited" also
 * renders for "a colleague's document", and one of those blocks deletes data.
 *
 * The cockpit component is rendered directly with its `sessionId` prop, the way
 * tests/component/settings-screen.test.tsx renders the settings screen. Three modules are stubbed
 * so no router, no IndexedDB and no store are needed: the router (the component renders a `Link`
 * and calls `useNavigate`), the store hook (it reads only `state.user`) and `useSessionData`
 * (the single place the cockpit gets its session from).
 */

let currentUser: { userId: string; loginId: string; fullName: string; companyId: string } | null =
  null
let currentSession: LocalSession | undefined

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => () => undefined,
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))

vi.mock('~/app/store/app-store', () => ({
  useAppStore: (selector: (state: { user: typeof currentUser }) => unknown) =>
    selector({ user: currentUser }),
}))

vi.mock('~/features/receiving/hooks/use-session-data', () => ({
  useSessionData: () => ({
    session: currentSession,
    lines: [],
    items: {},
    purchaseItemMap: new Map(),
    unitMap: new Map(),
    purchaseProgress: null,
    overLineIds: new Set<string>(),
    excessByPurchaseItem: new Map(),
    qtySummary: '',
  }),
}))

const { SessionCockpit } = await import('~/features/receiving/cockpit/session-cockpit')

const BUDI = { userId: 'U9', loginId: 'op_budi', fullName: 'Budi Santoso', companyId: '0' }
const RAMA = { userId: 'U1', loginId: 'op_rama', fullName: 'Rama', companyId: '0' }

/** A session owned by Budi (`U9`), in whichever status the test needs. */
function budiSession(status: SessionStatus): LocalSession {
  return {
    sessionId: 'S1',
    purchaseId: 'P1',
    purchaseNumber: 'PO10250001',
    vendorName: 'CV Berkah Jaya',
    userId: BUDI.userId,
    userFullName: BUDI.fullName,
    userLoginId: BUDI.loginId,
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
    number: null,
    lastError: 'PO ini sudah ditutup di admin.',
    failureCode: 'PURCHASE_NOT_CHECKED',
    overReceive: false,
    excessTotal: 0,
    sequence: 1,
  }
}

/** Walks through the gate the way an operator does, so the assertions run on the read-only screen. */
function acknowledgeGate() {
  fireEvent.click(screen.getByRole('button', { name: /Lihat saja/ }))
}

beforeEach(() => {
  currentUser = null
  currentSession = undefined
})

describe('kokpit: sesi milik operator lain', () => {
  it('REJECTED milik orang lain: gerbang dulu, lalu TIDAK ada tombol hapus', () => {
    // Jalur yang paling mahal kalau bocor: `deleteSession` menghapus sesi BESERTA seluruh baris
    // scan-nya, permanen dan tanpa jejak. Tombolnya hidup di blok `!editable`, dan `editable`
    // sekarang berarti "RUNNING dan milik saya" — jadi tanpa penjagaan kepemilikan blok itu
    // justru muncul untuk rekan kerja.
    currentUser = RAMA
    currentSession = budiSession(SESSION_STATUS.REJECTED)
    render(<SessionCockpit sessionId="S1" />)

    expect(screen.getByRole('dialog')).toHaveTextContent('Sesi ini milik Budi Santoso')
    acknowledgeGate()

    expect(screen.queryByRole('button', { name: /Hapus sesi dari perangkat/ })).toBeNull()
    expect(
      screen.getByText('Hanya Budi Santoso yang bisa menghapus dokumen ini dari perangkat.'),
    ).toBeInTheDocument()
    // Alasan penolakan tetap terlihat: melihat memang diizinkan.
    expect(screen.getByText(/PO ini sudah ditutup di admin/)).toBeInTheDocument()
  })

  it('PENDING milik orang lain: banner TIDAK mengklaim hanya pemilik yang bisa mengirim', () => {
    // Pengiriman memang level perangkat: tombol Kirim mendorong seluruh outbox, termasuk dokumen
    // operator lain. Klaim sebaliknya akan berdiri tepat di atas kalimat di bawahnya yang
    // mengatakan hal yang benar — dan membuat operator membiarkan dokumen rekannya tidak terkirim.
    currentUser = RAMA
    currentSession = budiSession(SESSION_STATUS.PENDING)
    render(<SessionCockpit sessionId="S1" />)
    acknowledgeGate()

    expect(screen.getByText(/sudah difinalisasi/)).toBeInTheDocument()
    expect(screen.getByText(/Pengiriman berlaku untuk semua dokumen sekaligus/)).toBeInTheDocument()
    expect(screen.queryByText(/kirim hanya bisa dilakukan oleh pemiliknya/)).toBeNull()
  })

  it('RUNNING milik orang lain: baca-saja — tanpa field scan dan tanpa tab bar', () => {
    currentUser = RAMA
    currentSession = budiSession(SESSION_STATUS.RUNNING)
    render(<SessionCockpit sessionId="S1" />)
    acknowledgeGate()

    expect(screen.queryByRole('tablist')).toBeNull()
    // Satu-satunya textbox di layar ini milik ScanBar (kartu dokumen vendor tidak dirender pada
    // sesi RUNNING), jadi tidak adanya textbox sama dengan tidak adanya jalur scan.
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(
      screen.getByText(/Scan dan penyelesaian dokumen ini hanya bisa dilakukan oleh pemiliknya/),
    ).toBeInTheDocument()
  })
})

describe('kokpit: sesi milik sendiri tidak ikut terkunci', () => {
  it('REJECTED milik sendiri: tanpa gerbang, tombol hapus tetap ada', () => {
    currentUser = BUDI
    currentSession = budiSession(SESSION_STATUS.REJECTED)
    render(<SessionCockpit sessionId="S1" />)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: /Hapus sesi dari perangkat/ })).toBeInTheDocument()
  })

  it('RUNNING milik sendiri: requestScanFocus() mengembalikan fokus ke field barcode', () => {
    // Separuh kedua dari aturan fokus banner versi. Tombol "Nanti" hidup di app bar, DI LUAR
    // route ini, jadi ia tidak bisa menyentuh `scanRef` dan hanya memanggil `requestScanFocus()`.
    // Inilah sisi yang harus menjawab panggilan itu: dengan fokus tertinggal di elemen lain,
    // Enter penutup dari scanner akan menekan elemen ITU, bukan mengirim hasil scan.
    currentUser = BUDI
    currentSession = budiSession(SESSION_STATUS.RUNNING)
    render(<SessionCockpit sessionId="S1" />)

    const field = screen.getByLabelText('Barcode atau kode barang')
    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)
    elsewhere.focus()
    expect(document.activeElement).toBe(elsewhere)

    requestScanFocus()
    expect(document.activeElement).toBe(field)

    elsewhere.remove()
  })

  it('RUNNING milik sendiri: kokpit penuh — tab bar dan field scan hidup', () => {
    // Penjaga arah sebaliknya: aturan kepemilikan tidak boleh mengunci pemiliknya sendiri.
    currentUser = BUDI
    currentSession = budiSession(SESSION_STATUS.RUNNING)
    render(<SessionCockpit sessionId="S1" />)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.queryByText(/hanya bisa dilihat/)).toBeNull()
  })
})
