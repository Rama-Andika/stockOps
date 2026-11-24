// Makes one release: npm run release -- [stable | rc] [--dry-run] [--yes] [--bump <patch|minor|X.Y.Z>]
//
// Run from the project folder on the OWNER's computer. It checks the git state, works out the
// version from the commits, runs the gates, and hands the commit, the tag, the package.json version,
// the CHANGELOG entry and the push to release-it.
//
// This file only connects the real world (git, npm, the keyboard, release-it) to the flow in
// release-flow.mjs, where every decision is made and tested. See docs/invariants/release-versioning.md.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { runRelease } from './release-flow.mjs'
import { GIT_LOG_FORMAT, nodeSupportsReleaseIt, parseGitLog } from './release-rules.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const RELEASE_IT_BIN = join(root, 'node_modules', 'release-it', 'bin', 'release-it.js')

const USAGE = `Pemakaian: npm run release -- [stable | rc] [--dry-run] [--yes] [--bump <patch|minor|X.Y.Z>]

  (tanpa kata)   buat rilis stabil vX.Y.Z (bawaan)
  rc             buat release candidate vX.Y.Z-rc.N (untuk dicoba di staging)
  --dry-run      hanya tampilkan versi berikutnya, jalurnya, dan yang menghalangi; tidak mengubah apa pun
  --yes          jangan bertanya (menerima versi yang disarankan)
  --bump <apa>   patch, minor, atau versi persis yang lebih baru seperti 1.0.0, menggantikan saran`

/**
 * The output of git in the project folder; throws when git fails.
 *
 * @param {string[]} args
 * @returns {string}
 */
function git(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/**
 * @param {string[]} args
 * @returns {string} an empty text when git fails
 */
function gitOrEmpty(args) {
  try {
    return git(args)
  } catch {
    return ''
  }
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function lines(text) {
  return text.split(/\r?\n/).filter((line) => line !== '')
}

const realGit = {
  branch: () => gitOrEmpty(['rev-parse', '--abbrev-ref', 'HEAD']),
  isClean: () => gitOrEmpty(['status', '--porcelain']) === '',
  fetch() {
    try {
      git(['fetch', 'origin', '--tags'])
      return true
    } catch {
      return false
    }
  },
  head: () => gitOrEmpty(['rev-parse', 'HEAD']),
  remoteHead: () => gitOrEmpty(['rev-parse', 'origin/main']),
  tags: () => lines(gitOrEmpty(['tag', '--list'])),
  /**
   * The commits after a tag (all commits when there is none), merges left out: subject and body of
   * each.
   *
   * @param {string | null} tag
   */
  commitsSince(tag) {
    const range = tag === null ? 'HEAD' : `${tag}..HEAD`
    return parseGitLog(git(['log', range, '--no-merges', `--format=${GIT_LOG_FORMAT}`]))
  },
  /** @param {string} tag */
  changedFilesSince: (tag) => lines(git(['diff', '--name-only', tag, 'HEAD'])),
}

/** @param {'typecheck' | 'lint' | 'test' | 'build'} gate */
function runGate(gate) {
  // One fixed command text, never built from input; "shell" is what lets Windows start npm.
  return spawnSync(`npm run ${gate}`, { cwd: root, stdio: 'inherit', shell: true }).status === 0
}

/** @param {string} question */
async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}

/** @param {string[]} args */
function releaseIt(args) {
  return (
    spawnSync(process.execPath, [RELEASE_IT_BIN, ...args], { cwd: root, stdio: 'inherit' })
      .status ?? 1
  )
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>} the exit code
 */
async function main(argv) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        'dry-run': { type: 'boolean' },
        yes: { type: 'boolean' },
        bump: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`)
    return 2
  }
  const { values, positionals } = parsed
  if (values.help) {
    console.log(USAGE)
    return 0
  }
  const word = positionals[0] ?? 'stable'
  if (positionals.length > 1 || (word !== 'stable' && word !== 'rc')) {
    console.error(USAGE)
    return 2
  }
  const dryRun = values['dry-run'] === true
  if (!dryRun) {
    if (!nodeSupportsReleaseIt(process.versions.node)) {
      console.error(
        `release-it butuh Node 22.21 atau lebih baru (atau Node 24 ke atas); Node ini ${process.versions.node}.`,
      )
      return 1
    }
    if (!existsSync(RELEASE_IT_BIN)) {
      console.error(
        'release-it belum terpasang di sini. Jalankan "npm ci" dulu (release-it adalah dev dependency).',
      )
      return 1
    }
  }
  const result = await runRelease({
    mode: word,
    dryRun,
    yes: values.yes === true,
    bump: values.bump,
    deps: {
      log: (line) => console.log(line),
      ask,
      git: realGit,
      runGate,
      releaseIt,
    },
  })
  return result.ok ? 0 : 1
}

process.exitCode = await main(process.argv.slice(2))
