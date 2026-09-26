import { createContext, useContext } from 'react'
import { createStore, useStore } from 'zustand'
import { createAppSlice } from './app-slice'
import { createAuthSlice } from './auth-slice'
import { createSyncSlice } from './sync-slice'
import type { AppState, AppStoreApi } from './types'

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