// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppStore } from '~/app/store/app-store'
import { AppStoreProvider } from '~/app/store/app-store-provider'
import type { AppState } from '~/app/store/types'
import { UpdateBanner } from '~/app/update-banner'

/**
 * The reload offer as the app bar presents it. Three modules are mocked, each for a reason that
 * would otherwise make the test impossible rather than merely awkward:
 *
 *  - `~/app/pwa`: `activateUpdate()` calls `location.reload()`, which jsdom refuses
 *    ("Not implemented: navigation").
 *  - `~/data/use-live`: jsdom has no IndexedDB, so the real hook always returns its
 *    fallback and the "ada sesi yang masih berjalan" branch could never be reached. The banner
 *    makes exactly ONE `useLive` call, so a blunt mock is safe here.
 *  - `~/platform/scan-focus`: the focus handover is the thing being asserted, and the cockpit that
 *    would register a handler is not mounted in this file. Its other half is locked in
 *    tests/component/session-cockpit-ownership.test.tsx.
 */
const mocks = vi.hoisted(() => ({
  activateUpdate: vi.fn(),
  requestScanFocus: vi.fn(),
  runningCount: { value: 0 },
}))

vi.mock('~/app/pwa', () => ({
  registerServiceWorker: () => undefined,
  checkForUpdate: async () => undefined,
  activateUpdate: mocks.activateUpdate,
}))

vi.mock('~/data/use-live', () => ({
  useLive: () => mocks.runningCount.value,
}))

vi.mock('~/platform/scan-focus', () => ({
  requestScanFocus: mocks.requestScanFocus,
}))

function renderBanner(overrides: Partial<AppState> = {}) {
  const store = createAppStore()
  store.setState({
    ready: true,
    online: true,
    pendingCount: 0,
    syncing: false,
    updateReady: true,
    updateSnoozed: false,
    refresh: vi.fn(async () => undefined),
    ...overrides,
  })
  return render(
    <AppStoreProvider store={store}>
      <UpdateBanner />
    </AppStoreProvider>,
  )
}

beforeEach(() => {
  mocks.activateUpdate.mockClear()
  mocks.requestScanFocus.mockClear()
  mocks.runningCount.value = 0
})

describe('UpdateBanner', () => {
  it('tidak merender apa pun selama belum ada versi baru', () => {
    renderBanner({ updateReady: false })

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('tanpa data tertahan: satu ketuk langsung memuat ulang', () => {
    renderBanner()

    expect(screen.getByText('Versi baru siap')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Muat ulang' }))
    expect(mocks.activateUpdate).toHaveBeenCalledTimes(1)
  })

  it('"Nanti" menyembunyikan banner dan mengembalikan fokus ke field scan', () => {
    // Kedua arah penting. Yang kedua yang mudah terlupa: tombol ini hidup di dalam layar scan,
    // jadi setelah ditekan fokus harus kembali ke field barcode — kalau tidak, Enter penutup dari
    // scanner akan menekan tombol ini lagi, bukan mengirim hasil scan.
    renderBanner()

    fireEvent.click(screen.getByRole('button', { name: /^Nanti/ }))

    expect(screen.queryByRole('status')).toBeNull()
    expect(mocks.requestScanFocus).toHaveBeenCalledTimes(1)
  })

  it('dengan sesi yang masih berjalan: muat ulang minta konfirmasi dulu', () => {
    mocks.runningCount.value = 1
    renderBanner()

    const button = screen.getByRole('button', { name: 'Muat ulang' })
    // `fireEvent.click` mengirim `detail: 0`, yang oleh ConfirmButton diperlakukan sebagai
    // aktivasi gaya screen reader: ketukan pertama hanya MENYIAPKAN tombol.
    fireEvent.click(button)
    expect(mocks.activateUpdate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Tekan lagi untuk mengonfirmasi/ }))
    expect(mocks.activateUpdate).toHaveBeenCalledTimes(1)
  })
})
