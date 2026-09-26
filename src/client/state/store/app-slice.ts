import type { StateCreator } from 'zustand'
import type { AppBootstrapState, AppState } from './types'

export const createAppSlice: StateCreator<AppState, [], [], AppBootstrapState> = (set) => ({
  ready: false,
  setReady: (ready) => set({ ready }),
})