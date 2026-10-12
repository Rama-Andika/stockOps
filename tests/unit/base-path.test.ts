import { describe, expect, it } from 'vitest'
import {
  APP_BASE_PATH,
  getDbName,
  getStorageKey,
  getTenantSlug,
  normalizeBasePath,
  resolveAppUrl,
} from '~/core/base-path'

describe('normalizeBasePath', () => {
  it('returns "/" when undefined, null, or empty string', () => {
    expect(normalizeBasePath()).toBe('/')
    expect(normalizeBasePath(null)).toBe('/')
    expect(normalizeBasePath('')).toBe('/')
    expect(normalizeBasePath('   ')).toBe('/')
  })

  it('returns "/" when input is "/" or consecutive slashes', () => {
    expect(normalizeBasePath('/')).toBe('/')
    expect(normalizeBasePath('///')).toBe('/')
  })

  it('ensures leading and trailing slashes are always present', () => {
    expect(normalizeBasePath('stockops-unclejo')).toBe('/stockops-unclejo/')
    expect(normalizeBasePath('/stockops-unclejo')).toBe('/stockops-unclejo/')
    expect(normalizeBasePath('stockops-unclejo/')).toBe('/stockops-unclejo/')
    expect(normalizeBasePath('/stockops-unclejo/')).toBe('/stockops-unclejo/')
  })

  it('handles multi-segment or spaced subpaths', () => {
    expect(normalizeBasePath('/stockops-unclejo-staging/')).toBe('/stockops-unclejo-staging/')
    expect(normalizeBasePath('  /stockops-coco/  ')).toBe('/stockops-coco/')
  })
})

describe('getTenantSlug', () => {
  it('returns empty string for root "/"', () => {
    expect(getTenantSlug('/')).toBe('')
    expect(getTenantSlug('')).toBe('')
    expect(getTenantSlug(null)).toBe('')
    expect(getTenantSlug(undefined)).toBe('')
  })

  it('extracts tenant slug without slashes', () => {
    expect(getTenantSlug('/stockops-unclejo/')).toBe('stockops-unclejo')
    expect(getTenantSlug('/stockops-unclejo')).toBe('stockops-unclejo')
    expect(getTenantSlug('stockops-unclejo/')).toBe('stockops-unclejo')
    expect(getTenantSlug('stockops-coco-staging')).toBe('stockops-coco-staging')
  })
})

describe('getDbName', () => {
  it('uses "stockops" when base path is root', () => {
    expect(getDbName('/')).toBe('stockops')
    expect(getDbName('')).toBe('stockops')
  })

  it('uses prefix stockops_ with slug for client subpaths', () => {
    expect(getDbName('/stockops-unclejo/')).toBe('stockops_stockops-unclejo')
    expect(getDbName('/stockops-unclejo-staging/')).toBe('stockops_stockops-unclejo-staging')
    expect(getDbName('/stockops-coco/')).toBe('stockops_stockops-coco')
    expect(getDbName('/coco/')).toBe('stockops_coco')
  })
})

describe('getStorageKey', () => {
  it('leaves key unchanged when at root', () => {
    expect(getStorageKey('stockops.currentUser', '/')).toBe('stockops.currentUser')
    expect(getStorageKey('stockops.preferences', '/')).toBe('stockops.preferences')
  })

  it('namespaces key with slug for client subpaths', () => {
    expect(getStorageKey('stockops.currentUser', '/stockops-unclejo/')).toBe(
      'stockops.currentUser:stockops-unclejo',
    )
    expect(getStorageKey('stockops.preferences', '/stockops-unclejo/')).toBe(
      'stockops.preferences:stockops-unclejo',
    )
    expect(getStorageKey('stockops.currentUser', '/stockops-coco-staging/')).toBe(
      'stockops.currentUser:stockops-coco-staging',
    )
  })
})

describe('resolveAppUrl', () => {
  it('resolves URL against root', () => {
    expect(resolveAppUrl('/manifest.webmanifest', '/')).toBe('/manifest.webmanifest')
    expect(resolveAppUrl('manifest.webmanifest', '/')).toBe('/manifest.webmanifest')
    expect(resolveAppUrl('/icon.svg', '/')).toBe('/icon.svg')
    expect(resolveAppUrl('/sw.js', '/')).toBe('/sw.js')
  })

  it('resolves URL against tenant subpath', () => {
    expect(resolveAppUrl('/manifest.webmanifest', '/stockops-unclejo/')).toBe(
      '/stockops-unclejo/manifest.webmanifest',
    )
    expect(resolveAppUrl('icon.svg', '/stockops-unclejo/')).toBe('/stockops-unclejo/icon.svg')
    expect(resolveAppUrl('/sw.js', '/stockops-coco-staging/')).toBe('/stockops-coco-staging/sw.js')
  })
})

describe('APP_BASE_PATH', () => {
  it('defaults to "/" in test environment', () => {
    expect(APP_BASE_PATH).toBe('/')
  })
})
