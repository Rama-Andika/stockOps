/**
 * Offline authentication (FR-1.2, FR-1.3, NF-5).
 *
 * Passwords are NEVER stored as plain text: what is stored is a
 * PBKDF2-SHA256 hash with a random salt per (device, user). HMAC fingerprint
 * (computed by server) is stored separately only for credential change detection
 * (BR-19) and does not substitute for passwords.
 */

import type { LocalCredential } from '../db/local-db'

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
  const keyMaterial = await subtle().importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
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

/** FR-1.2/FR-1.3: verify offline login against local credentials. */
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
