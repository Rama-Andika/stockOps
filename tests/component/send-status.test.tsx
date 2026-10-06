// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SendStatusStrip } from '~/components/send-status-strip'

describe('SendStatusStrip', () => {
  const base = {
    pendingCount: 0,
    syncing: false,
    online: true,
    lastSyncedAt: null,
    onSend: () => undefined,
  }

  it('semua terkirim: menyebut waktu terakhir dan tidak menawarkan tombol', () => {
    render(<SendStatusStrip {...base} lastSyncedAt="2026-10-06T07:00:00.000Z" />)

    expect(screen.getByRole('status')).toHaveTextContent('Semua dokumen sudah masuk sistem')
    expect(screen.queryByRole('button')).toBeNull()
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
