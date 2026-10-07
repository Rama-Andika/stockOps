import { describe, expect, it } from 'vitest'
import {
  IdGenerator,
  TWO_POW_56,
  composeId,
  decomposeId,
  maxIdForApp,
  minIdForApp,
} from '~/shared/ids'

describe('ids', () => {
  it('mengikuti rumus admin: (millis + 2^56*appIdx)*10 + digit', () => {
    const id = composeId(1, 1_775_000_000_000, 7)
    expect(id).toBe((1_775_000_000_000n + TWO_POW_56 * 1n) * 10n + 7n)
    expect(id.toString()).toBe('720593690379279367')
  })

  it('menghasilkan nilai yang persis sama dengan ID admin nyata (regresi)', () => {
    // Real receive_id from demo database: 720593690680598725
    const id = composeId(1, 1_775_030_131_936, 5)
    expect(id.toString()).toBe('720593690680598725')
  })

  it('decompose mengembalikan komponen asli', () => {
    const id = composeId(2, 1_800_000_000_000, 3)
    expect(decomposeId(id)).toEqual({ appIdx: 2, millis: 1_800_000_000_000, digit: 3 })
  })

  it('namespace appIdx 2 tidak mungkin bertabrakan dengan appIdx 1', () => {
    expect(minIdForApp(2)).toBeGreaterThan(maxIdForApp(1))
    expect(maxIdForApp(1)).toBeLessThan(minIdForApp(2))
  })

  it('menolak appIdx / digit yang tidak valid', () => {
    expect(() => composeId(-1, 1, 1)).toThrow()
    expect(() => composeId(1.5, 1, 1)).toThrow()
    expect(() => composeId(1, 1, 10)).toThrow()
    expect(() => composeId(1, 1, -1)).toThrow()
  })

  it('nilai tetap presisi walau > 2^53', () => {
    const id = composeId(2, 1_775_000_000_000, 9)
    expect(id > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true)
    expect(id.toString()).toBe('1441169630758558729')
  })

  describe('IdGenerator', () => {
    it('menghasilkan ID yang selalu naik & unik walau jam tetap', () => {
      let now = 1_000
      const gen = new IdGenerator(2, () => now, () => 0.5)
      const a = gen.next()
      const b = gen.next()
      const c = gen.next()
      now += 5
      const d = gen.next()
      const all = [a, b, c, d]
      expect(new Set(all.map(String)).size).toBe(4)
      for (let i = 1; i < all.length; i += 1) {
        expect(all[i]! > all[i - 1]!).toBe(true)
      }
    })

    it('memakai appIdx yang diberikan', () => {
      const gen = new IdGenerator(2, () => 1_000, () => 0)
      expect(decomposeId(gen.next()).appIdx).toBe(2)
    })

    it('digit acak tetap 0..9', () => {
      const gen = new IdGenerator(2, () => 1_000, () => 0.999999)
      expect(decomposeId(gen.next()).digit).toBe(9)
    })
  })
})
