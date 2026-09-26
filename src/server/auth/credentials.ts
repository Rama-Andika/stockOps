/**
 * Fingerprint kredensial (BR-19).
 *
 * Kunci HMAC HANYA ada di server. Saat login online, server menghitung
 * fingerprint password dan mengembalikannya ke device untuk di-cache. Saat
 * sinkronisasi, device mengirim fingerprint itu kembali; server menghitung
 * ulang dari `sysuser` dan membandingkan. Dengan begitu:
 * - password plaintext tidak pernah perlu disimpan/dikirim ke device,
 * - device tidak perlu memegang kunci HMAC.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { serverEnv } from '../env'

export function computeFingerprint(
  password: string,
  secret: string = serverEnv.credentialHmacSecret,
): string {
  return createHmac('sha256', secret).update(password, 'utf8').digest('hex')
}

/** Perbandingan string konstan-waktu. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufferA = Buffer.from(a, 'utf8')
  const bufferB = Buffer.from(b, 'utf8')
  if (bufferA.length !== bufferB.length) return false
  return timingSafeEqual(bufferA, bufferB)
}

/**
 * Verifikasi password legacy.
 * CATATAN: sistem admin menyimpan password sebagai plaintext (legacy).
 * Perbandingan dilakukan konstan-waktu untuk mengurangi risiko timing attack.
 */
export function verifyLegacyPassword(input: string, stored: string | null | undefined): boolean {
  return safeEqual(input, stored)
}
