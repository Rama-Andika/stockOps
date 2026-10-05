import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb, closeDb } from '~/server/db/client'
import {
  UNAUTHORIZED_MESSAGE,
  assertAuthorizedDevice,
  checkCredentialRevocations,
  findAuthorizedUserIds,
  loginOnline,
} from '~/server/services/auth-service'
import { computeFingerprint } from '~/server/auth/credentials'
import { CREDENTIALS, FIXTURE, queryRows, seedAll } from './helpers'

describe('auth-service', () => {
  beforeEach(async () => {
    await seedAll()
  })

  afterAll(async () => {
    await closeDb()
  })

  describe('loginOnline (FR-1.1)', () => {
    it('berhasil untuk kredensial benar & user aktif', async () => {
      const result = await loginOnline({
        loginId: CREDENTIALS.ACTIVE.loginId,
        password: CREDENTIALS.ACTIVE.password,
        deviceId: 'device-a',
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.user.userId).toBe(FIXTURE.user.ACTIVE)
      expect(result.user.fullName).toBe('I Gede Sujana')
      expect(result.sessionTtlDays).toBe(7)
      expect(result.fingerprint).toHaveLength(64)
    })

    it('TIDAK pernah mengembalikan password plaintext, hanya fingerprint', async () => {
      const result = await loginOnline({
        loginId: CREDENTIALS.ACTIVE.loginId,
        password: CREDENTIALS.ACTIVE.password,
        deviceId: 'device-a',
      })
      expect(result.ok).toBe(true)
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain(CREDENTIALS.ACTIVE.password)
      expect(serialized).toContain(computeFingerprint(CREDENTIALS.ACTIVE.password))
    })

    it('menolak password salah', async () => {
      const result = await loginOnline({
        loginId: CREDENTIALS.ACTIVE.loginId,
        password: 'password-salah',
        deviceId: 'device-a',
      })
      expect(result).toEqual({
        ok: false,
        code: 'INVALID_CREDENTIALS',
        message: 'ID atau password salah.',
      })
    })

    it('menolak login_id yang tidak dikenal', async () => {
      const result = await loginOnline({
        loginId: 'tidak-ada',
        password: 'apa-saja',
        deviceId: 'device-a',
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('INVALID_CREDENTIALS')
    })

    it('mengizinkan user non-aktif login karena user_status diabaikan', async () => {
      const result = await loginOnline({
        loginId: CREDENTIALS.INACTIVE.loginId,
        password: CREDENTIALS.INACTIVE.password,
        deviceId: 'device-a',
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.user.userId).toBe(FIXTURE.user.INACTIVE)
    })
  })

  describe('checkCredentialRevocations (FR-1.6 / BR-19)', () => {
    it('tidak mencabut apa pun bila kredensial belum berubah', async () => {
      const revoked = await checkCredentialRevocations([
        {
          userId: FIXTURE.user.ACTIVE,
          loginId: CREDENTIALS.ACTIVE.loginId,
          fingerprint: computeFingerprint(CREDENTIALS.ACTIVE.password),
        },
      ])
      expect(revoked).toEqual([])
    })

    it('mencabut bila password berubah (fingerprint beda)', async () => {
      const revoked = await checkCredentialRevocations([
        {
          userId: FIXTURE.user.ACTIVE,
          loginId: CREDENTIALS.ACTIVE.loginId,
          fingerprint: computeFingerprint('password-lama'),
        },
      ])
      expect(revoked).toEqual([{ userId: FIXTURE.user.ACTIVE, reason: 'CHANGED' }])
    })

    it('mencabut bila login_id berubah walau password sama', async () => {
      await getDb().execute(
        sql`UPDATE sysuser SET login_id = 'login-baru' WHERE user_id = ${FIXTURE.user.ACTIVE}`,
      )
      const revoked = await checkCredentialRevocations([
        {
          userId: FIXTURE.user.ACTIVE,
          loginId: CREDENTIALS.ACTIVE.loginId,
          fingerprint: computeFingerprint(CREDENTIALS.ACTIVE.password),
        },
      ])
      expect(revoked).toEqual([{ userId: FIXTURE.user.ACTIVE, reason: 'CHANGED' }])
    })

    it('mencabut user yang sudah dihapus (MISSING)', async () => {
      const revoked = await checkCredentialRevocations([
        { userId: '999999', loginId: 'hantu', fingerprint: 'x' },
      ])
      expect(revoked).toEqual([{ userId: '999999', reason: 'MISSING' }])
    })

    it('TIDAK mencabut user non-aktif (user_status diabaikan)', async () => {
      const revoked = await checkCredentialRevocations([
        {
          userId: FIXTURE.user.INACTIVE,
          loginId: CREDENTIALS.INACTIVE.loginId,
          fingerprint: computeFingerprint(CREDENTIALS.INACTIVE.password),
        },
      ])
      expect(revoked).toEqual([])
    })

    it('memeriksa SEMUA user ter-cache, bukan hanya satu', async () => {
      const revoked = await checkCredentialRevocations([
        {
          userId: FIXTURE.user.ACTIVE,
          loginId: CREDENTIALS.ACTIVE.loginId,
          fingerprint: computeFingerprint(CREDENTIALS.ACTIVE.password),
        },
        {
          userId: FIXTURE.user.ACTIVE_2,
          loginId: CREDENTIALS.ACTIVE_2.loginId,
          fingerprint: 'basi',
        },
      ])
      expect(revoked).toHaveLength(1)
      expect(revoked[0]?.userId).toBe(FIXTURE.user.ACTIVE_2)
    })

    it('mengembalikan array kosong untuk input kosong', async () => {
      expect(await checkCredentialRevocations([])).toEqual([])
    })
  })

  describe('otorisasi perangkat (server function)', () => {
    const valid = () => ({
      userId: FIXTURE.user.ACTIVE,
      loginId: CREDENTIALS.ACTIVE.loginId,
      fingerprint: computeFingerprint(CREDENTIALS.ACTIVE.password),
    })
    const stale = () => ({
      userId: FIXTURE.user.ACTIVE_2,
      loginId: CREDENTIALS.ACTIVE_2.loginId,
      fingerprint: 'basi',
    })

    it('lolos bila minimal satu kredensial masih valid', async () => {
      await expect(assertAuthorizedDevice([valid(), stale()])).resolves.toBeUndefined()
    })

    it('menolak bila tidak ada kredensial', async () => {
      await expect(assertAuthorizedDevice([])).rejects.toThrow(UNAUTHORIZED_MESSAGE)
    })

    it('menolak bila semua kredensial sudah dicabut', async () => {
      await expect(assertAuthorizedDevice([stale()])).rejects.toThrow(UNAUTHORIZED_MESSAGE)
    })

    it('findAuthorizedUserIds hanya mengembalikan user yang kredensialnya valid', async () => {
      expect(await findAuthorizedUserIds([valid(), stale()])).toEqual([FIXTURE.user.ACTIVE])
    })
  })

  it('fixture benar-benar terisi', async () => {
    const rows = await queryRows<{ total: number }>(sql`SELECT COUNT(*) AS total FROM sysuser`)
    expect(Number(rows[0]?.total)).toBe(3)
  })
})
