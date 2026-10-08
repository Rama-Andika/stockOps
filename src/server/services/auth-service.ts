import { eq, inArray } from 'drizzle-orm'
import { getDb, type Database } from '~/server/db/client'
import { sysuser } from '~/server/db/schema'
import { computeFingerprint, safeEqual, verifyLegacyPassword } from '~/server/crypto/credentials'
import { serverEnv } from '~/server/env'
import type {
  CheckCredentialsResult,
  CredentialFingerprint,
  LoginResult,
} from '~/core/contracts/schemas'

export interface LoginInput {
  loginId: string
  password: string
  deviceId: string
}

/**
 * Online login, verified against `sysuser` — whose passwords are plaintext, because that is
 * how the admin system stores them and this app does not get to change it.
 *
 * Required the first time a user signs in on a device: the fingerprint returned here is what
 * the device caches to allow offline logins afterwards.
 */
export async function loginOnline(input: LoginInput, dbOverride?: Database): Promise<LoginResult> {
  try {
    // Resolved inside the try: a failing pool (e.g. rejected production config) must be
    // answered with the generic message below, not thrown raw to the client.
    const db = dbOverride ?? getDb()
    const candidates = await db
      .select({
        userId: sysuser.userId,
        loginId: sysuser.loginId,
        password: sysuser.password,
        fullName: sysuser.fullName,
        companyId: sysuser.companyId,
      })
      .from(sysuser)
      .where(eq(sysuser.loginId, input.loginId))
      .limit(10)

    const match = candidates.find((row) => verifyLegacyPassword(input.password, row.password))

    if (!match) {
      return {
        ok: false,
        code: 'INVALID_CREDENTIALS',
        message: 'ID atau password salah.',
      }
    }

    return {
      ok: true,
      user: {
        userId: String(match.userId),
        loginId: match.loginId ?? input.loginId,
        fullName: match.fullName ?? input.loginId,
        companyId: String(match.companyId ?? 0n),
      },
      // The device caches this fingerprint, never the password itself. It is also what lets
      // the server notice later that the password in `sysuser` has changed.
      fingerprint: computeFingerprint(input.password),
      serverTime: new Date().toISOString(),
      sessionTtlDays: serverEnv.sessionTtlDays,
    }
  } catch (error) {
    // Internal details (SQL, host, driver) stay in the server log only.
    console.error('[auth] loginOnline gagal:', error)
    return {
      ok: false,
      code: 'SERVER_ERROR',
      message: 'Server sedang bermasalah. Coba lagi beberapa saat lagi.',
    }
  }
}

/**
 * Which of a device's cached credentials are no longer valid: the login_id or the password in
 * `sysuser` changed, or the user row is gone. A changed password must stop working on every
 * device, and since a PDT can be offline for days, the next sync is the first chance to say so.
 *
 * Applies to ALL users cached on the device, not only the one currently signed in — one PDT is
 * shared between operators, and a revoked colleague must not be able to log in on it either.
 *
 * `user_status` is deliberately NOT checked: an inactive user still counts as valid here. That
 * was a product decision, so do not "fix" it by adding the condition back.
 */
export async function checkCredentialRevocations(
  credentials: readonly CredentialFingerprint[],
  db: Database = getDb(),
): Promise<CheckCredentialsResult['revoked']> {
  if (credentials.length === 0) return []

  const ids = credentials.map((credential) => BigInt(credential.userId))
  const rows = await db
    .select({
      userId: sysuser.userId,
      loginId: sysuser.loginId,
      password: sysuser.password,
    })
    .from(sysuser)
    .where(inArray(sysuser.userId, ids))

  const byId = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    byId.set(String(row.userId), row)
  }

  const revoked: CheckCredentialsResult['revoked'] = []
  for (const credential of credentials) {
    const row = byId.get(credential.userId)
    if (!row) {
      revoked.push({ userId: credential.userId, reason: 'MISSING' })
      continue
    }
    const loginChanged = (row.loginId ?? '') !== credential.loginId
    const passwordChanged =
      !row.password || !safeEqual(computeFingerprint(row.password), credential.fingerprint)
    if (loginChanged || passwordChanged) {
      revoked.push({ userId: credential.userId, reason: 'CHANGED' })
    }
  }
  return revoked
}

/** Returned/thrown when a request carries no credential the server still accepts. */
export const UNAUTHORIZED_MESSAGE =
  'Perangkat belum terautentikasi atau kredensial sudah tidak berlaku. Silakan login online ulang.'

/**
 * Device authentication for server functions. A device proves it is trusted by
 * sending the fingerprints it received at online login; only the server can compute
 * them (HMAC secret). Returns the userIds whose credential is still valid.
 */
export async function findAuthorizedUserIds(
  credentials: readonly CredentialFingerprint[],
  db: Database = getDb(),
): Promise<string[]> {
  if (credentials.length === 0) return []
  const revoked = await checkCredentialRevocations(credentials, db)
  const revokedIds = new Set(revoked.map((entry) => entry.userId))
  const valid = credentials
    .map((credential) => credential.userId)
    .filter((userId) => !revokedIds.has(userId))
  return [...new Set(valid)]
}

/** Throws when none of the device's cached credentials is still valid. */
export async function assertAuthorizedDevice(
  credentials: readonly CredentialFingerprint[],
  db: Database = getDb(),
): Promise<void> {
  const authorized = await findAuthorizedUserIds(credentials, db)
  if (authorized.length === 0) throw new Error(UNAUTHORIZED_MESSAGE)
}
