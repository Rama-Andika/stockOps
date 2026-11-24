import { RC_TAG_PATTERN, STABLE_TAG_PATTERN } from '../lib/version-rules.mjs'

// The decisions of the release script that need no git and no disk: which tags count, what a commit
// says, which version comes next, which lane a release takes. Every export here is a pure function,
// which is why tests/unit/release-rules.test.ts can cover all of it.

/**
 * The commit types the project allows. "chore" is there because the release commit itself is
 * "chore(release): vX.Y.Z".
 */
export const COMMIT_TYPES = [
  'feat',
  'fix',
  'perf',
  'refactor',
  'docs',
  'style',
  'test',
  'chore',
  'build',
  'ci',
  'revert',
]

const COMMIT_SUBJECT = new RegExp(`^(${COMMIT_TYPES.join('|')})(?:\\(([^)\\r\\n]+)\\))?(!)?: \\S`)
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: \S/m

/**
 * Files that may differ between the last release candidate tag and the stable release commit.
 * Anything else means the code changed after staging approved it, so a new candidate is needed.
 */
export const RC_TO_STABLE_ALLOWED = ['package.json', 'package-lock.json', 'CHANGELOG.md']

/**
 * The oldest Node that release-it 21 runs on: 22.21 or newer, or any 24 and newer.
 *
 * @param {string} version for example process.versions.node ("24.14.1")
 * @returns {boolean}
 */
export function nodeSupportsReleaseIt(version) {
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return (major === 22 && minor >= 21) || major >= 24
}

/**
 * @param {string} tag
 * @returns {{ major: number, minor: number, patch: number } | null} null when the tag is not vX.Y.Z
 */
