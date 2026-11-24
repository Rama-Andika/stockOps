import { describe, expect, it } from 'vitest'
// @ts-expect-error - ESM script without TypeScript declarations
import * as flow from '../../scripts/release/release-flow.mjs'

type RawCommit = { subject: string; body: string }

const commit = (subject: string, body = ''): RawCommit => ({ subject, body })

type Setup = {
  branch?: string
  dirty?: boolean
  dirtyAfterBuild?: boolean
  fetchOk?: boolean
  remoteHead?: string
  tags?: string[]
  commits?: RawCommit[]
  changed?: string[]
  failGate?: string
  releaseItCode?: number
  answers?: string[]
}

/** Fake dependencies for runRelease, plus everything the flow did to them. */
function setup(options: Setup = {}) {
  const logs: string[] = []
  const gates: string[] = []
  const releaseItCalls: string[][] = []
  const answers = [...(options.answers ?? [])]
  let cleanCalls = 0
  const deps = {
    log: (line: string) => {
      logs.push(line)
    },
    ask: async (_question: string) => answers.shift() ?? '',
    git: {
      branch: () => options.branch ?? 'main',
      isClean: () => {
        cleanCalls += 1
        if (options.dirty) return false
        if (options.dirtyAfterBuild && cleanCalls > 1) return false
        return true
      },
      fetch: () => options.fetchOk ?? true,
      head: () => 'aaa111',
      remoteHead: () => options.remoteHead ?? 'aaa111',
      tags: () => options.tags ?? [],
      commitsSince: (_tag: string | null) => options.commits ?? [],
      changedFilesSince: (_tag: string) => options.changed ?? [],
    },
    runGate: (gate: string) => {
      gates.push(gate)
      return options.failGate !== gate
    },
    releaseIt: (args: string[]) => {
      releaseItCalls.push(args)
      return options.releaseItCode ?? 0
    },
  }
  return { deps, logs, gates, releaseItCalls, text: () => logs.join('\n') }
}

const FIRST_GATES = ['typecheck', 'lint', 'test', 'build']

