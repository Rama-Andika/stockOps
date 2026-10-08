// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppStore } from '~/app/store/app-store'
import { AppStoreProvider } from '~/app/store/app-store-provider'
import type { AppState } from '~/app/store/types'
import { SettingsScreen } from '~/features/settings/settings-screen'
import { getToasts } from '~/platform/toast'
import { ThemeToggle } from '~/app/theme-toggle'
import { applyThemePreference } from '~/platform/theme'
import { loadPreferences } from '~/platform/preferences'

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  }
})

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
      <SettingsScreen />
    </AppStoreProvider>,
  )
}

describe('SettingsScreen UI & UX', () => {
  beforeEach(() => {
    localStorage.clear()
    // The theme row writes to <html>, and jsdom shares one document across this whole file.
    document.documentElement.removeAttribute('data-theme')
    // src/platform/theme.ts is a module singleton that survives between tests, so clearing storage
    // is not enough — this is what pulls its in-memory value back to the default. Without it the
    // first test to switch the theme leaves every later one running against 'light', and the
    // failures land in whichever test happens to run next.
    applyThemePreference()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('menampilkan profil operator dan status sesi aktif', () => {
    renderSettings()

    expect(screen.getAllByText('Budi Santoso')[0]).toBeInTheDocument()
    expect(screen.getByText('ID: op_budi')).toBeInTheDocument()
    expect(screen.getByText('Sesi: 5 hari')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Logout/i })).toBeInTheDocument()
  })

  it('mengaktifkan tombol aksi sinkronisasi saat online', () => {
    renderSettings({ online: true })

    expect(screen.getByRole('button', { name: /Refresh PO/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Unduh Ulang Data/i })).toBeEnabled()
  })

  it('menonaktifkan tombol sinkronisasi saat offline', () => {
    renderSettings({ online: false })

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

  it('mengubah preferensi tema, bunyi, dan getar saat sakelar diklik', () => {
    renderSettings()

    const themeSwitch = screen.getByRole('switch', { name: 'Tema Terang' })
    // Light is the default theme, so this row starts ON.
    expect(themeSwitch).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(themeSwitch)
    expect(themeSwitch).toHaveAttribute('aria-checked', 'false')
    // The row writes through src/platform/theme.ts, so the DOCUMENT itself has to have changed, not
    // just the switch. Without this line the two could drift apart and no test would fail.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)

    const soundSwitch = screen.getByRole('switch', { name: 'Bunyi Scanner' })
    expect(soundSwitch).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(soundSwitch)
    expect(soundSwitch).toHaveAttribute('aria-checked', 'false')
  })

  it('menampilkan rincian master database lokal di bagian diagnostik', () => {
    renderSettings()

    expect(screen.getByText('Rincian Master Database Lokal')).toBeInTheDocument()
    expect(screen.getByText('Konversi Satuan')).toBeInTheDocument()
  })

  it('saklar pilih item dari daftar PO menyala secara default dan bisa dimatikan', () => {
    renderSettings()

    const toggle = screen.getByRole('switch', { name: 'Pilih Item dari Daftar PO' })
    // Default ON: ini satu-satunya cara mencatat barang yang barcode-nya tidak bisa discan, jadi
    // default OFF berarti tidak ada yang memakainya.
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  // Paragraf penjelas di bawah saklar "Pilih Item dari Daftar PO" sengaja dihapus dari layar, jadi
  // test yang mengunci copy-nya ikut dihapus — bukan dilonggarkan. Aturannya sendiri tidak
  // bergantung pada copy itu: `pickedManually` tidak pernah meninggalkan perangkat karena
  // `buildSessionPayload` memetakan field baris satu per satu, dan itulah yang dipagari tes sync.

  /**
   * Kedua arah dari satu aturan: app bar hanya punya SATU baris status, dan `SyncStatus`
   * memenanginya kapan pun ia punya sesuatu untuk dikatakan. Jadi pesan "Muat ulang ada di bagian
   * atas layar" benar hanya ketika baris itu sunyi. Tanpa kedua tes ini, jalur `quiet` tidak
   * dijaga apa pun selain komentar — dan sempat salah sekali.
   */
  it('"Cek Pembaruan": saat antrean kirim sunyi, operator diarahkan ke tombol di app bar', async () => {
    renderSettings({ updateReady: true, pendingCount: 0 })

    fireEvent.click(screen.getByRole('button', { name: /Cek Pembaruan/i }))

    await waitFor(() => {
      expect(getToasts().at(-1)?.text).toMatch(/ada di bagian atas layar/)
    })
  })

  it('"Cek Pembaruan": saat masih ada dokumen belum terkirim, TIDAK menjanjikan tombol itu', async () => {
    renderSettings({ updateReady: true, pendingCount: 2 })

    fireEvent.click(screen.getByRole('button', { name: /Cek Pembaruan/i }))

    await waitFor(() => {
      const text = getToasts().at(-1)?.text ?? ''
      // Yang benar adalah menyuruh mengirim dulu — bukan menunjuk tombol yang sedang tidak dirender.
      expect(text).toMatch(/Kirim dulu dokumen yang belum terkirim/)
      expect(text).not.toMatch(/Tombol "Muat ulang" ada di bagian atas layar/)
    })
  })
})

/**
 * Satu sakelar, dua tempat: ikon di app bar (`ThemeToggle`, dirender oleh `AppShell`) dan baris
 * "Tema Terang" di Pengaturan. Keduanya TIDAK pernah berada dalam satu subtree React, jadi
 * satu-satunya yang menyatukannya adalah singleton di `src/platform/theme.ts`.
 *
 * Arah Pengaturan → app bar sudah dijaga test di atas (sakelarnya memasang `data-theme`). Dua test
 * di bawah menjaga arah sebaliknya, yang sempat hilang dan lolos sampai review: ikon app bar
 * dirender juga SAAT layar Pengaturan terbuka, jadi jalur ini bukan hipotetis.
 *
 * Test kedua adalah yang paling penting dari keduanya. Kegagalan di sana tidak terlihat di layar
 * sama sekali — tema tetap terang — dan baru muncul sebagai "temanya tidak mau tersimpan" saat
 * aplikasi dibuka lagi besok paginya.
 */
describe('SettingsScreen — sinkronisasi tema dengan ikon app bar', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    applyThemePreference()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    applyThemePreference()
  })

  /** Keduanya dirender bersama, karena itulah keadaan nyatanya: app bar tidak pernah hilang. */
  function renderBoth() {
    const store = createAppStore()
    store.setState({ ...baseState, refresh: vi.fn(async () => undefined) })
    return render(
      <AppStoreProvider store={store}>
        <ThemeToggle />
        <SettingsScreen />
      </AppStoreProvider>,
    )
  }

  it('tema diganti dari ikon app bar: baris di Pengaturan ikut padam', () => {
    renderBoth()

    const themeSwitch = screen.getByRole('switch', { name: 'Tema Terang' })
    // Terang adalah default, jadi barisnya mulai dari ON.
    expect(themeSwitch).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Ganti ke tema gelap' }))

    // Tanpa langganan ke singleton-nya, baris ini tetap ON — sakelar yang membantah layarnya
    // sendiri, karena halamannya sudah gelap.
    expect(themeSwitch).toHaveAttribute('aria-checked', 'false')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('mengubah preferensi LAIN setelah itu tidak menulis balik tema yang lama', () => {
    renderBoth()

    fireEvent.click(screen.getByRole('button', { name: 'Ganti ke tema gelap' }))
    expect(loadPreferences().theme).toBe('dark')

    // Patch ini tidak membawa kunci `theme` sama sekali, jadi `setTheme` tidak terpanggil. Kalau
    // `updatePreferences` menyusun objek simpanannya dari snapshot `preferences` saat mount, di
    // sinilah 'light' yang basi masuk ke localStorage — dan DOM-nya tetap gelap, jadi tidak ada
    // satu pun gejala sampai aplikasi dimuat ulang.
    fireEvent.click(screen.getByRole('switch', { name: 'Bunyi Scanner' }))

    expect(loadPreferences().theme).toBe('dark')
    expect(loadPreferences().feedbackBeep).toBe(false)
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})
