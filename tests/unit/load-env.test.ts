import { describe, expect, it } from 'vitest'
import { normalizeMode, resolveMode } from '../../scripts/lib/load-env.mjs'

describe('load-env helper', () => {
  describe('normalizeMode', () => {
    it('normalizes "prod" to "production"', () => {
      expect(normalizeMode('prod')).toBe('production')
      expect(normalizeMode('PROD')).toBe('production')
    })

    it('normalizes "dev" to "development"', () => {
      expect(normalizeMode('dev')).toBe('development')
      expect(normalizeMode('DEV')).toBe('development')
    })

    it('preserves exact mode names like "staging" and "production"', () => {
      expect(normalizeMode('staging')).toBe('staging')
      expect(normalizeMode('production')).toBe('production')
      expect(normalizeMode('custom-client')).toBe('custom-client')
    })

    it('falls back to "production" if input is empty or invalid', () => {
      expect(normalizeMode('')).toBe('production')
      expect(normalizeMode(null as unknown as string)).toBe('production')
      expect(normalizeMode(undefined as unknown as string)).toBe('production')
    })
  })

  describe('resolveMode', () => {
    it('returns defaultMode when no arguments or env vars are set', () => {
      const originalArgv = [...process.argv]
      const originalAppEnv = process.env.APP_ENV
      delete process.env.APP_ENV

      process.argv = ['node', 'build.mjs']
      expect(resolveMode('production')).toBe('production')
      expect(resolveMode('staging')).toBe('staging')

      process.argv = originalArgv
      if (originalAppEnv !== undefined) process.env.APP_ENV = originalAppEnv
    })

    it('resolves mode from positional argument', () => {
      const originalArgv = [...process.argv]
      process.argv = ['node', 'build.mjs', 'staging']

      expect(resolveMode('production')).toBe('staging')

      process.argv = originalArgv
    })

    it('resolves mode from --mode flag', () => {
      const originalArgv = [...process.argv]
      process.argv = ['node', 'build.mjs', '--mode', 'staging']
      expect(resolveMode('production')).toBe('staging')

      process.argv = ['node', 'build.mjs', '--mode=prod']
      expect(resolveMode('production')).toBe('production')

      process.argv = originalArgv
    })
  })
})
