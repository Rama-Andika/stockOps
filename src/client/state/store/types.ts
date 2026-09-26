import type { StoreApi } from 'zustand'
import type { LocalCredential } from '../../db/local-db'

export interface CurrentUser {
  userId: string
  loginId: string
  fullName: string
  companyId: string
}

export interface ActionResult {
  ok: boolean
  message: string
}

export interface PullProgressState {
  running: boolean
  kind: string
  fetched: number
  total: number
}

export interface AppBootstrapState {
  ready: boolean
  setReady: (ready: boolean) => void
}

export interface AuthState {
  user: CurrentUser | null
  deviceId: string | null
  credentials: LocalCredential[]
  sessionTtlDaysLeft: number | null
  loginOnline: (loginId: string, password: string) => Promise<ActionResult>
  loginOffline: (loginId: string, password: string) => Promise<ActionResult>
  logout: () => Promise<void>
}

export interface SyncState {
  online: boolean
  pendingCount: number
  syncing: boolean
  pullProgress: PullProgressState
  lastPullAt: string | null
  refresh: () => Promise<void>
  downloadData: () => Promise<ActionResult>
  sync: () => Promise<ActionResult>
  refreshPurchases: () => Promise<ActionResult>
}

export interface AppState extends AppBootstrapState, AuthState, SyncState {}

export type AppStoreApi = StoreApi<AppState>