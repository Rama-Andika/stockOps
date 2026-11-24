// Checks the build in dist/ without starting a server and without a database.
//
// Run it after `npm run build`:  npm run smoke:build
// It reads dist/ and package.json only; see scripts/deploy/bundle-check.mjs for what is checked.

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleProblems } from './deploy/bundle-check.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const { problems, precacheCount } = bundleProblems({
  exists: (path) => existsSync(join(root, ...path.split('/'))),
  read: (path) => readFileSync(join(root, ...path.split('/')), 'utf8'),
  expected: { version: pkg.version },
})

if (problems.length > 0) {
  console.error('[smoke] build TIDAK lulus pemeriksaan:')
  for (const problem of problems) console.error(`[smoke]   - ${problem}`)
  process.exitCode = 1
} else {
  console.log(
    `[smoke] build lulus: versi ${pkg.version}, ${precacheCount} berkas precache semuanya ada.`,
  )
}
