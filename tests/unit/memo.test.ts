import { describe, expect, it } from 'vitest'
import {
  buildOverReceiveMemo,
  buildSessionNote,
  extractSessionId,
  hasSessionMarker,
  isOverReceiveMemo,
  parseOverReceiveMemo,
  parseSessionNote,
} from '~/shared/memo'
import { MEMO_MAX_LENGTH } from '~/shared/constants'

describe('session note (idempotensi FR-5.3)', () => {
  const note = buildSessionNote({
    sessionId: '8f14e45f-ea3d-4b7a-9c1e-0123456789ab',
    deviceId: 'device-abc',
    userId: '1200001',
  })

  it('mengandung penanda & bisa dibalik', () => {
    expect(hasSessionMarker(note)).toBe(true)
    expect(parseSessionNote(note)).toEqual({
      sessionId: '8f14e45f-ea3d-4b7a-9c1e-0123456789ab',
      deviceId: 'device-abc',
      userId: '1200001',
    })
    expect(extractSessionId(note)).toBe('8f14e45f-ea3d-4b7a-9c1e-0123456789ab')
  })

  it('mengembalikan null untuk note tanpa penanda', () => {
    expect(hasSessionMarker('')).toBe(false)
    expect(hasSessionMarker(null)).toBe(false)
    expect(parseSessionNote('catatan biasa admin')).toBeNull()
    expect(extractSessionId(null)).toBeNull()
  })
})

describe('over-receive memo (FR-6.2)', () => {
  it('membangun & membaca kembali penanda over-receive', () => {
    const memo = buildOverReceiveMemo({ orderedQty: 10, newTotal: 11, excess: 1 })
    expect(isOverReceiveMemo(memo)).toBe(true)
    expect(parseOverReceiveMemo(memo)).toEqual({ orderedQty: 10, newTotal: 11, excess: 1 })
  })

  it('mendukung qty desimal', () => {
    const memo = buildOverReceiveMemo({ orderedQty: 2.5, newTotal: 2.75, excess: 0.25 })
    expect(parseOverReceiveMemo(memo)).toEqual({ orderedQty: 2.5, newTotal: 2.75, excess: 0.25 })
  })

  it('tidak melebihi batas kolom memo varchar(120)', () => {
    const memo = buildOverReceiveMemo({
      orderedQty: 1,
      newTotal: 99999999999999,
      excess: 99999999999999,
    })
    expect(memo.length).toBeLessThanOrEqual(MEMO_MAX_LENGTH)
  })

  it('mengembalikan null untuk memo non-PDT', () => {
    expect(isOverReceiveMemo('catatan admin')).toBe(false)
    expect(parseOverReceiveMemo('catatan admin')).toBeNull()
    expect(parseOverReceiveMemo(null)).toBeNull()
  })
})
