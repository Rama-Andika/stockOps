import { describe, expect, it } from 'vitest'
// @ts-expect-error - ESM script without TypeScript declarations
import * as flow from '../../scripts/deploy/package-flow.mjs'

type BuildInfo = {
  version: string
  buildTime: string
  mode: string
  basePath: string
  tenantSlug: string
}

type Setup = {
  describe?: string
  packageVersion?: string
  packageJsonBroken?: boolean
  dirty?: boolean
  dirtyAfterBuild?: boolean
  buildOk?: boolean
  info?: BuildInfo | null
  checkProblems?: string[]
}

const INFO: BuildInfo = {
  version: '1.2.0',
  buildTime: '2026-11-11T22:30:15.000Z',
  mode: 'production',
  basePath: '/oxy-stockops-unclejo/',
  tenantSlug: 'oxy-stockops-unclejo',
}

/** Fake dependencies for runPackage, plus everything the flow did to them. */
function setup(options: Setup = {}) {
  const logs: string[] = []
  const buildCalls: Array<[string, string | undefined]> = []
  const checkCalls: Array<{ version: string; mode: string; basePath: string }> = []
  const madeNames: string[] = []
  let dirtyCalls = 0
  const deps = {
    now: () => new Date('2026-11-11T22:30:15.000Z'),
    log: (line: string) => {
      logs.push(line)
    },
    git: {
      describe: () => options.describe ?? 'v1.2.0',
      isDirty: () => {
        dirtyCalls += 1
        if (options.dirty) return true
        return options.dirtyAfterBuild === true && dirtyCalls > 1
      },
    },
    readPackageVersion: () => {
      if (options.packageJsonBroken) throw new SyntaxError('Unexpected token')
      return options.packageVersion ?? '1.2.0'
    },
    build: (env: string, basePath: string | undefined) => {
      buildCalls.push([env, basePath])
      return options.buildOk ?? true
    },
    readBuildInfo: () => (options.info === undefined ? INFO : options.info),
    checkBuild: (expected: { version: string; mode: string; basePath: string }) => {
      checkCalls.push(expected)
      return { problems: options.checkProblems ?? [], precacheCount: 42 }
    },
    makePackage: (name: string) => {
      madeNames.push(name)
      return { file: `/out/${name}`, sizeBytes: 5 * 1024 * 1024 }
    },
  }
  return { deps, logs, buildCalls, checkCalls, madeNames, text: () => logs.join('\n') }
}

