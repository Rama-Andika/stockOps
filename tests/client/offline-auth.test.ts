import { describe, expect, it } from 'vitest'
import {
  credentialKey,
  derivePasswordHash,
  expiryFrom,
  generateSalt,
  isCredentialExpired,
  remainingDays,
  verifyOfflineCredential,
} from '~/client/auth/offline-auth'
import type { LocalCredential } from '~/client/db/local-db'

const ITERATIONS = 1_000 // sped up for tests

async function makeCredential(password: string, now = new Date('2026-01-01T00:00:00Z')): Promise<LocalCredential> {
  const salt = generateSalt()
  return {
    key: credentialKey('device-1', '1200001'),
    deviceId: 'device-1',
    userId: '1200001',
    loginId: 'gedesujana',
    fullName: 'I Gede Sujana',
    companyId: '0',
    salt,
    passwordHash: await derivePasswordHash(password, salt, ITERATIONS),
    iterations: ITERATIONS,
    fingerprint: 'fingerprint-dari-server',
    lastOnlineLoginAt: now.toISOString(),
    expiresAt: expiryFrom(now, 7),
  }
}

describe('offline-auth', () => {
  it('hash deterministik untuk salt & password yang sama', async () => {
    const salt = generateSalt()
    const a = await derivePasswordHash('rahasia', salt, ITERATIONS)
    const b = await derivePasswordHash('rahasia', salt, ITERATIONS)
    expect(a).toBe(b)
  })

  it('hash berbeda untuk salt berbeda (salt unik per device)', async () => {
    const a = await derivePasswordHash('rahasia', generateSalt(), ITERATIONS)
    const b = await derivePasswordHash('rahasia', generateSalt(), ITERATIONS)
    expect(a).not.toBe(b)
  })

  it('hash TIDAK sama dengan password plaintext', async () => {
    const salt = generateSalt()
    const hash = await derivePasswordHash('Desubali', salt, ITERATIONS)
    expect(hash).not.toContain('Desubali')
    expect(hash).toHaveLength(64)
  })

  it('menerima password benar saat offline', async () => {
    const credential = await makeCredential('Desubali')
    const result = await verifyOfflineCredential(credential, 'Desubali', new Date('2026-01-02T00:00:00Z'))
    expect(result).toEqual({ ok: true })
  })

  it('menolak password salah saat offline', async () => {
    const credential = await makeCredential('Desubali')
    const result = await verifyOfflineCredential(credential, 'salah', new Date('2026-01-02T00:00:00Z'))
    expect(result).toEqual({ ok: false, reason: 'WRONG_PASSWORD' })
  })

  it('menolak bila user belum pernah login online di device ini', async () => {
    const result = await verifyOfflineCredential(undefined, 'apa-saja', new Date())
    expect(result).toEqual({ ok: false, reason: 'NOT_CACHED' })
  })

  it('menolak setelah 7 hari walau password benar', async () => {
    const credential = await makeCredential('Desubali', new Date('2026-01-01T00:00:00Z'))
    const result = await verifyOfflineCredential(credential, 'Desubali', new Date('2026-01-09T00:00:00Z'))
    expect(result).toEqual({ ok: false, reason: 'EXPIRED' })
  })

  describe('kedaluwarsa', () => {
    it('expiryFrom menambah TTL hari', () => {
      const expires = expiryFrom(new Date('2026-01-01T00:00:00Z'), 7)
      expect(expires).toBe(new Date('2026-01-08T00:00:00Z').toISOString())
    })

    it('isCredentialExpired', () => {
      const credential = { expiresAt: new Date('2026-01-08T00:00:00Z').toISOString() }
      expect(isCredentialExpired(credential, new Date('2026-01-07T23:59:00Z'))).toBe(false)
      expect(isCredentialExpired(credential, new Date('2026-01-08T00:00:01Z'))).toBe(true)
    })

    it('remainingDays menampilkan sisa hari', () => {
      const credential = { expiresAt: new Date('2026-01-08T00:00:00Z').toISOString() }
      expect(remainingDays(credential, new Date('2026-01-01T00:00:00Z'))).toBe(7)
      expect(remainingDays(credential, new Date('2026-01-09T00:00:00Z'))).toBe(0)
    })
  })

  it('credentialKey memisahkan per device & user', () => {
    expect(credentialKey('device-1', '1200001')).toBe('device-1:1200001')
    expect(credentialKey('device-1', '1200001')).not.toBe(credentialKey('device-2', '1200001'))
    expect(credentialKey('device-1', '1200001')).not.toBe(credentialKey('device-1', '1200002'))
  })
})
