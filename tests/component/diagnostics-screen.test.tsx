// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_STATUS } from '~/core/contracts/constants'
import { getToasts } from '~/platform/toast'

/**
 * Layar ini hanya berguna kalau isinya benar-benar keluar dari perangkat. Karena itu yang diuji
 * bukan tampilannya saja, tapi dua jalur keluar: unduhan berkas, dan — ketika WebView PDT menelan
 * unduhan tanpa pesan apa pun — jalur cadangan ke clipboard.
 *
 * Dua test terakhir memagari hal yang justru paling mudah terlupa: perangkat yang lognya diminta
 * adalah perangkat yang paling mungkin GAGAL membacanya (kuota penuh, IndexedDB mati di WebView).
 * Tanpa `catch` di handler-nya, kegagalan itu tidak memunculkan apa pun ke operator dan berakhir
 * di `unhandledrejection` — yang menulisnya ke log yang baru saja tidak bisa dibaca.
 */

const downloadTextFile = vi.fn(() => true)
const copyText = vi.fn(async () => true)
const clearDiagnosticsLog = vi.fn(async () => 7)
const readDiagnostics = vi.fn()
const collectDiagnosticsExport = vi.fn()

const SNAPSHOT = {
  deviceId: 'PDT-WH-001',
  appVersion: '1.0.0',
  appBuildTime: '',
  online: true,
  statusCounts: {
    [SESSION_STATUS.RUNNING]: 1,
    [SESSION_STATUS.PENDING]: 4,
    [SESSION_STATUS.SYNCING]: 0,
    [SESSION_STATUS.SYNCED]: 9,
    [SESSION_STATUS.FAILED]: 2,
    [SESSION_STATUS.REJECTED]: 0,
  },
  lastPushAt: '2026-10-07T07:00:00.000Z',
  lastPullAt: '2026-10-07T06:00:00.000Z',
  purchasesStale: true,
  totalEntries: 2,
  problemEntries: 1,
  logMax: 2000,
}

const ENTRIES = [
  {
    id: 2,
    at: '2026-10-07T07:01:00.000Z',
    level: 'error' as const,
    message: 'Sinkronisasi gagal: Koneksi terputus',
    category: 'sync' as const,
    event: 'PUSH_TRANSPORT_FAILED',
  },
  {
    id: 1,
    at: '2026-10-07T07:00:00.000Z',
    level: 'info' as const,
    message: 'Kirim selesai: 2 berhasil, 0 gagal dari 2 dokumen.',
    category: 'sync' as const,
    event: 'PUSH_RUN',
  },
]

