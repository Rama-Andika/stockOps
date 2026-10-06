// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppStore } from '~/client/state/store/app-store'
import { AppStoreProvider } from '~/client/state/store/app-store-provider'
import type { AppState } from '~/client/state/store/types'
import { Route } from '~/routes/settings'

const SettingsPage = Route.options.component as React.ComponentType

const baseState = {
  ready: true,
  user: {
    userId: '1',
    loginId: 'op_budi',
    fullName: 'Budi Santoso',
    companyId: '10',
  },
  deviceId: 'PDT-WH-001',
  online: true,
  pendingCount: 0,
  syncing: false,
  pullProgress: { running: false, kind: '', fetched: 0, total: 0 },
  lastPullAt: '2026-10-06T07:00:00.000Z',
  credentials: [
    {
      key: '1',
      deviceId: 'PDT-WH-001',
      userId: '1',
      loginId: 'op_budi',
      fullName: 'Budi Santoso',
      companyId: '10',
      passwordHash: 'hash',
      salt: 'salt',
      iterations: 1000,
      fingerprint: 'fp',
      lastOnlineLoginAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5 * 86400000).toISOString(),
    },
  ],
  sessionTtlDaysLeft: 5,
}

function renderSettings(overrides: Partial<AppState> = {}) {
  const store = createAppStore()
  store.setState({
    ...baseState,
    refresh: vi.fn(async () => undefined),
    ...overrides,
  })
  return render(
    <AppStoreProvider store={store}>
      <SettingsPage />
    </AppStoreProvider>,
  )
}

describe('SettingsPage UI & UX', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('menampilkan profil operator dan status sesi aktif', () => {
    renderSettings()

    expect(screen.getAllByText('Budi Santoso')[0]).toBeInTheDocument()
    expect(screen.getByText('ID: op_budi')).toBeInTheDocument()
    expect(screen.getByText('Sesi: 5 hari')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keluar dari Akun (Logout)' })).toBeInTheDocument()
  })

  it('menampilkan status online dan tombol aksi sinkronisasi', () => {
    renderSettings({ online: true })

    expect(screen.getByText('Online')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Refresh PO/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Unduh Ulang Data/i })).toBeEnabled()
  })

  it('menonaktifkan tombol sinkronisasi saat offline', () => {
    renderSettings({ online: false })

    expect(screen.getByText('Offline')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Refresh PO/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Unduh Ulang Data/i })).toBeDisabled()
  })

  it('menampilkan progress unduhan saat sedang berlangsung', () => {
    renderSettings({
      pullProgress: { running: true, kind: 'master_items', fetched: 150, total: 300 },
    })

    expect(screen.getByText(/Mengunduh: master_items/i)).toBeInTheDocument()
    expect(screen.getByText(/150 \/ 300/i)).toBeInTheDocument()
  })

  it('memanggil refreshPurchases saat tombol Refresh PO diklik', async () => {
    const refreshPurchases = vi.fn(async () => ({ ok: true, message: 'PO diperbarui.' }))
    renderSettings({ refreshPurchases })

    const btn = screen.getByRole('button', { name: /Refresh PO/i })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(refreshPurchases).toHaveBeenCalledTimes(1)
    })
  })

  it('mengubah preferensi kontras, bunyi, dan getar saat sakelar diklik', () => {
    renderSettings()

    const contrastSwitch = screen.getByRole('switch', { name: 'Kontras Tinggi' })
    expect(contrastSwitch).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(contrastSwitch)
    expect(contrastSwitch).toHaveAttribute('aria-checked', 'true')

    const soundSwitch = screen.getByRole('switch', { name: 'Bunyi Scanner' })
    expect(soundSwitch).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(soundSwitch)
    expect(soundSwitch).toHaveAttribute('aria-checked', 'false')
  })

  it('menampilkan kredensial offline ter-cache di bagian diagnostik', () => {
    renderSettings()

    expect(screen.getByText('@op_budi')).toBeInTheDocument()
    expect(screen.getByText(/5 hari lagi/i)).toBeInTheDocument()
  })
})
