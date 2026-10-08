import { describe, expect, it } from 'vitest'
import { dec2, eqDec2, gtDec2, ltDec2, sumDec2, toNumber } from '~/core/money/num'

describe('num', () => {
  it('toNumber menangani string & nilai tak valid', () => {
    expect(toNumber('12.5')).toBe(12.5)
    expect(toNumber(null)).toBe(0)
    expect(toNumber(undefined)).toBe(0)
    expect(toNumber('abc')).toBe(0)
  })

  it('dec2 membulatkan ke 2 desimal', () => {
    expect(dec2(1.005)).toBe(1.01)
    expect(dec2(2.344)).toBe(2.34)
    expect(dec2(0.1 + 0.2)).toBe(0.3)
  })

  it('sumDec2 jumlah stabil', () => {
    expect(sumDec2([0.1, 0.2])).toBe(0.3)
    expect(sumDec2([])).toBe(0)
  })

  it('perbandingan toleran galat floating point', () => {
    expect(eqDec2(0.1 + 0.2, 0.3)).toBe(true)
    expect(gtDec2(10.0000000001, 10)).toBe(false)
    expect(gtDec2(10.01, 10)).toBe(true)
    expect(ltDec2(9.99, 10)).toBe(true)
  })
})
