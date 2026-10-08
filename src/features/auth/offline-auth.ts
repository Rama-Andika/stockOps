/**
 * Logging in with no connection, which a warehouse PDT does most of the time.
 *
 * Passwords are NEVER kept as plain text. What is cached is a PBKDF2-SHA256 hash with a random
 * salt per (device, user), so a stolen device yields nothing reusable. Offline login is
 * allowed for a limited number of days since the last online login; after that the operator
 * must come back online, which is also the moment the server gets to revoke a credential
 * whose password changed.
 *
 * The server-issued HMAC fingerprint stored alongside is for that revocation check only. It is
 * not a second password and must never be accepted in place of one.
 *
 * All of this needs Web Crypto, which browsers only expose in a secure context: on localhost
 * or HTTPS. A PDT opening the app over plain http on a LAN address cannot log in at all.
 */

import type { LocalCredential } from '~/data/local-db'

export const DEFAULT_PBKDF2_ITERATIONS = 100_000
export const PASSWORD_HASH_LENGTH_BITS = 256

function subtle(): SubtleCrypto {
  const cryptoObj = globalThis.crypto
  if (!cryptoObj?.subtle) {
    throw new Error('WebCrypto (crypto.subtle) tidak tersedia di lingkungan ini.')
  }
  return cryptoObj.subtle
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function generateSalt(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength)
  const cryptoObj = globalThis.crypto
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function derivePasswordHash(
  password: string,
  salt: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<string> {
  const encoder = new TextEncoder()
  const keyMaterial = await subtle().importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await subtle().deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    PASSWORD_HASH_LENGTH_BITS,
  )
  return toHex(bits)
}

export function credentialKey(deviceId: string, userId: string): string {
  return `${deviceId}:${userId}`
}

export function expiryFrom(now: Date, ttlDays: number): string {
  return new Date(now.getTime() + ttlDays * 86_400_000).toISOString()
}

export function isCredentialExpired(
  credential: Pick<LocalCredential, 'expiresAt'>,
  now: Date,
): boolean {
  const expires = new Date(credential.expiresAt).getTime()
  return !Number.isFinite(expires) || expires <= now.getTime()
}

export function remainingDays(credential: Pick<LocalCredential, 'expiresAt'>, now: Date): number {
  const expires = new Date(credential.expiresAt).getTime()
  return Math.max(0, Math.ceil((expires - now.getTime()) / 86_400_000))
}

export type OfflineLoginFailure = 'NOT_CACHED' | 'EXPIRED' | 'WRONG_PASSWORD'

export interface OfflineVerifyResult {
  ok: boolean
  reason?: OfflineLoginFailure
}

/**
 * Checks a password against the credential cached on this device, and refuses one that has
 * gone past its offline window. The distinct failure reasons matter to the caller: "never
 * cached here" and "expired, go online" are different instructions for the operator.
 */
export async function verifyOfflineCredential(
  credential: LocalCredential | undefined,
  password: string,
  now: Date,
): Promise<OfflineVerifyResult> {
  if (!credential) return { ok: false, reason: 'NOT_CACHED' }
  if (isCredentialExpired(credential, now)) return { ok: false, reason: 'EXPIRED' }
  const hash = await derivePasswordHash(password, credential.salt, credential.iterations)
  return hash === credential.passwordHash ? { ok: true } : { ok: false, reason: 'WRONG_PASSWORD' }
}
