import {
  applyLevel,
  compareSemver,
  conventionProblems,
  formatTag,
  laneOf,
  latestRcTag,
  latestStableTag,
  levelOf,
  nextRcNumber,
  parseCommit,
  parseOverride,
  parseStableTag,
  rcDiffProblems,
} from './release-rules.mjs'

// One release from start to finish, with every outside thing (git, the keyboard, npm, release-it)
// passed in through `deps`. scripts/release/release.mjs connects the real world to this flow;
// tests/unit/release-flow.test.ts connects fakes, which is how every decision here is tested.
//
// Modes: "stable" makes the tag vX.Y.Z, "rc" makes the tag vX.Y.Z-rc.N.
//
// Lanes (see laneOf in release-rules.mjs):
//   first - nothing was released before. Gates with build, no release candidate required.
//   fast  - only the patch number grows. Gates without build, no release candidate.
//   full  - the minor or major number grows. Gates with build, and a stable release needs a
//           release candidate that was tried on staging.

/**
 * @typedef {'stable' | 'rc'} Mode
 * @typedef {{ subject: string, body: string }} RawCommit
 * @typedef {'first' | 'fast' | 'full'} Lane
 * @typedef {{ ok: boolean, status: 'released' | 'dry-run' | 'stopped', tag: string, lane: Lane | '' }} ReleaseResult
 * @typedef {{
 *   log: (line: string) => void,
 *   ask: (question: string) => Promise<string>,
 *   git: {
 *     branch: () => string,
 *     isClean: () => boolean,
 *     fetch: () => boolean,
 *     head: () => string,
 *     remoteHead: () => string,
 *     tags: () => string[],
 *     commitsSince: (tag: string | null) => RawCommit[],
 *     changedFilesSince: (tag: string) => string[],
 *   },
 *   runGate: (gate: 'typecheck' | 'lint' | 'test' | 'build') => boolean,
 *   releaseIt: (args: string[]) => number,
 * }} ReleaseDeps
 */

/** A stop with a message for the person. */
class Stop extends Error {}

const BRANCH = 'main'

/**
 * What every stage of a release shares: the dependencies and the way a problem is recorded. A real
 * run stops at the first problem; a dry run goes on and lists them all.
 *
 * @param {ReleaseDeps} deps
 * @param {boolean} dryRun
 */
function createContext(deps, dryRun) {
  /** @type {string[]} */
  const problems = []
  let step = 0
  return {
    deps,
    dryRun,
    problems,
    /** @param {string} text */
    heading: (text) => deps.log(`\n[${++step}] ${text}`),
    /** @param {string} text */
    problem: (text) => {
      if (!dryRun) throw new Stop(text)
      problems.push(text)
      deps.log(`  MASALAH: ${text}`)
    },
  }
}

/**
 * Stage: the branch, the working tree and the remote must be in the state a release needs.
 *
 * @param {ReturnType<typeof createContext>} ctx
 */
function checkGit(ctx) {
  const { deps, heading, problem, problems } = ctx
  const { git, log } = deps
  heading(`Periksa git (branch ${BRANCH}, working tree bersih, sejajar dengan origin)`)
  if (git.branch() !== BRANCH) {
    problem(`Anda berada di branch "${git.branch()}"; rilis dibuat dari ${BRANCH}`)
  }
  if (!git.isClean()) {
    problem('working tree punya perubahan; commit atau stash dulu (file untracked juga dihitung)')
  }
  if (!git.fetch()) {
    problem('"git fetch origin" gagal; apakah ada koneksi ke remote?')
  } else if (git.head() !== git.remoteHead()) {
    problem(
      `${BRANCH} tidak sejajar dengan origin/${BRANCH}; lakukan pull atau push dulu agar komputer ini dan remote punya commit terakhir yang sama`,
    )
  }
  if (problems.length === 0) log('  ok')
}

