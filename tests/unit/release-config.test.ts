import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error - ESM script without TypeScript declarations
import * as rules from '../../scripts/release/release-rules.mjs'

type ChangelogType = { type: string; section?: string; effect?: string; hidden?: boolean }

function readJson(name: string) {
  return JSON.parse(readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8'))
}

const withChangelog = readJson('.release-it.json')
const withoutChangelog = readJson('.release-it.no-changelog.json')
const plugin = withChangelog.plugins['@release-it/conventional-changelog']
const types: ChangelogType[] = plugin.preset.types

describe('release-it configuration', () => {
  it('both files make the same commit, tag and push, from main only', () => {
    expect(withoutChangelog.git).toEqual(withChangelog.git)
    expect(withChangelog.git).toMatchObject({
      requireBranch: 'main',
      requireCleanWorkingDir: true,
      requireUpstream: true,
      commit: true,
      commitMessage: 'chore(release): v${version}',
      tag: true,
      tagName: 'v${version}',
      push: true,
    })
  })

  it('leaves release candidate tags out of "the latest tag", so a stable release counts from the last stable tag', () => {
    expect(withChangelog.git.tagExclude).toBe('*[-]*')
  })

  it('never publishes to npm or creates a GitHub release', () => {
    for (const config of [withChangelog, withoutChangelog]) {
      expect(config.npm).toEqual({ publish: false, skipChecks: true })
      expect(config.github).toEqual({ release: false })
    }
  })

  it('the file without a changelog has no plugin, so release candidates write no entry', () => {
    expect(withoutChangelog.plugins).toBeUndefined()
  })

  it('writes CHANGELOG.md from the commits and takes the version from the release script', () => {
    expect(plugin.infile).toBe('CHANGELOG.md')
    expect(plugin.header).toBe('# Changelog')
    expect(plugin.ignoreRecommendedBump).toBe(true)
  })

  it('never splits one stable release into several entries at a release candidate tag', () => {
    // Without generateOn: null, the rc tag inside the range starts a second "release" in CHANGELOG.md.
    expect(plugin.writerOpts).toEqual({ generateOn: null })
  })

  it('lists exactly the commit types the release script accepts', () => {
    expect(types.map((t) => t.type).sort()).toEqual([...rules.COMMIT_TYPES].sort())
  })

  it('shows only feat, fix and perf, and hides every other type with effect "hidden"', () => {
    const shown: Record<string, string> = {
      feat: 'Features',
      fix: 'Bug Fixes',
      perf: 'Performance',
    }
    for (const entry of types) {
      if (entry.type in shown) {
        expect(entry.section).toBe(shown[entry.type])
        expect(entry.effect).toBeUndefined()
      } else {
        // This preset only understands effect: "hidden"; a plain hidden: true is silently ignored.
        expect(entry.effect, entry.type).toBe('hidden')
        expect(entry.hidden, entry.type).toBeUndefined()
      }
    }
  })
})
