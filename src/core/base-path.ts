/**
 * Base path and tenant isolation helpers.
 *
 * Provides subpath normalization, tenant slug extraction, isolated Dexie database
 * naming, isolated localStorage keys, and URL resolution for multi-tenant / multi-client
 * deployments under subpaths (e.g. /stockops-unclejo, /stockops-unclejo-staging, /stockops-coco).
 */

declare const __APP_BASE_PATH__: string | undefined

/**
 * Normalizes a base path string so it always starts and ends with a slash '/',
 * or is exactly '/' if empty or root.
 *
 * Examples:
 *   '' -> '/'
 *   '/' -> '/'
 *   'stockops-unclejo' -> '/stockops-unclejo/'
 *   '/stockops-unclejo' -> '/stockops-unclejo/'
 *   '/stockops-unclejo/' -> '/stockops-unclejo/'
 */
export function normalizeBasePath(raw?: string | null): string {
  if (!raw) return '/'
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, '')
  return trimmed ? `/${trimmed}/` : '/'
}

/**
 * Extracts a safe tenant/client slug from a base path.
 *
 * Examples:
 *   '/' -> ''
 *   '/stockops-unclejo/' -> 'stockops-unclejo'
 *   '/stockops-coco-staging/' -> 'stockops-coco-staging'
 */
export function getTenantSlug(basePath?: string | null): string {
  if (!basePath) return ''
  return basePath.trim().replace(/^\/+|\/+$/g, '')
}

/**
 * Active application base path.
 *
 * Evaluated at compile time via `__APP_BASE_PATH__` (injected by `define` in vite.config.ts),
 * falling back to `import.meta.env.BASE_URL` in browser environments, or '/' in dev/tests.
 */
export const APP_BASE_PATH: string =
  typeof __APP_BASE_PATH__ === 'string'
    ? normalizeBasePath(__APP_BASE_PATH__)
    : typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
      ? normalizeBasePath(import.meta.env.BASE_URL)
      : '/'

/**
 * Generates an isolated Dexie (IndexedDB) database name per tenant subpath.
 * When basePath is root '/', defaults to 'stockops'.
 *
 * Examples:
 *   '/' -> 'stockops'
 *   '/stockops-unclejo/' -> 'stockops_stockops-unclejo'
 *   '/unclejo/' -> 'stockops_unclejo'
 */
export function getDbName(basePath: string = APP_BASE_PATH): string {
  const slug = getTenantSlug(basePath)
  return slug ? `stockops_${slug}` : 'stockops'
}

/**
 * Generates an isolated localStorage key per tenant subpath.
 *
 * Examples:
 *   getStorageKey('stockops.currentUser', '/') -> 'stockops.currentUser'
 *   getStorageKey('stockops.currentUser', '/stockops-unclejo/') -> 'stockops.currentUser:stockops-unclejo'
 */
export function getStorageKey(baseKey: string, basePath: string = APP_BASE_PATH): string {
  const slug = getTenantSlug(basePath)
  return slug ? `${baseKey}:${slug}` : baseKey
}

/**
 * Resolves a root-relative path (e.g. '/manifest.webmanifest') against the app base path.
 *
 * Examples:
 *   resolveAppUrl('/manifest.webmanifest', '/') -> '/manifest.webmanifest'
 *   resolveAppUrl('/manifest.webmanifest', '/stockops-unclejo/') -> '/stockops-unclejo/manifest.webmanifest'
 *   resolveAppUrl('sw.js', '/stockops-unclejo/') -> '/stockops-unclejo/sw.js'
 */
export function resolveAppUrl(path: string, basePath: string = APP_BASE_PATH): string {
  const cleanPath = path.replace(/^\/+/, '')
  const normBase = normalizeBasePath(basePath)
  return `${normBase}${cleanPath}`
}
