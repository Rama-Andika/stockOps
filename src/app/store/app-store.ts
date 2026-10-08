import { createContext, useContext } from 'react'
import { createStore, useStore } from 'zustand'
import { createAppSlice } from '~/app/store/app-slice'
import { createAuthSlice } from '~/app/store/auth-slice'
import { createSyncSlice } from '~/app/store/sync-slice'
import type { AppState, AppStoreApi } from '~/app/store/types'

export function createAppStore(): AppStoreApi {
  return createStore<AppState>()((...a) => ({
    ...createAppSlice(...a),
    ...createAuthSlice(...a),
    ...createSyncSlice(...a),
  }))
}

export const AppStoreContext = createContext<AppStoreApi | null>(null)

export function useAppStore<T>(selector: (state: AppState) => T): T {
  const store = useContext(AppStoreContext)
  if (!store) throw new Error('useAppStore harus dipakai di dalam AppStoreProvider')
  return useStore(store, selector)
}
