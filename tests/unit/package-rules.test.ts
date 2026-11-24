import { describe, expect, it } from 'vitest'
// @ts-expect-error - ESM script without TypeScript declarations
import * as rules from '../../scripts/deploy/package-rules.mjs'

type Input = {
  env: 'staging' | 'production'
  buildVersion: string
  packageVersion: string
  treeDirty: boolean
  localOnly: boolean
}

const good: Input = {
  env: 'production',
  buildVersion: 'v1.4.0',
  packageVersion: '1.4.0',
  treeDirty: false,
  localOnly: false,
}

const problems = (changes: Partial<Input>): string[] =>
  rules.versionProblems({ ...good, ...changes })

describe('package-rules', () => {
  describe('versionProblems', () => {
    it('accepts a stable tag for production and staging', () => {
      expect(problems({})).toEqual([])
      expect(problems({ env: 'staging' })).toEqual([])
    })

    it('accepts a release candidate tag for staging only', () => {
      const rc = { buildVersion: 'v1.4.0-rc.1', packageVersion: '1.4.0-rc.1' }
      expect(problems({ ...rc, env: 'staging' })).toEqual([])
      expect(problems({ ...rc, env: 'production' })).toHaveLength(1)
    })

    it('refuses a dirty tree', () => {
      expect(problems({ treeDirty: true })).toEqual([rules.DIRTY_MESSAGE])
      expect(problems({ buildVersion: 'v1.4.0-dirty' })).toEqual([rules.DIRTY_MESSAGE])
    })

    it('refuses a build that is not exactly at a tag', () => {
      expect(problems({ buildVersion: 'v1.4.0-3-g1a2b3c4' })).toHaveLength(1)
      expect(problems({ buildVersion: '1a2b3c4' })).toHaveLength(1)
    })

    it('refuses an unknown version, also with localOnly', () => {
      expect(problems({ buildVersion: 'unknown' })).toHaveLength(1)
      expect(problems({ buildVersion: 'unknown', localOnly: true })).toHaveLength(1)
    })

    it('refuses a tag that disagrees with package.json', () => {
      const result = problems({ packageVersion: '1.3.0' })
      expect(result).toHaveLength(1)
      expect(result[0]).toContain('"1.3.0"')
      expect(result[0]).toContain('v1.4.0')
    })

    it('lets localOnly package any commit, dirty or not', () => {
      expect(problems({ localOnly: true, buildVersion: '1a2b3c4-dirty', treeDirty: true })).toEqual(
        [],
      )
      expect(problems({ localOnly: true, packageVersion: '9.9.9' })).toEqual([])
    })
  })

  describe('safeSegment', () => {
    it('keeps letters, digits, dot, underscore and dash', () => {
      expect(rules.safeSegment('v1.4.0-rc.1')).toBe('v1.4.0-rc.1')
    })

    it('replaces other characters with a dash and trims a bad start', () => {
      expect(rules.safeSegment('v1.4.0 beta/2')).toBe('v1.4.0-beta-2')
      expect(rules.safeSegment('..//x')).toBe('x')
    })

    it('returns x for empty or fully removed text', () => {
      expect(rules.safeSegment('')).toBe('x')
      expect(rules.safeSegment('///')).toBe('x')
    })

    it('cuts the text at 80 characters', () => {
      expect(rules.safeSegment('a'.repeat(200))).toHaveLength(80)
    })
  })

  describe('packageName', () => {
    const now = new Date('2026-11-11T22:30:15.123Z')

    it('puts tenant, environment, version and UTC time in the name', () => {
      expect(
        rules.packageName({
          version: 'v1.2.0',
          env: 'production',
          tenantSlug: 'oxy-stockops-unclejo',
          now,
        }),
      ).toBe('stockops-oxy-stockops-unclejo-production-v1.2.0-20261111223015.tgz')
    })

    it('uses "root" for a build without a tenant', () => {
      expect(rules.packageName({ version: 'v1.2.0', env: 'staging', tenantSlug: '', now })).toBe(
        'stockops-root-staging-v1.2.0-20261111223015.tgz',
      )
    })

    it('cleans a version made by git describe', () => {
      const name = rules.packageName({
        version: 'v1.2.0-3-g1a2b3c4-dirty',
        env: 'production',
        tenantSlug: 'a.b',
        now,
      })
      expect(name).toBe('stockops-a.b-production-v1.2.0-3-g1a2b3c4-dirty-20261111223015.tgz')
    })

    it('always ends in .tgz and never holds a path separator', () => {
      const name = rules.packageName({ version: '../x', env: 'staging', tenantSlug: 'a/b', now })
      expect(name.endsWith('.tgz')).toBe(true)
      expect(name).not.toMatch(/[\\/]/)
    })
  })
})
