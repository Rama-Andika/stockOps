/**
 * Normalization and tenant slug extraction helpers for Node build scripts and production server.
 */

/**
 * Normalizes a base path string so it always starts and ends with a slash '/',
 * or is exactly '/' if empty or root.
 *
 * @param {string | null | undefined} raw
 * @returns {string}
 */
export function normalizeBasePath(raw) {
  if (!raw || typeof raw !== 'string') return '/'
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, '')
  return trimmed ? `/${trimmed}/` : '/'
}

/**
 * Extracts a safe tenant/client slug from a base path.
 *
 * @param {string | null | undefined} basePath
 * @returns {string}
 */
export function getTenantSlug(basePath) {
  if (!basePath || typeof basePath !== 'string') return ''
  return basePath.trim().replace(/^\/+|\/+$/g, '')
}
