import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error - ESM script without TypeScript declarations
import * as pack from '../../scripts/deploy/package-release.mjs'

let root = ''
let workDir = ''

/** Writes a file under the fake project folder, creating folders as needed. */
function put(path: string, text = 'x') {
  const full = join(root, ...path.split('/'))
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, text)
}

/** Every file a package needs, plus files that must never be packaged. */
function fillProject() {
  for (const file of pack.PAYLOAD_REQUIRED_FILES as string[]) put(file)
  put('dist/client/assets/app-abc.js')
  put('.env', 'DB_PASSWORD=rahasia')
  put('.env.production', 'DB_PASSWORD=rahasia')
  put('.env.staging', 'DB_PASSWORD=rahasia')
  put('src/app/shell.tsx')
  put('tests/unit/ids.test.ts')
  put('scripts/lib/test-db.mjs')
  put('scripts/build.mjs')
}

/**
 * The entries of an archive, without a leading "./". The archive is named relative to its own
 * folder because GNU tar on Windows reads an absolute "C:\..." path as "host:file".
 */
function listArchive(archive: string): string[] {
  const listed = spawnSync('tar', ['-tzf', basename(archive)], {
    cwd: dirname(archive),
    encoding: 'utf8',
  })
  expect(listed.status).toBe(0)
  return listed.stdout
    .split(/\r?\n/)
    .map((line) => line.replace(/^\.\//, ''))
    .filter((line) => line !== '' && !line.endsWith('/'))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'stockops-root-'))
  workDir = mkdtempSync(join(tmpdir(), 'stockops-work-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(workDir, { recursive: true, force: true })
})

describe('package-release', () => {
  it('lists every required file in the payload', () => {
    for (const file of pack.PAYLOAD_REQUIRED_FILES as string[]) {
      const covered = (pack.PAYLOAD as string[]).some(
        (item) => file === item || file.startsWith(`${item}/`),
      )
      expect(covered, file).toBe(true)
    }
  })

  it('reports the required files that are missing', () => {
    fillProject()
    rmSync(join(root, 'dist', 'server'), { recursive: true, force: true })
    rmSync(join(root, 'package-lock.json'))
    expect(pack.missingPayloadFiles(root)).toEqual(['dist/server/server.js', 'package-lock.json'])
  })

  it('refuses to package when a required file is missing', () => {
    fillProject()
    rmSync(join(root, 'dist', 'build-info.json'))
    expect(() => pack.packageRelease({ root, workDir, name: 'x.tgz' })).toThrow(
      'dist/build-info.json',
    )
  })

  it('packs the build and the runtime files', () => {
    fillProject()
    const { archive, sizeBytes } = pack.packageRelease({ root, workDir, name: 'x.tgz' })
    expect(archive).toBe(join(workDir, 'x.tgz'))
    expect(sizeBytes).toBeGreaterThan(0)
    const entries = listArchive(archive)
    for (const file of [
      'dist/build-info.json',
      'dist/client/sw.js',
      'dist/client/assets/app-abc.js',
      'dist/server/server.js',
      'scripts/serve.mjs',
      'scripts/lib/base-path.mjs',
      'scripts/lib/load-env.mjs',
      'package.json',
      'package-lock.json',
      '.env.example',
    ]) {
      expect(entries, file).toContain(file)
    }
  })

  it('never packs an env file with secrets, source code, tests or build scripts', () => {
    fillProject()
    const { archive } = pack.packageRelease({ root, workDir, name: 'x.tgz' })
    const entries = listArchive(archive)
    for (const file of [
      '.env',
      '.env.production',
      '.env.staging',
      'src/app/shell.tsx',
      'tests/unit/ids.test.ts',
      'scripts/lib/test-db.mjs',
      'scripts/build.mjs',
    ]) {
      expect(entries, file).not.toContain(file)
    }
  })
})
