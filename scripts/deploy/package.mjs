// Builds the app for one environment, checks the build, and makes the package (.tgz) to upload to a
// server by hand. It never connects to a server. Run from the project folder on the build computer:
//
//   npm run release:pack -- <staging|production> [--base-path <path>] [--skip-build] [--local-only] [--out <folder>]
//
// This file only connects the real world (git, the build, the files) to the flow in
// package-flow.mjs, where every decision is made and tested. See docs/invariants/release-versioning.md.

import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { parseBuildInfo } from '../lib/build-info.mjs'
import { bundleProblems } from './bundle-check.mjs'
import { runPackage } from './package-flow.mjs'
import { packageRelease } from './package-release.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const DEFAULT_OUT = 'release-packages'

const USAGE = `Pemakaian: npm run release:pack -- <staging|production> [--base-path <path>] [--skip-build] [--local-only] [--out <folder>]

  <staging|production>  lingkungan tujuan; menentukan file env yang dibaca build (.env.<mode>)
  --base-path <path>    paksa base path tenant, misalnya oxy-stockops-unclejo (menggantikan STOCKOPS_BASE_PATH di file env; garis miring awal dan akhir ditambahkan otomatis, jadi tulis tanpa garis miring karena Git Bash mengubah argumen yang diawali "/")
  --skip-build          pakai dist/ yang ada; harus cocok dengan commit, mode, dan base path ini
  --local-only          paketkan commit apa pun (kotor atau tanpa tag) untuk dicoba di komputer ini; jangan dipasang ke server
  --out <folder>        tempat paket (bawaan ${DEFAULT_OUT}/, diabaikan git)`

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
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

const realGit = {
  describe() {
    try {
      return git(['describe', '--tags', '--always', '--dirty']) || 'unknown'
    } catch {
      return 'unknown'
    }
  },
  isDirty() {
    try {
      return git(['status', '--porcelain', '--untracked-files=no']) !== ''
    } catch {
      return true
    }
  },
}

/**
 * Runs the whole build pipeline (scripts/build.mjs) for one mode. A given base path goes in through
 * the environment, which takes precedence over the .env files.
 *
 * @param {string} env
 * @param {string | undefined} basePath
 */
function build(env, basePath) {
  const childEnv = { ...process.env }
  if (basePath !== undefined) childEnv.STOCKOPS_BASE_PATH = basePath
  return (
    spawnSync(process.execPath, [join(root, 'scripts', 'build.mjs'), env], {
      cwd: root,
      stdio: 'inherit',
      env: childEnv,
    }).status === 0
  )
}

function readBuildInfo() {
  try {
    return parseBuildInfo(readFileSync(join(root, 'dist', 'build-info.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * @param {string[]} argv
 * @returns {number} the exit code
 */
function main(argv) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        'base-path': { type: 'string' },
        'skip-build': { type: 'boolean' },
        'local-only': { type: 'boolean' },
        out: { type: 'string' },
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
  const [env = ''] = positionals
  if (positionals.length !== 1 || (env !== 'staging' && env !== 'production')) {
    console.error(USAGE)
    return 2
  }

  const outDir = resolve(root, values.out ?? DEFAULT_OUT)
  const deps = {
    now: () => new Date(),
    log: (/** @type {string} */ line) => console.log(line),
    git: realGit,
    readPackageVersion: () => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    build,
    readBuildInfo,
    checkBuild: (/** @type {{ version: string, mode: string, basePath: string }} */ expected) =>
      bundleProblems({
        exists: (path) => existsSync(join(root, ...path.split('/'))),
        read: (path) => readFileSync(join(root, ...path.split('/')), 'utf8'),
        expected,
      }),
    makePackage: (/** @type {string} */ name) => {
      const workDir = mkdtempSync(join(tmpdir(), 'stockops-package-'))
      try {
        const { archive, sizeBytes } = packageRelease({ root, workDir, name })
        mkdirSync(outDir, { recursive: true })
        const file = join(outDir, name)
        copyFileSync(archive, file)
        return { file, sizeBytes }
      } finally {
        rmSync(workDir, { recursive: true, force: true })
      }
    },
  }
  return runPackage({
    env,
    options: {
      skipBuild: values['skip-build'],
      localOnly: values['local-only'],
      basePath: values['base-path'],
    },
    deps,
  }).ok
    ? 0
    : 1
}

process.exitCode = main(process.argv.slice(2))
