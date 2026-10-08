// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionGroupList } from '~/features/receiving/session/session-group-list'
import { SessionOwnerGate } from '~/features/receiving/session/session-owner-gate'
import type { SessionRowInput } from '~/features/receiving/session/session-status-row'
import { SESSION_STATUS } from '~/core/contracts/constants'

// Both components under test render a router <Link>, and a real one needs a route tree, a history
// and a RouterProvider around every case. The stub turns `to` into a plain href so the markup
// stays assertable. `vi.mock` is hoisted above the imports above, which is why this sits here.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to: string
    params?: Record<string, string>
    children: ReactNode
    className?: string
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

function row(overrides: Partial<SessionRowInput> = {}): SessionRowInput {
  return {
    sessionId: 'S1',
    status: SESSION_STATUS.RUNNING,
    userId: 'U1',
    userFullName: 'Budi Santoso',
    userLoginId: 'op_budi',
    number: null,
    purchaseNumber: 'PO10250001',
    purchaseId: 'P1',
    vendorName: 'CV Berkah Jaya',
    finalizedAt: null,
    lastError: null,
    failureCode: null,
    overReceive: false,
    excessTotal: 0,
    ...overrides,
  }
}

const noCounts = new Map<string, number>()

describe('SessionGroupList', () => {
  it('semua sesi milik user login: tanpa judul kelompok dan tanpa baris "Milik"', () => {
    render(
      <SessionGroupList
        sessions={[row(), row({ sessionId: 'S2' })]}
        itemCounts={noCounts}
        currentUserId="U1"
      />,
    )

    // Perangkat satu operator harus tampil persis seperti sebelum fitur ini.
    expect(screen.queryByText('Sesi saya')).toBeNull()
    expect(screen.queryByText(/^Operator lain/)).toBeNull()
    expect(screen.queryByText(/^Milik /)).toBeNull()
  })

  it('ada sesi operator lain: dua judul muncul dan hanya baris asing yang menyebut pemilik', () => {
    render(
      <SessionGroupList
        sessions={[
          row({ sessionId: 'S1', userId: 'U1', userFullName: 'Rama' }),
          row({ sessionId: 'S2', userId: 'U9', userFullName: 'Budi Santoso' }),
        ]}
        itemCounts={noCounts}
        currentUserId="U1"
      />,
    )

    expect(screen.getByText('Sesi saya')).toBeInTheDocument()
    expect(screen.getByText('Operator lain (1)')).toBeInTheDocument()
    expect(screen.getByText('Milik Budi Santoso')).toBeInTheDocument()
    // Baris sendiri tidak diberi label: judul kelompoknya sudah mengatakannya.
    expect(screen.queryByText('Milik Rama')).toBeNull()
  })

  it('nama pemilik tidak diketahui: tampil "Operator lain", bukan userId', () => {
    render(
      <SessionGroupList
        sessions={[row({ sessionId: 'S2', userId: 'U9', userFullName: null, userLoginId: null })]}
        itemCounts={noCounts}
        currentUserId="U1"
      />,
    )

    expect(screen.getByText('Milik Operator lain')).toBeInTheDocument()
    expect(screen.queryByText(/U9/)).toBeNull()
  })

  it('hanya sesi operator lain: judul "Sesi saya" tidak dirender sama sekali', () => {
    render(
      <SessionGroupList
        sessions={[row({ sessionId: 'S2', userId: 'U9' })]}
        itemCounts={noCounts}
        currentUserId="U1"
      />,
    )

    expect(screen.queryByText('Sesi saya')).toBeNull()
    expect(screen.getByText('Operator lain (1)')).toBeInTheDocument()
  })

  it('kelompok operator lain menyebut bahwa dokumennya tetap ikut terkirim', () => {
    // Kalimat ini adalah satu-satunya tempat yang mencegah kesimpulan "dokumen mereka menunggu
    // pemiliknya login". Keputusan produknya: Kirim mendorong seluruh outbox.
    render(
      <SessionGroupList
        sessions={[row({ sessionId: 'S2', userId: 'U9' })]}
        itemCounts={noCounts}
        currentUserId="U1"
      />,
    )

    expect(screen.getByText(/tetap ikut terkirim saat kamu menekan Kirim/)).toBeInTheDocument()
  })

  it('jumlah item per baris dibaca dari peta, nol bila absen', () => {
    render(
      <SessionGroupList
        sessions={[row({ sessionId: 'S1' })]}
        itemCounts={new Map([['S1', 12]])}
        currentUserId="U1"
      />,
    )

    expect(screen.getByText(/12 item/)).toBeInTheDocument()
  })
})

