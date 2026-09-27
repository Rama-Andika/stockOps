import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { localRepo } from '../../db/local-repo'
import { countPendingSessions } from '../../sync/engine'
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
  const user = useStore(resolved, (state) => state.user)
  const sync = useStore(resolved, (state) => state.sync)

  // Inisialisasi saat mount + pemantau status online/offline.
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

  // Sinkronisasi otomatis saat kembali online (FR-5.1).
  useEffect(() => {
    if (!isBrowser() || !online || !user) return
    void (async () => {
      const pending = await countPendingSessions(localRepo)
      if (pending > 0) await sync()
    })()
  }, [online, user, sync])

  return <AppStoreContext.Provider value={resolved}>{children}</AppStoreContext.Provider>
}