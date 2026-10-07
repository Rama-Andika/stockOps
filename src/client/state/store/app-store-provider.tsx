import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { localRepo } from '../../db/local-repo'
import { countPendingSessions } from '../../sync/engine'
import { PURCHASES_STALE_META_KEY } from '~/shared/constants'
import { isBrowser } from './helpers'
import { AppStoreContext, createAppStore } from './app-store'
import type { AppStoreApi } from './types'

export function AppStoreProvider({
  children,
  store,
}: {
  children: ReactNode
  store?: AppStoreApi
}) {
  const [fallback] = useState(() => createAppStore())
  const resolved = store ?? fallback

  const refresh = useStore(resolved, (state) => state.refresh)
  const online = useStore(resolved, (state) => state.online)
  // Primitive on purpose: refresh() re-creates the user object on every call, and an
  // object dependency would re-trigger the auto-sync effect after every sync (endless loop).
  const userId = useStore(resolved, (state) => state.user?.userId ?? null)
  const sync = useStore(resolved, (state) => state.sync)

  // Initialize on mount + monitor online/offline status.
  useEffect(() => {
    if (!isBrowser()) {
      resolved.setState({ ready: true })
      return
    }
    void (async () => {
      await localRepo.resetStaleSyncingSessions()
      await refresh()
      resolved.setState({ ready: true })
    })()
    const updateOnline = () => resolved.setState({ online: navigator.onLine })
    updateOnline()
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    return () => {
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
    }
  }, [resolved, refresh])

  // Push by itself the moment a connection comes back, or when someone logs in with work
  // already queued. The operator should never have to remember to press "Kirim" for a
  // delivery they finished an hour ago in a dead spot.
  useEffect(() => {
    if (!isBrowser() || !online || !userId) return
    void (async () => {
      const pending = await countPendingSessions(localRepo)
      // A PO refresh that failed after an earlier sync is retried once the device is online again.
      const purchasesStale = (await localRepo.getMeta(PURCHASES_STALE_META_KEY)) === '1'
      if (pending > 0 || purchasesStale) await sync()
    })()
  }, [online, userId, sync])

  return <AppStoreContext.Provider value={resolved}>{children}</AppStoreContext.Provider>
}