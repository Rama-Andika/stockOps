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
  /**
   * A newer service worker is installed and waiting. One-way: a build does not un-deploy itself,
   * so nothing ever sets this back to false. Whether the BANNER shows is `updateSnoozed`'s job,
   * not this flag's.
   */
  updateReady: boolean
  /**
   * True while the operator's "Nanti" is still in force. In memory on purpose, NOT persisted:
   * closing the app is itself a way of taking the update, so a fresh app session should offer it
   * again. The window is UPDATE_SNOOZE_MS in app-slice.ts.
   */
  updateSnoozed: boolean
  markUpdateReady: () => void
  snoozeUpdate: () => void
  /**
   * Cancels an active "Nanti". Called by "Cek Pembaruan" in Pengaturan: asking for a check IS
   * asking to see the offer, and without this the operator would get a toast pointing at a banner
   * that is still snoozed and therefore invisible.
   */
  clearUpdateSnooze: () => void
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