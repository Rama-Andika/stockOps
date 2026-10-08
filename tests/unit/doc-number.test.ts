import { describe, expect, it } from 'vitest'
import {
  buildNumber,
  buildPrefix,
  docPeriod,
  pad2,
  parseDocNumber,
} from '~/core/identity/doc-number'

describe('doc-number', () => {
  it('pad2', () => {
    expect(pad2(0)).toBe('00')
    expect(pad2(9)).toBe('09')
    expect(pad2(12)).toBe('12')
  })

  it('docPeriod MMYY', () => {
    expect(docPeriod(new Date(2026, 3, 1))).toBe('0426')
    expect(docPeriod(new Date(2026, 9, 25))).toBe('1026')
    expect(docPeriod(new Date(2027, 0, 5))).toBe('0127')
  })

  it('buildPrefix', () => {
    expect(buildPrefix('IN', new Date(2026, 3, 1))).toBe('IN0426')
  })

  it('buildNumber memakai 4 digit', () => {
    expect(buildNumber('IN0426', 1)).toBe('IN04260001')
    expect(buildNumber('IN0426', 42)).toBe('IN04260042')
    expect(buildNumber('IN0426', 9999)).toBe('IN04269999')
  })

  it('menolak counter < 1', () => {
    expect(() => buildNumber('IN0426', 0)).toThrow()
    expect(() => buildNumber('IN0426', -1)).toThrow()
  })

  it('parseDocNumber membalik nomor admin nyata', () => {
    expect(parseDocNumber('IN10250002')).toEqual({ prefixNumber: 'IN1025', counter: 2 })
    expect(parseDocNumber('PO10250001')).toEqual({ prefixNumber: 'PO1025', counter: 1 })
    expect(parseDocNumber('tidak-valid')).toBeNull()
  })

  it('round-trip build -> parse', () => {
    const number = buildNumber(buildPrefix('IN', new Date(2026, 3, 1)), 17)
    expect(parseDocNumber(number)).toEqual({ prefixNumber: 'IN0426', counter: 17 })
  })

  it('menolak nomor dokumen yang melebihi 20 karakter', () => {
    expect(() => buildNumber('PREFIXPANJANGSEKALI', 1)).toThrow()
  })
})