describe('runPackage', () => {
  it('builds, checks and packs a production release', () => {
    const s = setup()
    const result = flow.runPackage({ env: 'production', deps: s.deps })
    expect(result).toEqual({
      ok: true,
      file: '/out/stockops-oxy-stockops-unclejo-production-v1.2.0-20261111223015.tgz',
      name: 'stockops-oxy-stockops-unclejo-production-v1.2.0-20261111223015.tgz',
      version: 'v1.2.0',
      basePath: '/oxy-stockops-unclejo/',
    })
    expect(s.buildCalls).toEqual([['production', undefined]])
    expect(s.checkCalls).toEqual([
      { version: '1.2.0', mode: 'production', basePath: '/oxy-stockops-unclejo/' },
    ])
    expect(s.text()).toContain('PAKET SIAP')
    expect(s.text()).toContain('npm run serve:production')
    expect(s.text()).toContain('npm ci --omit=dev')
  })

  it('passes --base-path on to the build', () => {
    const s = setup()
    flow.runPackage({
      env: 'production',
      options: { basePath: '/oxy-stockops-unclejo' },
      deps: s.deps,
    })
    expect(s.buildCalls).toEqual([['production', '/oxy-stockops-unclejo']])
  })

  it('packs a release candidate for staging', () => {
    const s = setup({
      describe: 'v1.2.0-rc.1',
      packageVersion: '1.2.0-rc.1',
      info: { ...INFO, version: '1.2.0-rc.1', mode: 'staging' },
    })
    const result = flow.runPackage({ env: 'staging', deps: s.deps })
    expect(result.ok).toBe(true)
    expect(s.text()).toContain('npm run serve:staging')
  })

  it('refuses an unknown environment before doing anything', () => {
    const s = setup()
    const result = flow.runPackage({ env: 'demo', deps: s.deps })
    expect(result.ok).toBe(false)
    expect(s.buildCalls).toEqual([])
    expect(s.text()).toContain('staging atau production')
  })

  it('refuses a release candidate for production', () => {
    const s = setup({ describe: 'v1.2.0-rc.1', packageVersion: '1.2.0-rc.1' })
    const result = flow.runPackage({ env: 'production', deps: s.deps })
    expect(result.ok).toBe(false)
    expect(s.buildCalls).toEqual([])
    expect(s.text()).toContain('production')
  })

  it('fails with a message, not a crash, when package.json cannot be read', () => {
    const s = setup({ packageJsonBroken: true })
    const result = flow.runPackage({ env: 'production', deps: s.deps })
    expect(result.ok).toBe(false)
    expect(s.buildCalls).toEqual([])
    expect(s.text()).toContain('package.json tidak bisa dibaca')
  })

  it('refuses a dirty tree before building', () => {
    const s = setup({ dirty: true })
    expect(flow.runPackage({ env: 'production', deps: s.deps }).ok).toBe(false)
    expect(s.buildCalls).toEqual([])
  })

  it('refuses a build that left tracked files changed', () => {
    const s = setup({ dirtyAfterBuild: true })
    const result = flow.runPackage({ env: 'production', deps: s.deps })
    expect(result.ok).toBe(false)
    expect(s.text()).toContain('build mengubah file yang dilacak git')
    expect(s.madeNames).toEqual([])
  })

  it('fails when the build fails', () => {
    const s = setup({ buildOk: false })
    expect(flow.runPackage({ env: 'production', deps: s.deps }).ok).toBe(false)
    expect(s.text()).toContain('build gagal')
    expect(s.madeNames).toEqual([])
  })

  it('with --skip-build it does not build and still checks dist/', () => {
    const s = setup()
    const result = flow.runPackage({
      env: 'production',
      options: { skipBuild: true },
      deps: s.deps,
    })
    expect(result.ok).toBe(true)
    expect(s.buildCalls).toEqual([])
    expect(s.text()).toContain('--skip-build')
  })

  it('refuses a dist/ that has no build-info.json', () => {
    const s = setup({ info: null })
    expect(flow.runPackage({ env: 'production', deps: s.deps }).ok).toBe(false)
    expect(s.text()).toContain('build-info.json tidak ada')
  })

  it('refuses a dist/ built for another mode', () => {
    const s = setup({ info: { ...INFO, mode: 'staging' } })
    expect(flow.runPackage({ env: 'production', deps: s.deps }).ok).toBe(false)
    expect(s.text()).toContain('mode "staging"')
  })

  it('refuses a dist/ built for another version', () => {
    const s = setup({ info: { ...INFO, version: '1.1.0' } })
    expect(flow.runPackage({ env: 'production', deps: s.deps }).ok).toBe(false)
    expect(s.text()).toContain('berversi "1.1.0"')
  })

  it('refuses a dist/ whose base path differs from the requested one', () => {
    const s = setup()
    const result = flow.runPackage({
      env: 'production',
      options: { skipBuild: true, basePath: '/lain' },
      deps: s.deps,
    })
    expect(result.ok).toBe(false)
    expect(s.text()).toContain('base path "/oxy-stockops-unclejo/"')
    expect(s.text()).toContain('"/lain/"')
  })

  it('accepts a requested base path in any spelling that normalizes to the build', () => {
    const s = setup()
    const result = flow.runPackage({
      env: 'production',
      options: { skipBuild: true, basePath: 'oxy-stockops-unclejo' },
      deps: s.deps,
    })
    expect(result.ok).toBe(true)
  })

  it('fails and lists the problems when the build check finds some', () => {
    const s = setup({ checkProblems: ['sw.js belum distamp', 'precache rusak'] })
    expect(flow.runPackage({ env: 'production', deps: s.deps }).ok).toBe(false)
    expect(s.text()).toContain('sw.js belum distamp')
    expect(s.text()).toContain('precache rusak')
    expect(s.madeNames).toEqual([])
  })

  it('with --local-only packs a dirty, untagged commit and warns that it is not for a server', () => {
    const s = setup({ describe: '1a2b3c4-dirty', dirty: true })
    const result = flow.runPackage({
      env: 'production',
      options: { localOnly: true },
      deps: s.deps,
    })
    expect(result.ok).toBe(true)
    expect(s.text()).toContain('HANYA LOKAL')
    expect(s.text()).not.toContain('Langkah berikutnya')
  })

  it('with --local-only still refuses a dist/ that does not match package.json', () => {
    const s = setup({ describe: '1a2b3c4', info: { ...INFO, version: '0.0.1' } })
    const result = flow.runPackage({
      env: 'production',
      options: { localOnly: true },
      deps: s.deps,
    })
    expect(result.ok).toBe(false)
  })
})
