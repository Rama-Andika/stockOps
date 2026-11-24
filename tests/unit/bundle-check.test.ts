import { describe, expect, it } from 'vitest'
// @ts-expect-error - ESM script without TypeScript declarations
import * as check from '../../scripts/deploy/bundle-check.mjs'

const BASE = '/oxy-stockops-unclejo/'

const STAMPED_SW = [
  'const CACHE_PREFIX = "x"',
  'const APP_VERSION = "0.1.0"',
  'const BUILD_TIME = "2026-11-11T22:30:15.000Z"',
  `const BASE_PATH = "${BASE}"`,
  'const TENANT_SLUG = "oxy-stockops-unclejo"',
].join('\n')

const INFO = {
  version: '0.1.0',
  buildTime: '2026-11-11T22:30:15.000Z',
  mode: 'production',
  basePath: BASE,
  tenantSlug: 'oxy-stockops-unclejo',
}

/** A fake project folder: path (with "/") to file text. */
function goodFiles(): Record<string, string> {
  return {
    'dist/build-info.json': JSON.stringify(INFO),
    'dist/client/sw.js': STAMPED_SW,
    'dist/client/_shell.html': '<html></html>',
    'dist/client/precache-manifest.json': JSON.stringify([
      `${BASE}assets/app-abc.js`,
      `${BASE}manifest.webmanifest`,
    ]),
    'dist/client/assets/app-abc.js': '//',
    'dist/client/manifest.webmanifest': '{}',
    'dist/server/server.js': '//',
  }
}

function run(
  files: Record<string, string>,
  expected = { version: '0.1.0' } as Record<string, string>,
) {
  return check.bundleProblems({
    exists: (path: string) => path in files,
    read: (path: string) => {
      const text = files[path]
      if (text === undefined) throw new Error(`no such file: ${path}`)
      return text
    },
    expected,
  })
}

describe('bundleProblems', () => {
  it('accepts a good build and counts the precache entries', () => {
    expect(run(goodFiles())).toEqual({ problems: [], precacheCount: 2 })
  })

  it('compares mode and base path only when they are given', () => {
    expect(
      run(goodFiles(), { version: '0.1.0', mode: 'production', basePath: BASE }).problems,
    ).toEqual([])
    const wrongMode = run(goodFiles(), { version: '0.1.0', mode: 'staging' })
    expect(wrongMode.problems.join('\n')).toContain('mode "production"')
    const wrongBase = run(goodFiles(), { version: '0.1.0', basePath: '/lain/' })
    expect(wrongBase.problems.join('\n')).toContain('base path "/oxy-stockops-unclejo/"')
  })

  it('names every required file that is missing and stops there', () => {
    const files = goodFiles()
    delete files['dist/server/server.js']
    delete files['dist/client/_shell.html']
    const result = run(files)
    expect(result.problems).toHaveLength(2)
    expect(result.problems.join('\n')).toContain('dist/server/server.js')
    expect(result.problems.join('\n')).toContain('dist/client/_shell.html')
  })

  it('reports a damaged build-info.json', () => {
    const files = goodFiles()
    files['dist/build-info.json'] = '{ rusak'
    expect(run(files).problems.join('\n')).toContain('build-info.json rusak')
  })

  it('reports a version that differs from the expected one', () => {
    expect(run(goodFiles(), { version: '0.2.0' }).problems.join('\n')).toContain(
      'versi "0.1.0", sedangkan yang diharapkan "0.2.0"',
    )
  })

  it('reports an sw.js that was never stamped', () => {
    const files = goodFiles()
    files['dist/client/sw.js'] = [
      "const APP_VERSION = 'dev'",
      "const BUILD_TIME = 'dev'",
      "const BASE_PATH = '/'",
      "const TENANT_SLUG = ''",
    ].join('\n')
    const text = run(files).problems.join('\n')
    expect(text).toContain("belum distamp (masih berisi: const APP_VERSION = 'dev')")
    expect(text).toContain("const BASE_PATH = '/'")
  })

  it('reports an sw.js stamped for another version or base path', () => {
    const files = goodFiles()
    files['dist/client/sw.js'] = STAMPED_SW.replace('"0.1.0"', '"0.0.9"').replace(BASE, '/lain/')
    const text = run(files).problems.join('\n')
    expect(text).toContain('APP_VERSION di sw.js adalah "0.0.9"')
    expect(text).toContain('BASE_PATH di sw.js adalah "/lain/"')
  })

  it('reports a precache URL outside the base path', () => {
    const files = goodFiles()
    files['dist/client/precache-manifest.json'] = JSON.stringify([
      `${BASE}assets/app-abc.js`,
      '/assets/x.js',
    ])
    expect(run(files).problems.join('\n')).toContain(
      '1 URL di precache-manifest.json tidak diawali base path',
    )
  })

  it('reports a precache entry whose file is missing from dist/client', () => {
    const files = goodFiles()
    delete files['dist/client/assets/app-abc.js']
    const text = run(files).problems.join('\n')
    expect(text).toContain('1 berkas di precache-manifest.json tidak ada di dist/client')
    expect(text).toContain(`${BASE}assets/app-abc.js`)
  })

  it('reports a manifest that is empty, not a list, or not JSON', () => {
    for (const bad of ['[]', '{"a":1}', '[1,2]', 'bukan json']) {
      const files = goodFiles()
      files['dist/client/precache-manifest.json'] = bad
      expect(run(files).problems.join('\n')).toContain('bukan daftar URL yang berisi')
    }
  })

  it('handles a root build: base path "/" and no tenant', () => {
    const files = goodFiles()
    files['dist/build-info.json'] = JSON.stringify({ ...INFO, basePath: '/', tenantSlug: '' })
    files['dist/client/sw.js'] = STAMPED_SW.replace(BASE, '/').replace(
      '"oxy-stockops-unclejo"',
      '""',
    )
    files['dist/client/precache-manifest.json'] = JSON.stringify([
      '/assets/app-abc.js',
      '/manifest.webmanifest',
    ])
    expect(run(files).problems).toEqual([])
  })
})
