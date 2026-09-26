import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { localRepo } from '../db/local-repo'
import type { LocalCredential } from '../db/local-db'
import {
  DEFAULT_PBKDF2_ITERATIONS,
  credentialKey,
  derivePasswordHash,
  expiryFrom,
  generateSalt,
  isCredentialExpired,
  remainingDays,
  verifyOfflineCredential,
} from '../auth/offline-auth'
import { serverTransport } from '../sync/transport'
import { countPendingSessions, pullAllData, refreshPurchases, syncOutbox } from '../sync/engine'
import { SESSION_STATUS } from '~/shared/constants'

const CURRENT_USER_KEY = 'stockops.currentUser'
const DEVICE_SECRET_ITERATIONS = DEFAULT_PBKDF2_ITERATIONS

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

export interface AppContextValue {
  ready: boolean
  user: CurrentUser | null
  deviceId: string | null
  online: boolean
  pendingCount: number
  syncing: boolean
  pulling: PullProgressState
  lastPullAt: string | null
  credentials: LocalCredential[]
  sessionTtlDaysLeft: number | null
  refreshState: () => Promise<void>
  loginOnline: (loginId: string, password: string) => Promise<ActionResult>
  loginOffline: (loginId: string, password: string) => Promise<ActionResult>
  logout: () => Promise<void>
  downloadData: () => Promise<ActionResult>
  syncNow: () => Promise<ActionResult>
  refreshPurchasesNow: () => Promise<ActionResult>
}

