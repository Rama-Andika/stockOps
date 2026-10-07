import type { StateCreator } from 'zustand'
import { localRepo } from '../../db/local-repo'
import { isCredentialExpired, remainingDays } from '../../auth/offline-auth'
import { serverTransport } from '../../sync/transport'
import { countPendingSessions, pullAllData, refreshPurchases, syncOutbox } from '../../sync/engine'
import { PURCHASES_STALE_META_KEY } from '~/shared/constants'
import { DIAG_EVENT } from '~/client/diagnostics/events'
import { CURRENT_USER_KEY, isBrowser } from './helpers'
import type { ActionResult, AppState, CurrentUser, SyncState } from './types'

export const createSyncSlice: StateCreator<AppState, [], [], SyncState> = (set, get) => {
  // ONE queue for everything that pushes to or replaces local data: sync() (auto-sync, Upload
  // button, finalize, retry), downloadData() and refreshPurchases(). A task starts only after the
  // previous one finished, so a download can never overwrite the receivedQty that markSynced
  // just updated (or read the server before a push committed), and the same outbox is never
  // pushed twice in parallel.
  let queue: Promise<unknown> = Promise.resolve()
  const runExclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task)
    // The queue itself never rejects, so one failing task cannot block the ones behind it;
    // the caller of that task still receives its rejection through `run`.
    queue = run.catch(() => undefined)
    return run
  }

  // A second call while one is queued/running joins it instead of downloading twice.
  let downloadInFlight: Promise<ActionResult> | null = null
  let refreshInFlight: Promise<ActionResult> | null = null

  /** Remembers (or forgets) that the PO list must be refreshed again; never throws. */
  const setPurchasesStale = async (stale: boolean): Promise<void> => {
    try {
      await localRepo.setMeta(PURCHASES_STALE_META_KEY, stale ? '1' : '0')
    } catch {
      // Bookkeeping must not turn a sync result into an error.
    }
  }

  /**
   * Refreshes the PO list after a sync; it never throws, so it cannot fail the sync result.
   * The `purchasesStale` flag is raised BEFORE the download and cleared only when it succeeds, so
   * a closed tab or a dead battery in the middle of the refresh still leaves a trace and the
   * next sync retries it.
   */
  const refreshPurchasesAfterSync = async (): Promise<boolean> => {
    await setPurchasesStale(true)
    try {
      await refreshPurchases(localRepo, serverTransport)
      await setPurchasesStale(false)
      return true
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Gagal memperbarui PO.'
      try {
        await localRepo.logEvent({
          level: 'warn',
          category: 'sync',
          event: DIAG_EVENT.REFRESH_PO_RETRY_PENDING,
          message: `Refresh PO gagal, akan dicoba lagi: ${reason}`,
        })
      } catch {
        // Bookkeeping must not turn a sync result into an error.
      }
      return false
    }
  }

  const runSync = async (): Promise<ActionResult> => {
    if (!navigator.onLine) {
      await get().refresh()
      return { ok: false, message: 'Sedang offline. Sinkronisasi dilewati.' }
    }
    set({ syncing: true })
    try {
      const outcome = await syncOutbox(localRepo, serverTransport, {
        deviceId: (await localRepo.ensureDeviceId()) ?? undefined,
      })

      // Refresh the PO list from the server when:
      // - a session was rejected because the PO was closed/deleted (remove it locally), or
      // - the server answered IDEMPOTENT_REPLAY: the document already existed, so the local
      //   receivedQty was not incremented and must come from the server snapshot instead.
      const needsPurchaseRefresh = outcome.results.some(
        (result) =>
          result.code === 'IDEMPOTENT_REPLAY' ||
          (result.status === 'FAILED' &&
            (result.code === 'PURCHASE_NOT_CHECKED' || result.code === 'PURCHASE_NOT_FOUND')),
      )
      // A refresh that failed after an earlier sync (flag set by refreshPurchasesAfterSync) is
      // retried here, even when nothing was pushed this time.
      const refreshStillPending = (await localRepo.getMeta(PURCHASES_STALE_META_KEY)) === '1'
      let purchaseRefreshFailed = false
      if (needsPurchaseRefresh || refreshStillPending) {
        // Right after a failed push the server is most likely unreachable, and after a revoked
        // credential the pull would be rejected: skip the download (it could hold the queue for
        // up to a minute) and just remember it for the next sync.
        const currentUser = get().user
        const currentUserRevoked = Boolean(
          currentUser && outcome.revokedUserIds.includes(currentUser.userId),
        )
        if (outcome.error || currentUserRevoked) {
          if (needsPurchaseRefresh) await setPurchasesStale(true)
        } else {
          purchaseRefreshFailed = !(await refreshPurchasesAfterSync())
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
      const refreshNote = purchaseRefreshFailed
        ? ' Daftar PO belum diperbarui dan akan dicoba lagi.'
        : ''
      if (outcome.attempted === 0) {
        return { ok: true, message: `Tidak ada data yang perlu dikirim.${refreshNote}` }
      }
      return {
        ok: outcome.failed === 0,
        message: `${outcome.synced} sesi tersinkron, ${outcome.failed} gagal.${refreshNote}`,
      }
    } finally {
      set({ syncing: false })
    }
  }

  return {
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

    downloadData: () => {
      if (!isBrowser()) return Promise.resolve({ ok: false, message: 'Tidak tersedia.' })
      if (downloadInFlight) return downloadInFlight
      // Shown at once, so the button is disabled even while this waits behind a running sync.
      set({ pullProgress: { running: true, kind: '', fetched: 0, total: 0 } })
      const run = runExclusive(async (): Promise<ActionResult> => {
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
          // Clear the in-flight marker FIRST: if a store subscriber throws inside set(), a stale
          // promise must not stay behind and answer every later downloadData() call.
          downloadInFlight = null
          set((state) => ({ pullProgress: { ...state.pullProgress, running: false } }))
        }
      })
      downloadInFlight = run
      return run
    },

    sync: () => {
      if (!isBrowser()) return Promise.resolve({ ok: false, message: 'Tidak tersedia.' })
      return runExclusive(runSync)
    },

    refreshPurchases: () => {
      if (!isBrowser()) return Promise.resolve({ ok: false, message: 'Tidak tersedia.' })
      if (!navigator.onLine) return Promise.resolve({ ok: false, message: 'Sedang offline.' })
      if (refreshInFlight) return refreshInFlight
      const run = runExclusive(async (): Promise<ActionResult> => {
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
          const reason = error instanceof Error ? error.message : 'Gagal memperbarui PO.'
          // The manual button's own failure path. Without this, the only refresh failure with a
          // trace would be the automatic one after a sync — and "saya sudah tekan Refresh PO tapi
          // PO-nya tidak berubah" would stay unanswerable.
          try {
            await localRepo.logEvent({
              level: 'warn',
              category: 'pull',
              event: DIAG_EVENT.REFRESH_PO_FAILED,
              message: `Refresh PO gagal: ${reason}`,
            })
          } catch {
            // Bookkeeping must not turn a refresh result into something else.
          }
          return { ok: false, message: reason }
        } finally {
          refreshInFlight = null
        }
      })
      refreshInFlight = run
      return run
    },
  }
}