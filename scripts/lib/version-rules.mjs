// What a version text may look like, and which environment may install which version.
//
// A release tag is "v" plus three numbers (v1.4.0). A release candidate adds "-rc." and a number
// that starts at 1 (v1.4.0-rc.1). Everything else that `git describe --tags --always --dirty` can
// print (a bare commit id, "v1.2.0-3-g1a2b3c4", a text ending in "-dirty") is NOT a release.
//
// No dependencies: both the release script and the package builder load this file.

export const STABLE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
export const RC_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-rc\.([1-9]\d*)$/

/** @param {string} version */
export function isStableTag(version) {
  return STABLE_TAG_PATTERN.test(version)
}

/** @param {string} version */
export function isRcTag(version) {
  return RC_TAG_PATTERN.test(version)
}

/**
 * Why a version may not be installed in an environment; an empty text when it may.
 * production needs a stable tag; staging needs a stable tag or a release candidate tag.
 *
 * @param {string} version the version of the build, as `git describe --tags --always --dirty` prints it
 * @param {'staging' | 'production'} env
 * @returns {string}
 */
export function installVersionProblem(version, env) {
  if (env === 'production') {
    return isStableTag(version)
      ? ''
      : `versi "${version}" tidak boleh masuk production: production hanya menerima tag stabil yang persis, misalnya v1.4.0 (bukan release candidate, bukan commit id, bukan build dengan commit tambahan atau perubahan lokal)`
  }
  return isStableTag(version) || isRcTag(version)
    ? ''
    : `versi "${version}" tidak boleh masuk staging: staging hanya menerima tag persis seperti v1.4.0 atau v1.4.0-rc.1 (bukan commit id, bukan build dengan commit tambahan atau perubahan lokal)`
}
