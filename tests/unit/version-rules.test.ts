import { describe, expect, it } from 'vitest'
// @ts-expect-error - ESM script without TypeScript declarations
import * as rules from '../../scripts/lib/version-rules.mjs'

describe('version-rules', () => {
  describe('isStableTag', () => {
    it('accepts vX.Y.Z', () => {
      expect(rules.isStableTag('v0.1.0')).toBe(true)
      expect(rules.isStableTag('v1.4.12')).toBe(true)
      expect(rules.isStableTag('v10.0.0')).toBe(true)
    })

    it('rejects everything else that git describe can print', () => {
      expect(rules.isStableTag('1.4.0')).toBe(false)
      expect(rules.isStableTag('v1.4')).toBe(false)
      expect(rules.isStableTag('v01.4.0')).toBe(false)
      expect(rules.isStableTag('v1.4.0-rc.1')).toBe(false)
      expect(rules.isStableTag('v1.4.0-3-g1a2b3c4')).toBe(false)
      expect(rules.isStableTag('v1.4.0-dirty')).toBe(false)
      expect(rules.isStableTag('1a2b3c4')).toBe(false)
      expect(rules.isStableTag('unknown')).toBe(false)
      expect(rules.isStableTag('')).toBe(false)
    })
  })

  describe('isRcTag', () => {
    it('accepts vX.Y.Z-rc.N with N starting at 1', () => {
      expect(rules.isRcTag('v0.1.0-rc.1')).toBe(true)
      expect(rules.isRcTag('v1.4.0-rc.12')).toBe(true)
    })

    it('rejects rc.0, a stable tag and decorated texts', () => {
      expect(rules.isRcTag('v1.4.0-rc.0')).toBe(false)
      expect(rules.isRcTag('v1.4.0')).toBe(false)
      expect(rules.isRcTag('v1.4.0-rc.1-dirty')).toBe(false)
      expect(rules.isRcTag('v1.4.0-rc.1-2-gabc1234')).toBe(false)
    })
  })

  describe('installVersionProblem', () => {
    it('lets production take only an exact stable tag', () => {
      expect(rules.installVersionProblem('v1.4.0', 'production')).toBe('')
      expect(rules.installVersionProblem('v1.4.0-rc.1', 'production')).toContain('production')
      expect(rules.installVersionProblem('1a2b3c4', 'production')).toContain('production')
      expect(rules.installVersionProblem('v1.4.0-dirty', 'production')).toContain('production')
    })

    it('lets staging take a stable tag or a release candidate tag', () => {
      expect(rules.installVersionProblem('v1.4.0', 'staging')).toBe('')
      expect(rules.installVersionProblem('v1.4.0-rc.2', 'staging')).toBe('')
      expect(rules.installVersionProblem('1a2b3c4', 'staging')).toContain('staging')
      expect(rules.installVersionProblem('v1.4.0-2-g1a2b3c4', 'staging')).toContain('staging')
    })

    it('names the offending version in the message', () => {
      expect(rules.installVersionProblem('abc1234', 'production')).toContain('"abc1234"')
    })
  })
})