/**
 * Stage: every commit since the last stable release must follow "type(scope): text". The first
 * release has no earlier stable tag, so its old commits are not checked. Merge commits never reach
 * this check because `commitsSince` leaves them out.
 *
 * @param {ReturnType<typeof createContext>} ctx
 * @param {string | null} lastTag
 * @param {Array<ReturnType<typeof parseCommit>>} commits
 */
function checkCommitConvention(ctx, lastTag, commits) {
  const { deps, problem } = ctx
  if (lastTag === null) {
    deps.log(
      '  rilis pertama: belum ada tag stabil sebelumnya (release candidate tidak dihitung), jadi pesan commit tidak diperiksa',
    )
    return
  }
  deps.log(`  rilis terakhir ${lastTag}, ${commits.length} commit sejak itu`)
  const bad = conventionProblems(commits)
  if (bad.length > 0) {
    problem(
      `${bad.length} commit tidak mengikuti "type(scope): teks" (type: feat, fix, perf, refactor, docs, style, test, chore, build, ci, revert):\n    - ${bad.join('\n    - ')}\n    Tulis ulang commit itu (git rebase) sebelum merilis.`,
    )
  }
}

/**
 * Stage: the version the owner wants, which is the suggestion unless the owner types (or passes)
 * something else.
 *
 * @param {ReturnType<typeof createContext>} ctx
 * @param {{
 *   last: { major: number, minor: number, patch: number } | null,
 *   suggestion: { next: { major: number, minor: number, patch: number } },
 *   bump: string | undefined,
 *   yes: boolean,
 * }} input
 * @returns {Promise<{ major: number, minor: number, patch: number }>}
 */
async function chooseVersion(ctx, { last, suggestion, bump, yes }) {
  const { deps, dryRun } = ctx
  let override = bump
  if (override === undefined && !yes && !dryRun) {
    const answer = (
      await deps.ask(
        `Tekan Enter untuk menerima ${formatTag(suggestion.next)}, atau ketik patch, minor, atau versi persis seperti 1.0.0: `,
      )
    ).trim()
    if (answer !== '') override = answer
  }
  if (override === undefined) return suggestion.next

  const chosen = parseOverride(override, last)
  if (!chosen.ok) throw new Stop(chosen.problem)
  if (compareSemver(chosen.next, suggestion.next) < 0) {
    deps.log(
      `  PERINGATAN: ${formatTag(chosen.next)} lebih rendah daripada ${formatTag(suggestion.next)} yang diminta commit.`,
    )
  }
  return chosen.next
}

/** @param {Lane} lane */
function laneNote(lane) {
  if (lane === 'fast') return ' (patch: tanpa gerbang build, tanpa release candidate)'
  if (lane === 'first')
    return ' (rilis pertama: dengan gerbang build, release candidate tidak wajib)'
  return ' (penuh: dengan gerbang build, release candidate wajib dicoba di staging dulu)'
}

/**
 * Stage: works out which version is going to be made, from the tags and the commits since the last
 * stable release.
 *
 * @param {ReturnType<typeof createContext>} ctx
 * @param {{ mode: Mode, bump: string | undefined, yes: boolean }} input
 */
async function planVersion(ctx, { mode, bump, yes }) {
  const { deps, heading } = ctx
  heading('Hitung versi berikutnya')
  const tags = deps.git.tags()
  const lastTag = latestStableTag(tags)
  const last = lastTag ? parseStableTag(lastTag) : null
  const commits = deps.git.commitsSince(lastTag).map(parseCommit)
  checkCommitConvention(ctx, lastTag, commits)

  const asked = levelOf(commits)
  const suggestion =
    last === null
      ? { next: { major: 0, minor: 1, patch: 0 }, flaggedMajor: false }
      : applyLevel(last, asked.level)
  deps.log(
    `  commit meminta: ${last === null ? 'rilis pertama' : asked.level} (${asked.breaking.length} breaking, ${asked.features.length} feat, ${asked.fixes.length} fix/perf)`,
  )
  deps.log(
    `  versi yang disarankan: ${formatTag(suggestion.next)}${suggestion.flaggedMajor ? ' (perubahan level major selagi versi masih 0.x: nomor minor yang naik)' : ''}`,
  )

  const next = await chooseVersion(ctx, { last, suggestion, bump, yes })
  const stableTag = formatTag(next)
  const lane = laneOf(last, next)
  const tag = mode === 'rc' ? `${stableTag}-rc.${nextRcNumber(tags, stableTag)}` : stableTag
  deps.log(`  versi ${tag}, jalur: ${lane}${laneNote(lane)}`)
  return { tags, stableTag, tag, lane }
}

