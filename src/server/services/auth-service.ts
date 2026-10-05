import { eq, inArray } from 'drizzle-orm'
import { getDb, type Database } from '../db/client'
import { sysuser } from '../db/schema'
import { computeFingerprint, verifyLegacyPassword } from '../auth/credentials'
import { serverEnv } from '../env'
import type {
  CheckCredentialsResult,
  CredentialFingerprint,
  LoginResult,
} from '~/shared/schemas'

export interface LoginInput {
  loginId: string
  password: string
  deviceId: string
}

/**
 * FR-1.1: First online login on a device.
 * Verification against `sysuser` (legacy password = plaintext).
 */
export async function loginOnline(input: LoginInput, db: Database = getDb()): Promise<LoginResult> {
  try {
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
      // Plaintext password is NOT sent/cached; only fingerprint (BR-19).
      fingerprint: computeFingerprint(input.password),
      serverTime: new Date().toISOString(),
      sessionTtlDays: serverEnv.sessionTtlDays,
    }
  } catch (error) {
    return {
      ok: false,
      code: 'SERVER_ERROR',
      message: error instanceof Error ? error.message : 'Kesalahan server tidak dikenal.',
    }
  }
}

/**
 * BR-19 / FR-1.6: detect changed / missing credentials.
 * Note: active status (user_status) is deliberately NOT checked anymore (see
 * "ignore user_status" change plan); inactive users are still considered valid.
 * Applies to ALL users cached on the device, not just the one currently logged in.
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
      !row.password || computeFingerprint(row.password) !== credential.fingerprint
    if (loginChanged || passwordChanged) {
      revoked.push({ userId: credential.userId, reason: 'CHANGED' })
    }
  }
  return revoked
}