describe('runRelease', () => {
  describe('the first release', () => {
    it('a dry run suggests v0.1.0, changes nothing and runs no gate', async () => {
      const s = setup({ commits: [commit('feat: sesuatu')] })
      const result = await flow.runRelease({ mode: 'stable', dryRun: true, deps: s.deps })
      expect(result).toEqual({ ok: true, status: 'dry-run', tag: 'v0.1.0', lane: 'first' })
      expect(s.gates).toEqual([])
      expect(s.releaseItCalls).toEqual([])
      expect(s.text()).toContain('rilis pertama')
      expect(s.text()).toContain('DRY RUN: tidak ada yang menghalangi')
    })

    it('does not check commit messages before the first stable release', async () => {
      const s = setup({ commits: [commit('Update stuff')] })
      const result = await flow.runRelease({ mode: 'stable', dryRun: true, deps: s.deps })
      expect(result.ok).toBe(true)
    })

    it('makes v0.1.0-rc.1 in rc mode, with the no-changelog config and all four gates', async () => {
      const s = setup()
      const result = await flow.runRelease({ mode: 'rc', yes: true, deps: s.deps })
      expect(result).toEqual({ ok: true, status: 'released', tag: 'v0.1.0-rc.1', lane: 'first' })
      expect(s.gates).toEqual(FIRST_GATES)
      expect(s.releaseItCalls).toEqual([
        ['--config', '.release-it.no-changelog.json', '0.1.0-rc.1', '--ci'],
      ])
      expect(s.text()).toContain('release:pack -- staging')
    })

    it('makes v0.1.0 in stable mode even when an rc tag exists, without a changelog entry', async () => {
      const s = setup({ tags: ['v0.1.0-rc.1'] })
      const result = await flow.runRelease({ mode: 'stable', yes: true, deps: s.deps })
      expect(result).toEqual({ ok: true, status: 'released', tag: 'v0.1.0', lane: 'first' })
      expect(s.releaseItCalls).toEqual([
        ['--config', '.release-it.no-changelog.json', '0.1.0', '--ci'],
      ])
      expect(s.text()).toContain('release:pack -- production')
    })

    it('numbers the next candidate when v0.1.0-rc.1 already exists', async () => {
      const s = setup({ tags: ['v0.1.0-rc.1'] })
      const result = await flow.runRelease({ mode: 'rc', yes: true, deps: s.deps })
      expect(result.tag).toBe('v0.1.0-rc.2')
    })
  })

  describe('a patch release (fast lane)', () => {
    it('runs three gates, no build, and writes the changelog', async () => {
      const s = setup({ tags: ['v1.0.0'], commits: [commit('fix(sync): perbaiki antrean')] })
      const result = await flow.runRelease({ mode: 'stable', yes: true, deps: s.deps })
      expect(result).toEqual({ ok: true, status: 'released', tag: 'v1.0.1', lane: 'fast' })
      expect(s.gates).toEqual(['typecheck', 'lint', 'test'])
      expect(s.releaseItCalls).toEqual([['--config', '.release-it.json', '1.0.1', '--ci']])
    })

    it('refuses a release candidate', async () => {
      const s = setup({ tags: ['v1.0.0'], commits: [commit('fix: a')] })
      const result = await flow.runRelease({ mode: 'rc', yes: true, deps: s.deps })
      expect(result.ok).toBe(false)
      expect(result.status).toBe('stopped')
      expect(s.text()).toContain('tidak punya release candidate')
      expect(s.releaseItCalls).toEqual([])
    })
  })

  describe('a minor release (full lane)', () => {
    const base = { tags: ['v1.0.0'], commits: [commit('feat(po): filter baru')] }

    it('makes a release candidate with the no-changelog config', async () => {
      const s = setup(base)
      const result = await flow.runRelease({ mode: 'rc', yes: true, deps: s.deps })
      expect(result).toEqual({ ok: true, status: 'released', tag: 'v1.1.0-rc.1', lane: 'full' })
      expect(s.gates).toEqual(FIRST_GATES)
      expect(s.releaseItCalls).toEqual([
        ['--config', '.release-it.no-changelog.json', '1.1.0-rc.1', '--ci'],
      ])
    })

    it('refuses a stable release when no release candidate exists', async () => {
      const s = setup(base)
      const result = await flow.runRelease({ mode: 'stable', yes: true, deps: s.deps })
      expect(result.status).toBe('stopped')
      expect(s.text()).toContain('belum ada release candidate untuk v1.1.0')
      expect(s.releaseItCalls).toEqual([])
    })

    it('refuses a stable release when code changed after the candidate', async () => {
      const s = setup({
        ...base,
        tags: ['v1.0.0', 'v1.1.0-rc.1'],
        changed: ['package.json', 'src/app/shell.tsx'],
      })
      const result = await flow.runRelease({ mode: 'stable', yes: true, deps: s.deps })
      expect(result.status).toBe('stopped')
      expect(s.text()).toContain('src/app/shell.tsx')
      expect(s.releaseItCalls).toEqual([])
    })

    it('makes the stable release after a good candidate, asking two questions', async () => {
      const s = setup({
        ...base,
        tags: ['v1.0.0', 'v1.1.0-rc.1'],
        changed: ['package.json', 'package-lock.json', 'CHANGELOG.md'],
        answers: ['', 'yes', 'yes'],
      })
      const result = await flow.runRelease({ mode: 'stable', deps: s.deps })
      expect(result).toEqual({ ok: true, status: 'released', tag: 'v1.1.0', lane: 'full' })
      expect(s.releaseItCalls).toEqual([['--config', '.release-it.json', '1.1.0', '--ci']])
      expect(s.text()).toContain('menambah entri ke CHANGELOG.md')
    })

    it('stops when the owner does not confirm that staging was checked', async () => {
      const s = setup({
        ...base,
        tags: ['v1.0.0', 'v1.1.0-rc.1'],
        answers: ['', 'no'],
      })
      const result = await flow.runRelease({ mode: 'stable', deps: s.deps })
      expect(result.status).toBe('stopped')
      expect(s.releaseItCalls).toEqual([])
      expect(s.text()).toContain('periksa release candidate di staging dulu')
    })
  })

  describe('a breaking change while the version is 0.x', () => {
    it('bumps the minor number and says so', async () => {
      const s = setup({ tags: ['v0.3.0'], commits: [commit('feat!: ganti format')] })
      const result = await flow.runRelease({ mode: 'stable', dryRun: true, deps: s.deps })
      expect(result.tag).toBe('v0.4.0')
      expect(s.text()).toContain('perubahan level major')
    })
  })

  describe('problems', () => {
    it('stops on the wrong branch', async () => {
      const s = setup({ branch: 'feature/x' })
      const result = await flow.runRelease({ mode: 'stable', yes: true, deps: s.deps })
      expect(result).toEqual({ ok: false, status: 'stopped', tag: '', lane: '' })
      expect(s.text()).toContain('feature/x')
      expect(s.releaseItCalls).toEqual([])
    })

    it('lists every problem in a dry run instead of stopping at the first', async () => {
      const s = setup({ branch: 'feature/x', dirty: true, remoteHead: 'bbb222' })
      const result = await flow.runRelease({ mode: 'stable', dryRun: true, deps: s.deps })
      expect(result.ok).toBe(false)
      expect(result.status).toBe('dry-run')
      expect(result.tag).toBe('v0.1.0')
      const text = s.text()
      expect(text).toContain('feature/x')
      expect(text).toContain('working tree punya perubahan')
      expect(text).toContain('tidak sejajar dengan origin/main')
      expect(text).toContain('3 masalah')
    })

    it('stops when git fetch fails', async () => {
      const s = setup({ fetchOk: false })
      const result = await flow.runRelease({ mode: 'stable', yes: true, deps: s.deps })
      expect(result.status).toBe('stopped')
      expect(s.text()).toContain('git fetch origin')
    })

    it('stops on a commit that does not follow the convention, and names it', async () => {
      const s = setup({
        tags: ['v1.0.0'],
        commits: [commit('fix: a'), commit('oops salah format')],
      })
      const result = await flow.runRelease({ mode: 'stable', yes: true, deps: s.deps })
      expect(result.status).toBe('stopped')
      expect(s.text()).toContain('oops salah format')
      expect(s.releaseItCalls).toEqual([])
    })

    it('refuses an exact version that is not newer than the last release', async () => {
      const s = setup({ tags: ['v1.0.0'], commits: [commit('fix: a')] })
      const result = await flow.runRelease({
        mode: 'stable',
        yes: true,
        bump: '1.0.0',
        deps: s.deps,
      })
      expect(result.status).toBe('stopped')
      expect(s.text()).toContain('tidak lebih baru')
    })

    it('accepts --bump minor and warns when it is lower than the commits ask for', async () => {
      const s = setup({ tags: ['v1.0.0'], commits: [commit('feat!: besar')] })
      const result = await flow.runRelease({
        mode: 'stable',
        dryRun: true,
        bump: 'minor',
        deps: s.deps,
      })
      expect(result.tag).toBe('v1.1.0')
      expect(s.text()).toContain('PERINGATAN')
    })

    it('stops when a gate fails and runs no later gate', async () => {
      const s = setup({ failGate: 'lint' })
      const result = await flow.runRelease({ mode: 'stable', yes: true, deps: s.deps })
      expect(result.status).toBe('stopped')
      expect(s.gates).toEqual(['typecheck', 'lint'])
      expect(s.releaseItCalls).toEqual([])
      expect(s.text()).toContain('gerbang "lint" gagal')
    })

    it('stops when the build leaves tracked files changed', async () => {
      const s = setup({ dirtyAfterBuild: true })
      const result = await flow.runRelease({ mode: 'stable', yes: true, deps: s.deps })
      expect(result.status).toBe('stopped')
      expect(s.gates).toEqual(FIRST_GATES)
      expect(s.text()).toContain('build mengubah file yang dilacak git')
      expect(s.releaseItCalls).toEqual([])
    })

    it('stops when the owner answers no to the last question', async () => {
      const s = setup({ answers: ['', 'no'] })
      const result = await flow.runRelease({ mode: 'stable', deps: s.deps })
      expect(result.status).toBe('stopped')
      expect(s.releaseItCalls).toEqual([])
      expect(s.text()).toContain('tidak ada yang diubah')
    })

    it('stops and reports the exit code when release-it fails', async () => {
      const s = setup({ releaseItCode: 3 })
      const result = await flow.runRelease({ mode: 'stable', yes: true, deps: s.deps })
      expect(result.status).toBe('stopped')
      expect(result.ok).toBe(false)
      expect(s.text()).toContain('kode 3')
    })
  })
})