export function parseStableTag(tag) {
  const match = STABLE_TAG_PATTERN.exec(tag)
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

/**
 * @param {{ major: number, minor: number, patch: number }} a
 * @param {{ major: number, minor: number, patch: number }} b
 * @returns {number} negative when a is older than b
 */
export function compareSemver(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

/** @param {{ major: number, minor: number, patch: number }} v */
export function formatTag(v) {
  return `v${v.major}.${v.minor}.${v.patch}`
}

/**
 * The newest stable tag. Sorted by the numbers, never by the order git lists them or by date, and
 * release candidate tags never count.
 *
 * @param {string[]} tags
 * @returns {string | null}
 */
export function latestStableTag(tags) {
  /** @type {{ tag: string, parsed: { major: number, minor: number, patch: number } } | null} */
  let best = null
  for (const tag of tags) {
    const parsed = parseStableTag(tag)
    if (parsed && (best === null || compareSemver(parsed, best.parsed) > 0)) best = { tag, parsed }
  }
  return best ? best.tag : null
}

/**
 * The number of the next release candidate of a version: one more than the highest vX.Y.Z-rc.N tag
 * of that version, or 1 when there is none.
 *
 * @param {string[]} tags
 * @param {string} stableTag for example "v1.4.0"
 * @returns {number}
 */
export function nextRcNumber(tags, stableTag) {
  let highest = 0
  for (const tag of tags) {
    const match = RC_TAG_PATTERN.exec(tag)
    if (match && `v${match[1]}.${match[2]}.${match[3]}` === stableTag) {
      highest = Math.max(highest, Number(match[4]))
    }
  }
  return highest + 1
}

/**
 * The newest release candidate tag of a version, or null when there is none.
 *
 * @param {string[]} tags
 * @param {string} stableTag for example "v1.4.0"
 * @returns {string | null}
 */
export function latestRcTag(tags, stableTag) {
  const n = nextRcNumber(tags, stableTag) - 1
  return n === 0 ? null : `${stableTag}-rc.${n}`
}

/**
 * @param {{ subject: string, body: string }} raw
 * @returns {{ subject: string, type: string, scope: string, breaking: boolean, conventional: boolean }}
 */
export function parseCommit({ subject, body }) {
  const match = COMMIT_SUBJECT.exec(subject)
  return {
    subject,
    type: match?.[1] ?? '',
    scope: match?.[2] ?? '',
    breaking: Boolean(match?.[3]) || BREAKING_FOOTER.test(body),
    conventional: match !== null,
  }
}

/**
 * The `--format` of the `git log` that feeds parseGitLog. %x1f (unit separator) splits the subject
 * from the body and %x1e (record separator) ends one commit. Control characters are used because
 * they never appear in a commit message, unlike a newline.
 */
export const GIT_LOG_FORMAT = '%s%x1f%b%x1e'

/**
 * Turns the output of `git log --format=<GIT_LOG_FORMAT>` into one entry per commit. This list
 * decides the next version, so the format above and this parser must change together.
 *
 * @param {string} out
 * @returns {Array<{ subject: string, body: string }>}
 */
export function parseGitLog(out) {
  return out
    .split('\x1e')
    .map((chunk) => chunk.replace(/^\r?\n/, ''))
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => {
      const [subject = '', body = ''] = chunk.split('\x1f')
      return { subject: subject.trim(), body }
    })
}

/**
 * The subjects of the commits that do not follow "type(scope): text". The release stops when there
 * are any.
 *
 * @param {Array<{ subject: string, conventional: boolean }>} commits
 * @returns {string[]}
 */
export function conventionProblems(commits) {
  return commits.filter((c) => !c.conventional).map((c) => c.subject)
}

/**
 * The bump the commits ask for. major: a breaking commit ("type!:" or a BREAKING CHANGE footer);
 * minor: a feat commit; patch: anything else.
 *
 * @template {{ type: string, breaking: boolean }} C
 * @param {C[]} commits
 * @returns {{ level: 'patch' | 'minor' | 'major', breaking: C[], features: C[], fixes: C[] }}
 */
export function levelOf(commits) {
  const breaking = commits.filter((c) => c.breaking)
  const features = commits.filter((c) => c.type === 'feat')
  const fixes = commits.filter((c) => c.type === 'fix' || c.type === 'perf')
  const level = breaking.length > 0 ? 'major' : features.length > 0 ? 'minor' : 'patch'
  return { level, breaking, features, fixes }
}

/**
 * The next version after a bump. While the major number is 0, a major-level change bumps the minor
 * number instead (the SemVer convention for 0.x); `flaggedMajor` says it was major-level anyway.
 *
 * @param {{ major: number, minor: number, patch: number }} from
 * @param {'patch' | 'minor' | 'major'} level
 * @returns {{ next: { major: number, minor: number, patch: number }, flaggedMajor: boolean }}
 */
export function applyLevel(from, level) {
  if (level === 'patch') return { next: { ...from, patch: from.patch + 1 }, flaggedMajor: false }
  if (level === 'minor') {
    return { next: { major: from.major, minor: from.minor + 1, patch: 0 }, flaggedMajor: false }
  }
  if (from.major === 0) {
    return { next: { major: 0, minor: from.minor + 1, patch: 0 }, flaggedMajor: true }
  }
  return { next: { major: from.major + 1, minor: 0, patch: 0 }, flaggedMajor: true }
}

/**
 * Which lane a release takes. first: nothing was released before; fast: only the patch number
 * grows; full: the minor or the major number grows.
 *
 * @param {{ major: number, minor: number, patch: number } | null} last
 * @param {{ major: number, minor: number, patch: number }} next
 * @returns {'first' | 'fast' | 'full'}
 */
export function laneOf(last, next) {
  if (last === null) return 'first'
  return last.major === next.major && last.minor === next.minor ? 'fast' : 'full'
}

/**
 * Turns what the owner typed (or passed as --bump) into a version.
 *
 * @param {string} text "patch", "minor" or an exact version such as "1.0.0" (a leading "v" is accepted)
 * @param {{ major: number, minor: number, patch: number } | null} last
 * @returns {{ ok: true, next: { major: number, minor: number, patch: number } } | { ok: false, problem: string }}
 */
export function parseOverride(text, last) {
  const answer = text.trim()
  const base = last ?? { major: 0, minor: 0, patch: 0 }
  if (answer === 'patch') return { ok: true, next: applyLevel(base, 'patch').next }
  if (answer === 'minor') return { ok: true, next: applyLevel(base, 'minor').next }
  const parsed = parseStableTag(answer.startsWith('v') ? answer : `v${answer}`)
  if (!parsed) {
    return { ok: false, problem: `"${answer}" bukan patch, minor, atau versi seperti 1.0.0` }
  }
  if (last !== null && compareSemver(parsed, last) <= 0) {
    return {
      ok: false,
      problem: `${formatTag(parsed)} tidak lebih baru daripada rilis terakhir ${formatTag(last)}`,
    }
  }
  return { ok: true, next: parsed }
}

/**
 * The files changed between the last release candidate tag and the stable release commit that a
 * stable release may not contain.
 *
 * @param {string[]} changedFiles paths as git prints them (forward slashes)
 * @returns {string[]}
 */
export function rcDiffProblems(changedFiles) {
  return changedFiles.filter((file) => !RC_TO_STABLE_ALLOWED.includes(file))
}
