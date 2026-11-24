import { describe, expect, it } from 'vitest'
// @ts-expect-error - ESM script without TypeScript declarations
import * as rules from '../../scripts/release/release-rules.mjs'

/** A parsed commit with only the fields a test cares about. */
function parsed(subject: string, body = '') {
  return rules.parseCommit({ subject, body })
}

describe('release-rules', () => {
  describe('parseStableTag, formatTag and compareSemver', () => {
    it('parses vX.Y.Z and formats it back', () => {
      const v = rules.parseStableTag('v1.4.12')
      expect(v).toEqual({ major: 1, minor: 4, patch: 12 })
      expect(rules.formatTag(v)).toBe('v1.4.12')
    })

    it('returns null for anything that is not vX.Y.Z', () => {
      expect(rules.parseStableTag('v1.4.0-rc.1')).toBeNull()
      expect(rules.parseStableTag('1.4.0')).toBeNull()
      expect(rules.parseStableTag('latest')).toBeNull()
    })

    it('compares by the numbers, not as text', () => {
      const a = rules.parseStableTag('v0.9.0')
      const b = rules.parseStableTag('v0.10.0')
      expect(rules.compareSemver(a, b)).toBeLessThan(0)
      expect(rules.compareSemver(b, a)).toBeGreaterThan(0)
      expect(rules.compareSemver(a, a)).toBe(0)
    })
  })

  describe('latestStableTag', () => {
    it('picks the highest number, ignoring order, rc tags and other tags', () => {
      const tags = ['v0.9.0', 'v0.10.0', 'v0.2.0', 'v1.0.0-rc.1', 'build-5', 'v0.10.0-rc.3']
      expect(rules.latestStableTag(tags)).toBe('v0.10.0')
    })

    it('returns null when there is no stable tag', () => {
      expect(rules.latestStableTag([])).toBeNull()
      expect(rules.latestStableTag(['v0.1.0-rc.1', 'foo'])).toBeNull()
    })
  })

  describe('nextRcNumber and latestRcTag', () => {
    const tags = ['v1.1.0-rc.1', 'v1.1.0-rc.2', 'v1.2.0-rc.1', 'v1.0.0']

    it('counts only the rc tags of the same version', () => {
      expect(rules.nextRcNumber(tags, 'v1.1.0')).toBe(3)
      expect(rules.nextRcNumber(tags, 'v1.2.0')).toBe(2)
      expect(rules.nextRcNumber(tags, 'v1.3.0')).toBe(1)
    })

    it('finds the newest rc tag of a version, or null', () => {
      expect(rules.latestRcTag(tags, 'v1.1.0')).toBe('v1.1.0-rc.2')
      expect(rules.latestRcTag(tags, 'v1.3.0')).toBeNull()
    })
  })

  describe('parseCommit and conventionProblems', () => {
    it('reads type, scope and a plain subject', () => {
      expect(parsed('feat(pos): tambah filter')).toMatchObject({
        type: 'feat',
        scope: 'pos',
        breaking: false,
        conventional: true,
      })
      expect(parsed('fix: perbaiki crash')).toMatchObject({
        type: 'fix',
        scope: '',
        conventional: true,
      })
    })

    it('marks "type!:" and a BREAKING CHANGE footer as breaking', () => {
      expect(parsed('feat(api)!: ganti format').breaking).toBe(true)
      expect(parsed('fix: x', 'BREAKING CHANGE: operator harus login ulang').breaking).toBe(true)
      expect(parsed('fix: x', 'BREAKING-CHANGE: ganti env').breaking).toBe(true)
    })

    it('does not mark a normal commit as breaking', () => {
      expect(parsed('fix: x', 'isi biasa').breaking).toBe(false)
    })

    it('flags subjects that do not follow the pattern', () => {
      const commits = [
        parsed('feat: ok'),
        parsed('Update stuff'),
        parsed('feat:tanpa spasi'),
        parsed('wip: belum jadi'),
        parsed('fix(): kosong'),
      ]
      expect(rules.conventionProblems(commits)).toEqual([
        'Update stuff',
        'feat:tanpa spasi',
        'wip: belum jadi',
        'fix(): kosong',
      ])
    })

    it('accepts the release commit itself', () => {
      expect(parsed('chore(release): v0.1.0').conventional).toBe(true)
    })
  })

  describe('levelOf', () => {
    it('asks for patch when there is neither feat nor breaking', () => {
      const result = rules.levelOf([parsed('fix: a'), parsed('docs: b'), parsed('perf: c')])
      expect(result.level).toBe('patch')
      expect(result.fixes).toHaveLength(2)
    })

    it('asks for minor when there is a feat', () => {
      expect(rules.levelOf([parsed('fix: a'), parsed('feat: b')]).level).toBe('minor')
    })

    it('asks for major when there is a breaking commit, even next to a feat', () => {
      const result = rules.levelOf([parsed('feat: a'), parsed('fix!: b')])
      expect(result.level).toBe('major')
      expect(result.breaking).toHaveLength(1)
      expect(result.features).toHaveLength(1)
    })

    it('asks for patch when there are no commits', () => {
      expect(rules.levelOf([]).level).toBe('patch')
    })
  })

  describe('applyLevel', () => {
    const from = { major: 1, minor: 4, patch: 2 }

    it('bumps patch, minor and major and resets the lower numbers', () => {
      expect(rules.applyLevel(from, 'patch').next).toEqual({ major: 1, minor: 4, patch: 3 })
      expect(rules.applyLevel(from, 'minor').next).toEqual({ major: 1, minor: 5, patch: 0 })
      expect(rules.applyLevel(from, 'major')).toEqual({
        next: { major: 2, minor: 0, patch: 0 },
        flaggedMajor: true,
      })
    })

    it('turns a major bump into a minor bump while the major number is 0', () => {
      expect(rules.applyLevel({ major: 0, minor: 3, patch: 1 }, 'major')).toEqual({
        next: { major: 0, minor: 4, patch: 0 },
        flaggedMajor: true,
      })
    })

    it('does not flag patch and minor bumps', () => {
      expect(rules.applyLevel(from, 'patch').flaggedMajor).toBe(false)
      expect(rules.applyLevel(from, 'minor').flaggedMajor).toBe(false)
    })
  })

  describe('laneOf', () => {
    const last = { major: 1, minor: 4, patch: 2 }

    it('is first when nothing was released before', () => {
      expect(rules.laneOf(null, { major: 0, minor: 1, patch: 0 })).toBe('first')
    })

    it('is fast when only the patch number grows', () => {
      expect(rules.laneOf(last, { major: 1, minor: 4, patch: 3 })).toBe('fast')
    })

    it('is full when the minor or the major number grows', () => {
      expect(rules.laneOf(last, { major: 1, minor: 5, patch: 0 })).toBe('full')
      expect(rules.laneOf(last, { major: 2, minor: 0, patch: 0 })).toBe('full')
    })
  })

  describe('parseOverride', () => {
    const last = { major: 1, minor: 4, patch: 2 }

    it('understands patch and minor', () => {
      expect(rules.parseOverride('patch', last)).toEqual({
        ok: true,
        next: { major: 1, minor: 4, patch: 3 },
      })
      expect(rules.parseOverride(' minor ', last)).toEqual({
        ok: true,
        next: { major: 1, minor: 5, patch: 0 },
      })
    })

    it('understands an exact version with or without the leading v', () => {
      expect(rules.parseOverride('2.0.0', last)).toEqual({
        ok: true,
        next: { major: 2, minor: 0, patch: 0 },
      })
      expect(rules.parseOverride('v1.9.0', last)).toEqual({
        ok: true,
        next: { major: 1, minor: 9, patch: 0 },
      })
    })

    it('refuses a version that is not newer than the last release', () => {
      const same = rules.parseOverride('1.4.2', last)
      expect(same.ok).toBe(false)
      expect(same.problem).toContain('tidak lebih baru')
      expect(rules.parseOverride('0.9.0', last).ok).toBe(false)
    })

    it('refuses text that is not a version', () => {
      const result = rules.parseOverride('besar', last)
      expect(result.ok).toBe(false)
      expect(result.problem).toContain('"besar"')
    })

    it('counts from 0.0.0 when there is no release yet', () => {
      expect(rules.parseOverride('minor', null)).toEqual({
        ok: true,
        next: { major: 0, minor: 1, patch: 0 },
      })
      expect(rules.parseOverride('0.1.0', null).ok).toBe(true)
    })
  })

  describe('rcDiffProblems', () => {
    it('allows only package.json, package-lock.json and CHANGELOG.md', () => {
      expect(rules.rcDiffProblems(['package.json', 'package-lock.json', 'CHANGELOG.md'])).toEqual(
        [],
      )
    })

    it('returns every other changed file', () => {
      expect(rules.rcDiffProblems(['package.json', 'src/app/shell.tsx', 'docs/prd.md'])).toEqual([
        'src/app/shell.tsx',
        'docs/prd.md',
      ])
    })

    it('returns nothing when no file changed', () => {
      expect(rules.rcDiffProblems([])).toEqual([])
    })
  })

  describe('parseGitLog', () => {
    // git ends every entry of a --format with a newline, so entries are joined with "\n".
    const entry = (subject: string, body = '') => `${subject}\x1f${body}\x1e`

    it('uses the separators that the parser expects in the git format', () => {
      expect(rules.GIT_LOG_FORMAT).toBe('%s%x1f%b%x1e')
    })

    it('splits subject and body of every commit', () => {
      const out = `${[
        entry('feat(po): filter baru'),
        entry('fix: x', 'BREAKING CHANGE: ganti env\n\nbaris lain\n'),
        entry('  chore: spasi  '),
      ].join('\n')}\n`
      const commits = rules.parseGitLog(out)
      expect(commits.map((c: { subject: string }) => c.subject)).toEqual([
        'feat(po): filter baru',
        'fix: x',
        'chore: spasi',
      ])
      expect(commits[0].body).toBe('')
      expect(commits[1].body).toContain('BREAKING CHANGE: ganti env')
    })

    it('keeps the body so that a BREAKING CHANGE footer still asks for a major bump', () => {
      const [commit] = rules.parseGitLog(entry('fix: x', 'BREAKING CHANGE: ganti env\n'))
      expect(rules.levelOf([rules.parseCommit(commit)]).level).toBe('major')
    })

    it('copes with Windows line endings between commits', () => {
      const out = `${entry('feat: a')}\r\n${entry('fix: b')}\r\n`
      expect(rules.parseGitLog(out).map((c: { subject: string }) => c.subject)).toEqual([
        'feat: a',
        'fix: b',
      ])
    })

    it('returns an empty list when there are no commits', () => {
      expect(rules.parseGitLog('')).toEqual([])
      expect(rules.parseGitLog('\n')).toEqual([])
    })
  })

  describe('nodeSupportsReleaseIt', () => {
    it('accepts 22.21 and newer 22, and every 24 and newer', () => {
      expect(rules.nodeSupportsReleaseIt('22.21.0')).toBe(true)
      expect(rules.nodeSupportsReleaseIt('22.30.1')).toBe(true)
      expect(rules.nodeSupportsReleaseIt('24.0.0')).toBe(true)
      expect(rules.nodeSupportsReleaseIt('24.14.1')).toBe(true)
      expect(rules.nodeSupportsReleaseIt('26.1.0')).toBe(true)
    })

    it('refuses older Node and the odd 23', () => {
      expect(rules.nodeSupportsReleaseIt('20.19.0')).toBe(false)
      expect(rules.nodeSupportsReleaseIt('22.20.9')).toBe(false)
      expect(rules.nodeSupportsReleaseIt('23.5.0')).toBe(false)
    })
  })
})
