/**
 * Credential fingerprinting (BR-19).
 *
 * The HMAC key exists ONLY on the server. During online login, the server computes
 * the password fingerprint and returns it to the device to be cached. During
 * synchronization, the device sends the fingerprint back; the server recomputes
 * it from `sysuser` and compares. This ensures:
 * - plaintext passwords never need to be stored/sent to the device,
 * - the device does not need to hold the HMAC key.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { serverEnv } from '../env'

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