export const AppContext = createContext<AppContextValue | null>(null)

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [online, setOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [pulling, setPulling] = useState<PullProgressState>({ running: false, kind: '', fetched: 0, total: 0 })
  const [lastPullAt, setLastPullAt] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<LocalCredential[]>([])
  const [sessionTtlDaysLeft, setSessionTtlDaysLeft] = useState<number | null>(null)
  const mounted = useRef(true)

  const refreshState = useCallback(async () => {
    if (!isBrowser()) return
    setPendingCount(await countPendingSessions(localRepo))
    setLastPullAt(await localRepo.getMeta('lastPullAt'))
    const all = await localRepo.listCredentials()
    setCredentials(all)
    const device = await localRepo.ensureDeviceId()
    setDeviceId(device)
    const currentRaw = window.localStorage.getItem(CURRENT_USER_KEY)
    if (currentRaw) {
      try {
        const parsed = JSON.parse(currentRaw) as CurrentUser
        const credential = all.find((entry) => entry.userId === parsed.userId)
        if (credential && isCredentialExpired(credential, new Date())) {
          window.localStorage.removeItem(CURRENT_USER_KEY)
          setUser(null)
          setSessionTtlDaysLeft(0)
        } else {
          setUser(parsed)
          setSessionTtlDaysLeft(credential ? remainingDays(credential, new Date()) : null)
        }
      } catch {
        window.localStorage.removeItem(CURRENT_USER_KEY)
        setUser(null)
      }
    } else {
      setUser(null)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    if (!isBrowser()) {
      setReady(true)
      return
    }
    void (async () => {
      await refreshState()
      if (mounted.current) setReady(true)
    })()
    const updateOnline = () => setOnline(navigator.onLine)
    updateOnline()
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    return () => {
      mounted.current = false
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
    }
  }, [refreshState])

  const persistUser = useCallback((next: CurrentUser | null) => {
    setUser(next)
    if (!isBrowser()) return
    if (next) window.localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(next))
    else window.localStorage.removeItem(CURRENT_USER_KEY)
  }, [])

  const downloadData = useCallback(async (): Promise<ActionResult> => {
    if (!isBrowser()) return { ok: false, message: 'Tidak tersedia.' }
    setPulling({ running: true, kind: '', fetched: 0, total: 0 })
    try {
      await pullAllData(localRepo, serverTransport, {
        onProgress: (event) => {
          if (!mounted.current) return
          setPulling({ running: true, kind: event.kind, fetched: event.fetched, total: event.total })
        },
      })
      await refreshState()
      return { ok: true, message: 'Data master & PO berhasil diunduh.' }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Unduh data gagal.',
      }
    } finally {
      if (mounted.current) setPulling((current) => ({ ...current, running: false }))
    }
  }, [refreshState])

  const loginOnline = useCallback(
    async (loginId: string, password: string): Promise<ActionResult> => {
      if (!isBrowser()) return { ok: false, message: 'Tidak tersedia.' }
      const device = await localRepo.ensureDeviceId()
      const result = await serverTransport.login({ loginId, password, deviceId: device })
      if (!result.ok) return { ok: false, message: result.message }

      const salt = generateSalt()
      const passwordHash = await derivePasswordHash(password, salt, DEVICE_SECRET_ITERATIONS)
      const now = new Date()
      const credential: LocalCredential = {
        key: credentialKey(device, result.user.userId),
        deviceId: device,
        userId: result.user.userId,
        loginId: result.user.loginId,
        fullName: result.user.fullName,
        companyId: result.user.companyId,
        salt,
        passwordHash,
        iterations: DEVICE_SECRET_ITERATIONS,
        fingerprint: result.fingerprint,
        lastOnlineLoginAt: now.toISOString(),
        expiresAt: expiryFrom(now, result.sessionTtlDays),
      }
      await localRepo.saveCredential(credential)
      await localRepo.setMeta('userId', result.user.userId)
      persistUser({
        userId: result.user.userId,
        loginId: result.user.loginId,
        fullName: result.user.fullName,
        companyId: result.user.companyId,
      })
      await refreshState()

      // FR-2.1: unduh penuh otomatis setelah login online pertama.
      const pull = await downloadData()
      return pull.ok
        ? { ok: true, message: 'Login berhasil. Data sudah diunduh.' }
        : { ok: true, message: `Login berhasil, tetapi unduh data gagal: ${pull.message}` }
    },
    [downloadData, persistUser, refreshState],
  )

  const loginOffline = useCallback(
    async (loginId: string, password: string): Promise<ActionResult> => {
      if (!isBrowser()) return { ok: false, message: 'Tidak tersedia.' }
      const device = await localRepo.ensureDeviceId()
      const credential = await localRepo.getCredential(device, loginId)
      if (!credential) {
        return { ok: false, message: 'Perangkat ini belum pernah login online dengan ID tersebut.' }
      }
      const verification = await verifyOfflineCredential(credential, password, new Date())
      if (!verification.ok) {
        if (verification.reason === 'EXPIRED') {
          return { ok: false, message: 'Sesi kedaluwarsa (7 hari). Wajib login online.' }
        }
        return { ok: false, message: 'Password salah.' }
      }
      persistUser({
        userId: credential.userId,
        loginId: credential.loginId,
        fullName: credential.fullName,
        companyId: credential.companyId,
      })
      await refreshState()
      return { ok: true, message: 'Login offline berhasil.' }
    },
    [persistUser, refreshState],
  )

  const logout = useCallback(async (): Promise<void> => {
    persistUser(null)
    // FR-1.5: data lokal tetap tersimpan, hanya akses aplikasi yang dikunci.
  }, [persistUser])

  const syncNow = useCallback(async (): Promise<ActionResult> => {
    if (!isBrowser()) return { ok: false, message: 'Tidak tersedia.' }
    if (!navigator.onLine) return { ok: false, message: 'Sedang offline. Sinkronisasi dilewati.' }
    setSyncing(true)
    try {
      const outcome = await syncOutbox(localRepo, serverTransport, {
        deviceId: (await localRepo.ensureDeviceId()) ?? undefined,
      })
      await refreshState()

      if (outcome.revokedUserIds.length > 0 && user && outcome.revokedUserIds.includes(user.userId)) {
        await logout()
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
      if (mounted.current) setSyncing(false)
    }
  }, [logout, refreshState, user])

  const refreshPurchasesNow = useCallback(async (): Promise<ActionResult> => {
    if (!isBrowser()) return { ok: false, message: 'Tidak tersedia.' }
    if (!navigator.onLine) return { ok: false, message: 'Sedang offline.' }
    try {
      const result = await refreshPurchases(localRepo, serverTransport)
      await refreshState()
      return { ok: true, message: `${result.purchases} PO diperbarui.` }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Gagal memperbarui PO.' }
    }
  }, [refreshState])

  // Sinkronisasi otomatis saat kembali online (FR-5.1).
  useEffect(() => {
    if (!isBrowser() || !online || !user) return
    void (async () => {
      const pending = await countPendingSessions(localRepo)
      if (pending > 0) await syncNow()
    })()
  }, [online, user, syncNow])

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      user,
      deviceId,
      online,
      pendingCount,
      syncing,
      pulling,
      lastPullAt,
      credentials,
      sessionTtlDaysLeft,
      refreshState,
      loginOnline,
      loginOffline,
      logout,
      downloadData,
      syncNow,
      refreshPurchasesNow,
    }),
    [
      ready,
      user,
      deviceId,
      online,
      pendingCount,
      syncing,
      pulling,
      lastPullAt,
      credentials,
      sessionTtlDaysLeft,
      refreshState,
      loginOnline,
      loginOffline,
      logout,
      downloadData,
      syncNow,
      refreshPurchasesNow,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp harus dipakai di dalam AppProvider')
  return context
}

export { localRepo, SESSION_STATUS }