/**
 * Stops for a version that cannot be made in this mode.
 *
 * @param {{ tags: string[], tag: string, lane: Lane }} plan
 * @param {Mode} mode
 */
function refuseImpossible(plan, mode) {
  if (plan.tags.includes(plan.tag)) {
    throw new Stop(
      `tag ${plan.tag} sudah ada. Tag tidak pernah dipindah atau dihapus; perbaiki lewat versi baru.`,
    )
  }
  if (mode === 'rc' && plan.lane === 'fast') {
    throw new Stop(
      'rilis patch tidak punya release candidate: jalankan "npm run release" tanpa "rc"',
    )
  }
}

/**
 * Stage (full lane, stable release): a release candidate of this version exists, and since then
 * only the release files have changed.
 *
 * @param {ReturnType<typeof createContext>} ctx
 * @param {{ tags: string[], stableTag: string }} plan
 */
function checkReleaseCandidate(ctx, plan) {
  const { deps, heading, problem } = ctx
  heading('Periksa release candidate')
  const rcTag = latestRcTag(plan.tags, plan.stableTag)
  if (rcTag === null) {
    problem(
      `belum ada release candidate untuk ${plan.stableTag}. Jalankan "npm run release -- rc", pasang di staging, periksa, lalu jalankan perintah ini lagi.`,
    )
    return
  }
  const extra = rcDiffProblems(deps.git.changedFilesSince(rcTag))
  if (extra.length > 0) {
    problem(
      `sejak ${rcTag} file berikut berubah, padahal rilis stabil hanya boleh berbeda pada package.json, package-lock.json, dan CHANGELOG.md. Buat release candidate baru:\n    - ${extra.join('\n    - ')}`,
    )
    return
  }
  deps.log(
    `  ok: ${rcTag} dan commit ini hanya berbeda pada package.json, package-lock.json, dan CHANGELOG.md`,
  )
}

/**
 * Stage: typecheck, lint and test, and for the first and full lanes the build too.
 *
 * @param {ReturnType<typeof createContext>} ctx
 * @param {Lane} lane
 */
function runGates(ctx, lane) {
  const { deps, dryRun, heading } = ctx
  /** @type {Array<'typecheck' | 'lint' | 'test' | 'build'>} */
  const gates =
    lane === 'fast' ? ['typecheck', 'lint', 'test'] : ['typecheck', 'lint', 'test', 'build']
  heading(`Jalankan gerbang (${gates.join(', ')})`)
  if (dryRun) {
    deps.log('  (dry run) tidak dijalankan; rilis sungguhan menjalankannya')
    return
  }
  for (const gate of gates) {
    deps.log(`  npm run ${gate} ...`)
    if (!deps.runGate(gate)) throw new Stop(`gerbang "${gate}" gagal`)
    if (gate === 'build' && !deps.git.isClean()) {
      throw new Stop(
        'build mengubah file yang dilacak git (misalnya src/routeTree.gen.ts); lihat "git status", commit hasilnya, lalu mulai lagi',
      )
    }
  }
  deps.log('  semua gerbang lulus')
}

