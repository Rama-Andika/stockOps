// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SendStatusStrip } from '~/features/sync/send-status-strip'

describe('SendStatusStrip', () => {
  const base = {
    pendingCount: 0,
    runningCount: 0,
    syncing: false,
    online: true,
    lastSyncedAt: null,
    onSend: () => undefined,
  }

  it('semua terkirim: menyebut waktu terakhir dan tidak menawarkan tombol', () => {
    // 30 menit lalu, dihitung relatif terhadap sekarang supaya assertion di bawah memaku baris
    // waktunya. Tanpa itu, menghapus seluruh sub-baris formatRelativeDateTime tetap lolos.
    const halfHourAgo = new Date(Date.now() - 30 * 60_000).toISOString()
    render(<SendStatusStrip {...base} lastSyncedAt={halfHourAgo} />)

    const strip = screen.getByRole('status')
    expect(strip).toHaveTextContent('Semua dokumen sudah masuk sistem')
    expect(strip).toHaveTextContent('30 menit yang lalu')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('nol tertahan tapi ada sesi berjalan: TIDAK mengklaim semuanya sudah masuk', () => {
    // Keadaan yang bisa dicapai dan paling mahal: pendingCount hanya menghitung PENDING + FAILED,
    // jadi sesi RUNNING berisi scan yang belum difinalisasi tidak terlihat olehnya. Strip hijau
    // di keadaan ini adalah pernyataan yang salah, dan tidak ada permukaan lain yang
    // membantahnya — SyncStatus sunyi dan lencana nav kosong pada penghitung yang sama.
    render(<SendStatusStrip {...base} runningCount={1} lastSyncedAt="2026-10-06T07:00:00.000Z" />)

    const strip = screen.getByRole('status')
    expect(strip).toHaveTextContent('1 sesi masih berjalan')
    expect(strip).toHaveTextContent('Belum diselesaikan, jadi belum dikirim.')
    expect(strip).not.toHaveTextContent('sudah masuk sistem')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('nol tertahan dan offline: tetap wujud "belum ada dokumen", bukan "0 dokumen belum terkirim"', () => {
    // Memaku posisi cabang !online DI BAWAH cabang pendingCount === 0. Dibalik, strip ini
    // berbunyi "0 dokumen belum terkirim".
    render(<SendStatusStrip {...base} online={false} />)

    const strip = screen.getByRole('status')
    expect(strip).toHaveTextContent('Belum ada dokumen untuk dikirim')
    expect(strip).not.toHaveTextContent('belum terkirim')
  })

  it('sedang mengirim dengan outbox sudah kosong tetap berbunyi "Sedang mengirim…"', () => {
    // Jendela ini nyata: runSync memanggil refresh() — yang menurunkan pendingCount ke 0 —
    // SEBELUM finally-nya menyetel syncing: false. Kalau cabang pendingCount === 0 dipindah ke
    // atas cabang syncing, strip berkedip hijau "Semua dokumen sudah masuk sistem" di tengah
    // pengiriman.
    render(<SendStatusStrip {...base} syncing lastSyncedAt="2026-10-06T07:00:00.000Z" />)

    const strip = screen.getByRole('status')
    expect(strip).toHaveTextContent('Sedang mengirim…')
    expect(strip).not.toHaveTextContent('sudah masuk sistem')
  })

  it('belum pernah mengirim apa pun: kalimatnya berbeda, bukan "sudah masuk sistem"', () => {
    render(<SendStatusStrip {...base} lastSyncedAt={null} />)

    expect(screen.getByRole('status')).toHaveTextContent('Belum ada dokumen untuk dikirim')
    expect(screen.getByRole('status')).not.toHaveTextContent('sudah masuk sistem')
    // Penjagaan terhadap fallback formatRelativeDateTime yang berbunyi "Belum pernah diunduh".
    expect(screen.getByRole('status')).not.toHaveTextContent('diunduh')
  })

  it('ada yang tertahan dan online: menawarkan Kirim', () => {
    const onSend = vi.fn()
    render(<SendStatusStrip {...base} pendingCount={3} onSend={onSend} />)

    expect(screen.getByRole('status')).toHaveTextContent('3 dokumen belum terkirim')
    fireEvent.click(screen.getByRole('button', { name: 'Kirim' }))
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('ada yang tertahan tapi offline: menjelaskan, tanpa tombol', () => {
    render(<SendStatusStrip {...base} pendingCount={3} online={false} />)

    const strip = screen.getByRole('status')
    expect(strip).toHaveTextContent('3 dokumen belum terkirim')
    expect(strip).toHaveTextContent('dikirim otomatis saat perangkat online')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('sedang mengirim menang atas keadaan lain dan tidak menawarkan tombol', () => {
    // syncing + pendingCount > 0 + online terjadi bersamaan di dunia nyata; kalau urutan
    // cabangnya dibalik, tombol Kirim muncul di tengah pengiriman.
    render(<SendStatusStrip {...base} pendingCount={3} syncing />)

    expect(screen.getByRole('status')).toHaveTextContent('Sedang mengirim…')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
