import { describe, expect, it } from 'vitest'
// @ts-expect-error - ESM script without TypeScript declarations
import * as info from '../../scripts/lib/build-info.mjs'

const VALID = {
  version: '0.1.0',
  buildTime: '2026-11-11T22:30:15.000Z',
  mode: 'production',
  basePath: '/oxy-stockops-unclejo/',
  tenantSlug: 'oxy-stockops-unclejo',
}

describe('build-info', () => {
  it('reads a valid file', () => {
    expect(info.parseBuildInfo(JSON.stringify(VALID))).toEqual(VALID)
  })

  it('drops fields it does not know', () => {
    expect(info.parseBuildInfo(JSON.stringify({ ...VALID, extra: 1 }))).toEqual(VALID)
  })

  it('accepts a root build: base path "/" and an empty tenant slug', () => {
    const root = { ...VALID, basePath: '/', tenantSlug: '' }
    expect(info.parseBuildInfo(JSON.stringify(root))).toEqual(root)
  })

  it('returns null for text that is not JSON', () => {
    expect(info.parseBuildInfo('')).toBeNull()
    expect(info.parseBuildInfo('{ not json')).toBeNull()
  })

  it('returns null for JSON that is not an object', () => {
    expect(info.parseBuildInfo('null')).toBeNull()
    expect(info.parseBuildInfo('42')).toBeNull()
    expect(info.parseBuildInfo('[]')).toBeNull()
  })

  it('returns null when a field is missing, empty or of the wrong type', () => {
    for (const field of ['version', 'buildTime', 'mode', 'basePath', 'tenantSlug']) {
      const without: Record<string, unknown> = { ...VALID }
      delete without[field]
      expect(info.parseBuildInfo(JSON.stringify(without))).toBeNull()
    }
    expect(info.parseBuildInfo(JSON.stringify({ ...VALID, version: '' }))).toBeNull()
    expect(info.parseBuildInfo(JSON.stringify({ ...VALID, mode: 5 }))).toBeNull()
  })

  it('returns null for a base path without the leading or trailing slash', () => {
    expect(info.parseBuildInfo(JSON.stringify({ ...VALID, basePath: 'oxy/' }))).toBeNull()
    expect(info.parseBuildInfo(JSON.stringify({ ...VALID, basePath: '/oxy' }))).toBeNull()
  })
})
