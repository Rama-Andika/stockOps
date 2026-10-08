/**
 * The app version as the operator reads it in Pengaturan.
 *
 * Both values are injected at build time by `define` in vite.config.ts. The `typeof` guards are
 * load-bearing, not defensive noise: vitest.config.ts is a SEPARATE config with no `define`, so
 * in every component test (and in any plain `node` run) these identifiers simply do not exist.
 * `typeof` on an undeclared identifier is the one read that does not throw — a bare
 * `__APP_VERSION__` would be a ReferenceError and would take the whole file importing it down
 * with it.
 *
 * Under `npm run dev` and in tests the version therefore reads 'dev'. That is correct, not a bug:
 * there is no build, so there is no build number to show.
 *
 * NOTE: public/sw.js carries its OWN APP_VERSION/BUILD_TIME, stamped by scripts/stamp-sw.mjs a
 * moment later in the same build, so the two build times can differ by a few seconds. Nothing
 * compares them — the service worker's copy only feeds CACHE_VERSION and is never displayed — so
 * do not try to "fix" the difference by wiring them together.
 */
import { formatDateTime } from '~/core/format'

declare const __APP_VERSION__: string | undefined
declare const __APP_BUILD_TIME__: string | undefined

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'

export const APP_BUILD_TIME: string =
  typeof __APP_BUILD_TIME__ === 'string' ? __APP_BUILD_TIME__ : ''

/**
 * Version plus build time, e.g. "1.0.0 · 7 Okt 2026, 14.20" — the exact shape of the date is
 * whatever `Intl` produces for id-ID, which is also what every other date on screen uses.
 *
 * Falls back to the bare version when there is no build time (dev, tests) or when it cannot be
 * parsed, so the row can never read "Invalid Date". The two parameters exist for tests only;
 * every caller in the app calls it with none.
 */
export function formatAppVersion(
  version: string = APP_VERSION,
  buildTime: string = APP_BUILD_TIME,
): string {
  if (!buildTime) return version
  const date = new Date(buildTime)
  if (Number.isNaN(date.getTime())) return version
  return `${version} · ${formatDateTime(date)}`
}
