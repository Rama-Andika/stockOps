import type { StateCreator } from 'zustand'
import { localRepo } from '../../db/local-repo'
import type { LocalCredential } from '../../db/local-db'
import {
  DEFAULT_PBKDF2_ITERATIONS,
  credentialKey,
  derivePasswordHash,
  expiryFrom,
  generateSalt,
  verifyOfflineCredential,
} from '../../auth/offline-auth'
import { serverTransport } from '../../sync/transport'
import { INSECURE_CONTEXT_MESSAGE, hasWebCrypto } from '../../secure-context'
import { MASTER_DATA_STALE_HOURS } from '~/shared/constants'
import { CURRENT_USER_KEY, isBrowser } from './helpers'
import type { ActionResult, AppState, AuthState, CurrentUser } from './types'

const DEVICE_SECRET_ITERATIONS = DEFAULT_PBKDF2_ITERATIONS

/** Master data stale threshold in milliseconds (FR-2.1). */
const MASTER_STALE_MS = MASTER_DATA_STALE_HOURS * 60 * 60 * 1000

/**
 * FR-2.1: FULL download only if data has never been downloaded (lastPullAt empty),
 * its value is invalid, or older than the stale threshold (12 hours).
 */
function shouldFullDownload(lastPullAt: string | null, now: Date): boolean {
  if (!lastPullAt) return true
  const pulledAt = new Date(lastPullAt).getTime()
  if (!Number.isFinite(pulledAt)) return true
  return now.getTime() - pulledAt > MASTER_STALE_MS
}

export const createAuthSlice: StateCreator<AppState, [], [], AuthState> = (set, get) => {
  const persistUser = (next: CurrentUser | null) => {
    set({ user: next })
    if (isBrowser()) {
      if (next) window.localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(next))
      else window.localStorage.removeItem(CURRENT_USER_KEY)
    }
  }

  return {
    user: null,
    deviceId: null,
    credentials: [],
    sessionTtlDaysLeft: null,

    loginOnline: async (loginId, password) => {
      if (!isBrowser()) return { ok: false, message: 'Tidak tersedia.' }
      // Without WebCrypto the credential cannot be stored after the server accepts it.
      if (!hasWebCrypto()) return { ok: false, message: INSECURE_CONTEXT_MESSAGE }
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
      await get().refresh()

      // FR-2.1: full download only when data does not exist or is stale (> 12 hours).
      // Otherwise, a lightweight PO refresh suffices so master data is not re-downloaded on every login.
      if (shouldFullDownload(get().lastPullAt, new Date())) {
        const pull = await get().downloadData()
        return pull.ok
          ? { ok: true, message: 'Login berhasil. Data sudah diunduh.' }
          : { ok: true, message: `Login berhasil, tetapi unduh data gagal: ${pull.message}` }
      }

      const po = await get().refreshPurchases()
      return po.ok
        ? { ok: true, message: 'Login berhasil. Daftar PO diperbarui.' }
        : { ok: true, message: `Login berhasil, tetapi pembaruan PO gagal: ${po.message}` }
    },

    loginOffline: async (loginId, password) => {
      if (!isBrowser()) return { ok: false, message: 'Tidak tersedia.' }
      if (!hasWebCrypto()) return { ok: false, message: INSECURE_CONTEXT_MESSAGE }
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
      await get().refresh()
      return { ok: true, message: 'Login offline berhasil.' }
    },

    logout: async () => {
      persistUser(null)
      // FR-1.5: local data remains stored, only application access is locked.
    },
  }
}