/**
 * Password fingerprints: how the server detects that a cached credential is no longer valid.
 *
 * A PDT may work offline for days, so a password or login_id changed in `sysuser` has to be
 * noticed at the next sync and the device's cached credentials revoked. Comparing passwords
 * directly would mean keeping one on the device; instead the server derives an HMAC
 * fingerprint at online login, the device caches only that, sends it back with every sync,
 * and the server recomputes it from `sysuser` to compare.
 *
 * The HMAC key never leaves the server. Two consequences worth knowing before touching it:
 * no plaintext password is ever stored on or sent to a device, and changing the key
 * invalidates every cached credential on every device at once — which is a usable kill switch
 * but also an accidental fleet-wide logout if it happens during a shift.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { serverEnv } from '~/server/env'

export function computeFingerprint(
  password: string,
  secret: string = serverEnv.credentialHmacSecret,
): string {
  return createHmac('sha256', secret).update(password, 'utf8').digest('hex')
}

/** Constant-time string comparison. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufferA = Buffer.from(a, 'utf8')
  const bufferB = Buffer.from(b, 'utf8')
  if (bufferA.length !== bufferB.length) return false
  return timingSafeEqual(bufferA, bufferB)
}

/**
 * Legacy password verification.
 * NOTE: The admin system stores passwords as plaintext (legacy).
 * Comparison is performed in constant time to mitigate timing attack risks.
 */
export function verifyLegacyPassword(input: string, stored: string | null | undefined): boolean {
  return safeEqual(input, stored)
}