describe('SessionOwnerGate', () => {
  it('menyebut nama pemilik dan aturannya, lalu meneruskan persetujuan', () => {
    const onAcknowledge = vi.fn()
    render(
      <SessionOwnerGate
        ownerName="Budi Santoso"
        createdAt="2026-10-06T07:00:00.000Z"
        onAcknowledge={onAcknowledge}
      />,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Sesi ini milik Budi Santoso')
    // Aturannya, bukan cuma faktanya: tanpa kalimat ini operator akan terus menekan.
    expect(dialog).toHaveTextContent('Hanya Budi Santoso yang boleh melanjutkan')
    expect(dialog).toHaveTextContent('tidak bisa mengubah apa pun')

    fireEvent.click(screen.getByRole('button', { name: /Lihat saja/ }))
    expect(onAcknowledge).toHaveBeenCalledTimes(1)
  })

  it('selalu menawarkan jalan keluar ke daftar Penerimaan', () => {
    render(<SessionOwnerGate ownerName="Budi Santoso" createdAt={null} onAcknowledge={vi.fn()} />)

    expect(screen.getByRole('link', { name: /Kembali ke daftar Penerimaan/ })).toHaveAttribute(
      'href',
      '/sessions',
    )
  })

  it('tanpa createdAt tidak merender baris "Dibuat"', () => {
    render(<SessionOwnerGate ownerName="Budi Santoso" createdAt={null} onAcknowledge={vi.fn()} />)

    expect(screen.queryByText(/^Dibuat /)).toBeNull()
  })
})

/**
 * Tinggi baris dokumen dihitung dari data, bukan diukur, jadi tiga kondisi yang membuat baris
 * tumbuh harus benar-benar tercermin di tingginya. Kalau markup `SessionStatusRow` menambah atau
 * mengurangi satu baris teks tanpa `features/receiving/row-heights.ts` ikut berubah, baris akan terpotong di perangkat
 * yang tidak dipakai siapa pun untuk melaporkan bug.
 *
 * Yang diperiksa adalah PERBANDINGAN, bukan angkanya: angka pastinya sudah dikunci
 * tests/unit/row-heights.test.ts, dan mengulangnya di sini hanya akan jadi tempat kedua yang harus
 * diperbarui.
 */
describe('SessionGroupList — tinggi baris', () => {
  it('baris FAILED dengan pesan server lebih tinggi daripada baris biasa', () => {
    render(
      <SessionGroupList
        sessions={[
          row({ sessionId: 'S1', status: SESSION_STATUS.PENDING }),
          row({
            sessionId: 'S2',
            status: SESSION_STATUS.FAILED,
            lastError: 'Koneksi ke server terputus saat mengirim dokumen.',
          }),
        ]}
        itemCounts={noCounts}
        currentUserId="U1"
      />,
    )

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    const tinggi = (element: Element) => Number.parseInt((element as HTMLElement).style.height, 10)
    const [biasa, gagal] = rows
    expect(tinggi(biasa as Element)).toBeGreaterThan(0)
    expect(tinggi(gagal as Element)).toBeGreaterThan(tinggi(biasa as Element))
  })
})
