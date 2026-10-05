import type { StateCreator } from 'zustand'
import { localRepo } from '../../db/local-repo'
import { isCredentialExpired, remainingDays } from '../../auth/offline-auth'
import { serverTransport } from '../../sync/transport'
import { countPendingSessions, pullAllData, refreshPurchases, syncOutbox } from '../../sync/engine'
import { CURRENT_USER_KEY, isBrowser } from './helpers'
import type { ActionResult, AppState, CurrentUser, SyncState } from './types'

export const createSyncSlice: StateCreator<AppState, [], [], SyncState> = (set, get) => ({
  online: true,
  pendingCount: 0,
  syncing: false,
  pullProgress: { running: false, kind: '', fetched: 0, total: 0 },
  lastPullAt: null,

  refresh: async () => {
    if (!isBrowser()) return
    const [pendingCount, lastPullAt, credentials, deviceId] = await Promise.all([
      countPendingSessions(localRepo),
      localRepo.getMeta('lastPullAt'),
      localRepo.listCredentials(),
      localRepo.ensureDeviceId(),
    ])

    let user: CurrentUser | null = null
    let sessionTtlDaysLeft: number | null = null
    const currentRaw = window.localStorage.getItem(CURRENT_USER_KEY)
    if (currentRaw) {
      try {
        const parsed = JSON.parse(currentRaw) as CurrentUser
        const credential = credentials.find((entry) => entry.userId === parsed.userId)
        if (credential && isCredentialExpired(credential, new Date())) {
          window.localStorage.removeItem(CURRENT_USER_KEY)
          sessionTtlDaysLeft = 0
        } else {
          user = parsed
          sessionTtlDaysLeft = credential ? remainingDays(credential, new Date()) : null
        }
      } catch {
        window.localStorage.removeItem(CURRENT_USER_KEY)
      }
    }

    set({ pendingCount, lastPullAt, credentials, deviceId, user, sessionTtlDaysLeft })
  },

  downloadData: async () => {
    if (!isBrowser()) return { ok: false, message: 'Tidak tersedia.' }
    set({ pullProgress: { running: true, kind: '', fetched: 0, total: 0 } })
    try {
      await pullAllData(localRepo, serverTransport, {
        onProgress: (event) => {
          set({ pullProgress: { running: true, kind: event.kind, fetched: event.fetched, total: event.total } })
        },
      })
      await get().refresh()
      return { ok: true, message: 'Data master & PO berhasil diunduh.' }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Unduh data gagal.',
      }
    } finally {
      set((state) => ({ pullProgress: { ...state.pullProgress, running: false } }))
    }
  },

  sync: async () => {
    if (!isBrowser()) return { ok: false, message: 'Tidak tersedia.' }
    if (!navigator.onLine) {
      await get().refresh()
      return { ok: false, message: 'Sedang offline. Sinkronisasi dilewati.' }
    }
    set({ syncing: true })
    try {
      const outcome = await syncOutbox(localRepo, serverTransport, {
        deviceId: (await localRepo.ensureDeviceId()) ?? undefined,
      })

      // Auto-refresh PO list if a session is rejected because the PO was closed/deleted,
      // so POs that are no longer CHECKED are removed from the local list.
      const hasRejectedPurchase = outcome.results.some(
        (result) =>
          result.status === 'FAILED' &&
          (result.code === 'PURCHASE_NOT_CHECKED' || result.code === 'PURCHASE_NOT_FOUND'),
      )
      if (hasRejectedPurchase) {
        try {
          await refreshPurchases(localRepo, serverTransport)
        } catch {
          // PO refresh failure should not fail the sync result.
        }
      }
      await get().refresh()

      const user = get().user
      if (outcome.revokedUserIds.length > 0 && user && outcome.revokedUserIds.includes(user.userId)) {
        await get().logout()
        return {
          ok: false,
          message: 'Kredensial Anda berubah di sistem pusat. Silakan login online kembali.',
        }
      }
      if (outcome.error) return { ok: false, message: outcome.error }
      if (outcome.attempted === 0) return { ok: true, message: 'Tidak ada data yang perlu dikirim.' }
      return {
        ok: outcome.failed === 0,
        message: `${outcome.synced} sesi tersinkron, ${outcome.failed} gagal.`,
      }
    } finally {
      set({ syncing: false })
    }
  },

  refreshPurchases: async () => {
    if (!isBrowser()) return { ok: false, message: 'Tidak tersedia.' }
    if (!navigator.onLine) return { ok: false, message: 'Sedang offline.' }
    try {
      const result = await refreshPurchases(localRepo, serverTransport)
      await get().refresh()
      if (result.removedCount > 0) {
        return {
          ok: true,
          message: `${result.removedCount} PO ditutup (CLOSED) & dihapus dari daftar. ${result.purchases} PO aktif.`,
        }
      }
      return { ok: true, message: `Daftar PO disegarkan. ${result.purchases} PO aktif (CHECKED).` }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Gagal memperbarui PO.' }
    }
  },
})