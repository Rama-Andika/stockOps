import { installVersionProblem } from '../lib/version-rules.mjs'

/** What a person is told when tracked files have changes that are not committed. */
export const DIRTY_MESSAGE =
  'ada perubahan yang belum di-commit pada file yang dilacak git; commit atau stash dulu'

/**
 * What is wrong with the version of a package; an empty list when it is fine.
 *
 * A package for a server needs a clean tree and a build made exactly at a release tag: production
 * a stable tag (v1.4.0), staging a stable tag or a release candidate tag (v1.4.0-rc.1). The tag must
 * also agree with the version in package.json, because that is the version the build stamps into
 * the app and into the service worker. With `localOnly` the person asks for a package of any commit,
 * to try out on this computer: it is made, but its version is not a tag, so the server must not
 * accept it.
 *
 * @param {{
 *   env: 'staging' | 'production',
 *   buildVersion: string,
 *   packageVersion: string,
 *   treeDirty: boolean,
 *   localOnly: boolean,
 * }} input
 *   buildVersion: what `git describe --tags --always --dirty` prints;
 *   packageVersion: the "version" in package.json, without a leading "v";
 *   treeDirty: tracked files have uncommitted changes.
 * @returns {string[]}
 */
export function versionProblems({ env, buildVersion, packageVersion, treeDirty, localOnly }) {
  /** @type {string[]} */
  const problems = []
  if (buildVersion === 'unknown')
    problems.push('versi build tidak diketahui (apakah ini folder git?)')
  if (localOnly) return problems
  if (treeDirty || buildVersion.endsWith('-dirty')) {
    problems.push(DIRTY_MESSAGE)
    return problems
  }
  if (buildVersion === 'unknown') return problems
  const problem = installVersionProblem(buildVersion, env)
  if (problem !== '') {
    problems.push(problem)
    return problems
  }
  if (buildVersion !== `v${packageVersion}`) {
    problems.push(
      `versi di package.json ("${packageVersion}") tidak sama dengan tag ${buildVersion}; jangan mengubah package.json dengan tangan, buat ulang rilis lewat "npm run release"`,
    )
  }
  return problems
}

/**
 * Text that may appear inside a file name: letters, digits, dot, underscore and dash. Anything else
 * becomes a dash, and the text may not start with a dash or a dot. An empty result becomes "x".
 *
 * @param {string} text
 * @returns {string}
 */
export function safeSegment(text) {
  const cleaned = String(text)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 80)
  return cleaned === '' ? 'x' : cleaned
}

/**
 * The file name of a package, for example
 * "stockops-oxy-stockops-unclejo-production-v1.2.0-20261111223015.tgz".
 * A build for the root (no tenant) uses "root" in place of the tenant.
 *
 * @param {{ version: string, env: string, tenantSlug: string, now: Date }} input
 * @returns {string}
 */
export function packageName({ version, env, tenantSlug, now }) {
  const stamp = now
    .toISOString()
    .replace(/\.\d+Z$/, '')
    .replace(/[-:T]/g, '')
  const tenant = tenantSlug === '' ? 'root' : safeSegment(tenantSlug)
  return `stockops-${tenant}-${safeSegment(env)}-${safeSegment(version)}-${stamp}.tgz`
}
