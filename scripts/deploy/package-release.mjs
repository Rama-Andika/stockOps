import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { REQUIRED_BUILD_FILES } from './bundle-check.mjs'

/**
 * What goes into a package, relative to the project root. The server only needs the built app, the
 * server script and the two helpers it imports, and package.json + package-lock.json so that
 * `npm ci --omit=dev` can install the production dependencies. No .env file ever goes in: the
 * secrets live on the server.
 */
export const PAYLOAD = [
  'dist',
  'scripts/serve.mjs',
  'scripts/lib/base-path.mjs',
  'scripts/lib/load-env.mjs',
  'package.json',
  'package-lock.json',
  '.env.example',
]

/** Files that must exist before packaging, or the package would not start on the server. */
export const PAYLOAD_REQUIRED_FILES = [
  ...REQUIRED_BUILD_FILES,
  'scripts/serve.mjs',
  'scripts/lib/base-path.mjs',
  'scripts/lib/load-env.mjs',
  'package.json',
  'package-lock.json',
  '.env.example',
]

/**
 * The required files that do not exist in the project folder.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function missingPayloadFiles(root) {
  return PAYLOAD_REQUIRED_FILES.filter((file) => !existsSync(join(root, ...file.split('/'))))
}

/**
 * Copies the payload to workDir/stage and makes workDir/<name> (a .tgz) from it.
 *
 * @param {{ root: string, workDir: string, name: string }} input
 *   root: the project folder, after the build; workDir: an empty folder for the stage and the
 *   archive; name: the file name of the archive, ending in .tgz
 * @returns {{ archive: string, sizeBytes: number }}
 */
export function packageRelease({ root, workDir, name }) {
  const missing = missingPayloadFiles(root)
  if (missing.length > 0) {
    throw new Error(`tidak bisa membuat paket, berkas ini tidak ada: ${missing.join(', ')}`)
  }
  const stage = join(workDir, 'stage')
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })
  for (const item of PAYLOAD) {
    const target = join(stage, ...item.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join(root, ...item.split('/')), target, { recursive: true })
  }
  // Relative names with cwd on purpose: GNU tar on Windows (the one that ships with Git) reads an
  // absolute path such as "C:\..." as "host:file" and fails, while relative names work with both
  // GNU tar and the bsdtar that ships with Windows.
  const made = spawnSync('tar', ['-czf', name, '-C', 'stage', '.'], {
    cwd: workDir,
    encoding: 'utf8',
  })
  if (made.status !== 0) {
    throw new Error(`tar gagal membuat arsip: ${(made.stderr || made.error?.message || '').trim()}`)
  }
  const archive = join(workDir, name)
  return { archive, sizeBytes: statSync(archive).size }
}
