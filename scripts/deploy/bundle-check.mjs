import { parseBuildInfo } from '../lib/build-info.mjs'

// Checks that dist/ is a build that will run on a server, by reading files only: no server is
// started, no database is touched. Used by `npm run smoke:build` and by the package builder.
//
// Every check here exists because the failure it catches is silent in the field:
//   - an unstamped sw.js would cache under the wrong name or the wrong base path;
//   - ONE missing file in the precache manifest makes the whole service worker install fail, and a
//     PDT then never gets an offline copy of the app;
//   - a build made for another version, mode or base path would be deployed without anyone noticing.

/** Files a build must contain, relative to the project root. */
export const REQUIRED_BUILD_FILES = [
  'dist/build-info.json',
  'dist/client/sw.js',
  'dist/client/_shell.html',
  'dist/client/precache-manifest.json',
  'dist/server/server.js',
]

/** The lines scripts/stamp-sw.mjs replaces. Still present in dist/client/sw.js = never stamped. */
const UNSTAMPED_MARKERS = [
  "const APP_VERSION = 'dev'",
  "const BUILD_TIME = 'dev'",
  "const BASE_PATH = '/'",
  "const TENANT_SLUG = ''",
]

/**
 * Reads the string literal that stamp-sw.mjs wrote after `const <name> = `.
 *
 * @param {string} source the text of sw.js
 * @param {string} name for example "BASE_PATH"
 * @returns {string | null} null when the line is missing or is not a double-quoted string
 */
function stampedValue(source, name) {
  const match = new RegExp(`const ${name} = ("(?:[^"\\\\]|\\\\.)*")`).exec(source)
  if (!match?.[1]) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

/**
 * What is wrong with a build; an empty list in `problems` when it is fine.
 *
 * @param {{
 *   exists: (path: string) => boolean,
 *   read: (path: string) => string,
 *   expected: { version: string, mode?: string, basePath?: string },
 * }} input
 *   exists/read take a path relative to the project root with "/" (for example "dist/client/sw.js").
 *   expected.version is required; mode and basePath are only compared when given.
 * @returns {{ problems: string[], precacheCount: number }}
 */
export function bundleProblems({ exists, read, expected }) {
  /** @type {string[]} */
  const problems = []

  const missing = REQUIRED_BUILD_FILES.filter((file) => !exists(file))
  if (missing.length > 0) {
    return {
      problems: missing.map((file) => `berkas ${file} tidak ada; jalankan "npm run build" dulu`),
      precacheCount: 0,
    }
  }

  const info = parseBuildInfo(read('dist/build-info.json'))
  if (!info) {
    return {
      problems: ['dist/build-info.json rusak atau tidak lengkap; jalankan "npm run build" lagi'],
      precacheCount: 0,
    }
  }
  if (info.version !== expected.version) {
    problems.push(
      `build-info.json berisi versi "${info.version}", sedangkan yang diharapkan "${expected.version}"`,
    )
  }
  if (expected.mode !== undefined && info.mode !== expected.mode) {
    problems.push(
      `build-info.json berisi mode "${info.mode}", sedangkan yang diharapkan "${expected.mode}"`,
    )
  }
  if (expected.basePath !== undefined && info.basePath !== expected.basePath) {
    problems.push(
      `build-info.json berisi base path "${info.basePath}", sedangkan yang diharapkan "${expected.basePath}"`,
    )
  }

  const sw = read('dist/client/sw.js')
  for (const marker of UNSTAMPED_MARKERS) {
    if (sw.includes(marker)) {
      problems.push(`dist/client/sw.js belum distamp (masih berisi: ${marker})`)
    }
  }
  const swVersion = stampedValue(sw, 'APP_VERSION')
  if (swVersion !== info.version) {
    problems.push(
      `APP_VERSION di sw.js adalah ${JSON.stringify(swVersion)}, sedangkan build-info.json berisi "${info.version}"`,
    )
  }
  const swBasePath = stampedValue(sw, 'BASE_PATH')
  if (swBasePath !== info.basePath) {
    problems.push(
      `BASE_PATH di sw.js adalah ${JSON.stringify(swBasePath)}, sedangkan build-info.json berisi "${info.basePath}"`,
    )
  }
  const swSlug = stampedValue(sw, 'TENANT_SLUG')
  if (swSlug !== info.tenantSlug) {
    problems.push(
      `TENANT_SLUG di sw.js adalah ${JSON.stringify(swSlug)}, sedangkan build-info.json berisi "${info.tenantSlug}"`,
    )
  }

  /** @type {unknown} */
  let manifest
  try {
    manifest = JSON.parse(read('dist/client/precache-manifest.json'))
  } catch {
    manifest = null
  }
  if (
    !Array.isArray(manifest) ||
    manifest.length === 0 ||
    manifest.some((url) => typeof url !== 'string')
  ) {
    problems.push('precache-manifest.json bukan daftar URL yang berisi')
    return { problems, precacheCount: 0 }
  }
  /** @type {string[]} */
  const urls = manifest
  const outside = urls.filter((url) => !url.startsWith(info.basePath))
  if (outside.length > 0) {
    problems.push(
      `${outside.length} URL di precache-manifest.json tidak diawali base path "${info.basePath}", contoh: ${outside[0]}`,
    )
  }
  const absent = urls.filter(
    (url) =>
      url.startsWith(info.basePath) && !exists(`dist/client/${url.slice(info.basePath.length)}`),
  )
  if (absent.length > 0) {
    problems.push(
      `${absent.length} berkas di precache-manifest.json tidak ada di dist/client (satu saja cukup untuk menggagalkan pemasangan service worker), contoh: ${absent[0]}`,
    )
  }

  return { problems, precacheCount: urls.length }
}