/**
 * Stage: asks for the last confirmations and hands the commit, the tag and the push to release-it.
 *
 * @param {ReturnType<typeof createContext>} ctx
 * @param {{ tags: string[], stableTag: string, tag: string, lane: Lane }} plan
 * @param {{ mode: Mode, yes: boolean }} input
 */
async function makeRelease(ctx, plan, { mode, yes }) {
  const { deps, heading } = ctx
  const { tag, lane } = plan
  if (lane === 'full' && mode === 'stable' && !yes) {
    const answer = await deps.ask(
      `Apakah ${latestRcTag(plan.tags, plan.stableTag)} sudah dipasang di staging dan diperiksa? Ketik yes untuk lanjut: `,
    )
    if (answer.trim().toLowerCase() !== 'yes') {
      throw new Stop('dihentikan: periksa release candidate di staging dulu')
    }
  }
  heading(`Buat rilis ${tag}`)
  // A release candidate and the very first release write no CHANGELOG entry: the first entry is
  // written by hand (see CHANGELOG.md).
  const writesChangelog = !(mode === 'rc' || lane === 'first')
  deps.log(
    `  Ini mengubah package.json menjadi ${tag.slice(1)}, ${writesChangelog ? 'menambah entri ke CHANGELOG.md' : 'tidak mengubah CHANGELOG.md'}, membuat commit dan tag ${tag}, lalu mendorong keduanya ke origin.`,
  )
  if (!yes) {
    const answer = await deps.ask('Ketik yes untuk lanjut: ')
    if (answer.trim().toLowerCase() !== 'yes') {
      throw new Stop('dihentikan: tidak ada yang diubah')
    }
  }
  const config = writesChangelog ? '.release-it.json' : '.release-it.no-changelog.json'
  const code = deps.releaseIt(['--config', config, tag.slice(1), '--ci'])
  if (code !== 0) {
    throw new Stop(
      `release-it berhenti dengan kode ${code}. Lihat "git status" dan "git log -3" sebelum mencoba lagi; tag yang sudah terdorong tidak pernah dipindah.`,
    )
  }
  const stage = mode === 'rc' ? 'staging' : 'production'
  deps.log(
    `\nSELESAI ${tag}. Selanjutnya: "git switch --detach ${tag}", jalankan "npm run release:pack -- ${stage}", lalu "git switch main".`,
  )
}

/**
 * One release. With dryRun nothing is written, the slow gates are not run, and every problem is
 * listed instead of stopping at the first one.
 *
 * @param {{ mode: Mode, dryRun?: boolean, yes?: boolean, bump?: string, deps: ReleaseDeps }} input
 * @returns {Promise<ReleaseResult>}
 */
export async function runRelease({ mode, dryRun = false, yes = false, bump, deps }) {
  const ctx = createContext(deps, dryRun)
  /** @type {ReleaseResult} */
  const result = { ok: false, status: 'stopped', tag: '', lane: '' }

  try {
    checkGit(ctx)

    const plan = await planVersion(ctx, { mode, bump, yes })
    result.lane = plan.lane
    result.tag = plan.tag
    refuseImpossible(plan, mode)

    if (plan.lane === 'full' && mode === 'stable') checkReleaseCandidate(ctx, plan)
    runGates(ctx, plan.lane)

    if (dryRun) {
      deps.log(
        ctx.problems.length === 0
          ? `\nDRY RUN: tidak ada yang menghalangi. Rilis sungguhan akan membuat ${plan.tag}.`
          : `\nDRY RUN: ${ctx.problems.length} masalah di atas harus diperbaiki dulu. Tidak ada yang diubah.`,
      )
      result.ok = ctx.problems.length === 0
      result.status = 'dry-run'
      return result
    }

    await makeRelease(ctx, plan, { mode, yes })
    result.ok = true
    result.status = 'released'
  } catch (error) {
    if (!(error instanceof Stop)) throw error
    deps.log(`\nBERHENTI: ${error.message}`)
  }
  return result
}