vi.mock('@tanstack/react-router', () => ({
  // AppBar merender <Link> untuk tombol kembali; stub mengubahnya menjadi <a> biasa.
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))

vi.mock('~/platform/download', () => ({
  downloadTextFile: (...args: unknown[]) => downloadTextFile(...(args as [])),
  copyText: (...args: unknown[]) => copyText(...(args as [])),
}))

vi.mock('~/features/diagnostics/read', () => ({
  EMPTY_DIAGNOSTICS: { snapshot: SNAPSHOT, entries: [] },
  readDiagnostics: (...args: unknown[]) => readDiagnostics(...(args as [])),
  collectDiagnosticsExport: () => collectDiagnosticsExport(),
  clearDiagnosticsLog: () => clearDiagnosticsLog(),
}))

/**
 * `useLive` diganti tiruan yang setia pada aslinya: menjalankan querier di dalam effect lalu
 * menyimpan hasilnya di state. Alternatif yang lebih pendek — nilai kalengan menurut urutan
 * pemanggilan — akan pecah begitu urutan atau jumlah live query berubah.
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
 * Impor DINAMIS, dan ini bukan gaya-gayaan: `vi.mock` diangkat ke atas berkas, tapi pabrik
 * mock-nya di atas MENYEBUT `SNAPSHOT`, `downloadTextFile`, dan kawan-kawan yang baru
 * terinisialisasi di scope modul ini. Dengan impor statis, pabrik itu berjalan sebelum konstanta
 * tersebut ada dan test langsung mati dengan "Cannot access before initialization". Jangan
 * "disederhanakan" menjadi impor biasa di atas.
 */
const { DiagnosticsScreen } = await import('~/features/diagnostics/diagnostics-screen')

beforeEach(() => {
  vi.clearAllMocks()
  downloadTextFile.mockReturnValue(true)
  copyText.mockResolvedValue(true)
  clearDiagnosticsLog.mockResolvedValue(7)
  readDiagnostics.mockResolvedValue({ snapshot: SNAPSHOT, entries: ENTRIES })
  collectDiagnosticsExport.mockResolvedValue({
    snapshot: SNAPSHOT,
    sessions: [],
    entries: [...ENTRIES].reverse(),
  })
})

describe('layar diagnostik', () => {
  it('menampilkan potret antrean, kirim terakhir, dan penanda PO basi', async () => {
    render(<DiagnosticsScreen />)

    expect(await screen.findByText('Belum terkirim')).toBeInTheDocument()
    expect(await screen.findByText('4')).toBeInTheDocument()
    expect(screen.getByText('PDT-WH-001')).toBeInTheDocument()
    expect(screen.getByText(/Daftar PO belum disegarkan/)).toBeInTheDocument()
  })

  it('menampilkan entri log beserta level dan kode event-nya', async () => {
    render(<DiagnosticsScreen />)

    expect(await screen.findByText(/Sinkronisasi gagal/)).toBeInTheDocument()
    expect(screen.getByText(/PUSH_TRANSPORT_FAILED/)).toBeInTheDocument()
    expect(screen.getByText('error')).toBeInTheDocument()
  })

  it('saringan meminta hanya entri bermasalah dan menandai dirinya aktif', async () => {
    render(<DiagnosticsScreen />)
    await screen.findByText(/Sinkronisasi gagal/)
    const filter = screen.getByRole('button', { name: /Hanya warn/ })
    expect(filter).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(filter)

    await waitFor(() => {
      expect(readDiagnostics).toHaveBeenLastCalledWith({ limit: 200, onlyProblems: true })
    })
    expect(screen.getByRole('button', { name: /Hanya warn/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('mengekspor CSV sebagai berkas unduhan', async () => {
    render(<DiagnosticsScreen />)

    fireEvent.click(screen.getByRole('button', { name: /Ekspor CSV/ }))

    await waitFor(() => {
      expect(downloadTextFile).toHaveBeenCalledTimes(1)
    })
    const [fileName, csv] = downloadTextFile.mock.calls[0] as unknown as [string, string]
    expect(fileName).toMatch(/^stockops-diag-pdtwh001-\d{8}-\d{4}\.csv$/)
    expect(csv).toContain('PUSH_TRANSPORT_FAILED')
    expect(copyText).not.toHaveBeenCalled()
  })

  it('jatuh ke clipboard saat perangkat menolak unduhan', async () => {
    downloadTextFile.mockReturnValue(false)
    render(<DiagnosticsScreen />)

    fireEvent.click(screen.getByRole('button', { name: /Ekspor CSV/ }))

    await waitFor(() => {
      expect(copyText).toHaveBeenCalledTimes(1)
    })
    expect((copyText.mock.calls[0] as unknown as [string])[0]).toContain('StockOps')
  })

  it('menghapus log hanya setelah dua kali aktivasi tombol tahan', async () => {
    render(<DiagnosticsScreen />)
    const button = screen.getByRole('button', { name: 'Hapus Log' })

    // Klik pertama hanya melenjarkan tombol (lihat ConfirmButton: event dengan detail === 0).
    fireEvent.click(button)
    expect(clearDiagnosticsLog).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Tekan lagi untuk mengonfirmasi/ }))

    await waitFor(() => {
      expect(clearDiagnosticsLog).toHaveBeenCalledTimes(1)
    })
  })

  it('mengatakan apa adanya saat tidak ada entri', async () => {
    readDiagnostics.mockResolvedValue({ snapshot: SNAPSHOT, entries: [] })
    render(<DiagnosticsScreen />)

    expect(await screen.findByText('Belum ada entri log.')).toBeInTheDocument()
  })

  it('memberi tahu operator saat log perangkat tidak bisa dibaca', async () => {
    collectDiagnosticsExport.mockRejectedValue(new Error('UnknownError: IndexedDB'))
    render(<DiagnosticsScreen />)

    fireEvent.click(screen.getByRole('button', { name: /Ekspor CSV/ }))

    await waitFor(() => {
      expect(
        getToasts().some((item) => item.tone === 'danger' && /Gagal membaca log/.test(item.text)),
      ).toBe(true)
    })
    expect(downloadTextFile).not.toHaveBeenCalled()
    // Layar tidak boleh tertinggal dalam keadaan sibuk: tombolnya harus bisa dicoba lagi.
    expect(screen.getByRole('button', { name: /Ekspor CSV/ })).toBeEnabled()
  })

  it('memberi tahu operator saat log gagal dihapus', async () => {
    clearDiagnosticsLog.mockRejectedValue(new Error('QuotaExceededError'))
    render(<DiagnosticsScreen />)

    fireEvent.click(screen.getByRole('button', { name: 'Hapus Log' }))
    fireEvent.click(screen.getByRole('button', { name: /Tekan lagi untuk mengonfirmasi/ }))

    await waitFor(() => {
      expect(
        getToasts().some((item) => item.tone === 'danger' && /Gagal menghapus log/.test(item.text)),
      ).toBe(true)
    })
  })
})
