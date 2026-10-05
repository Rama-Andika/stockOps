// Generates dist/client/precache-manifest.json: list of ALL build assets
// so that the service worker can precache everything (including per-route chunks).
// Run after `vite build` (see package.json -> script "build").

import { readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const clientDir = join(rootDir, 'dist', 'client')

async function walk(dir, base = '') {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...(await walk(join(dir, entry.name), rel)))
    } else {
      files.push(rel)
    }
  }
  return files
}

const files = await walk(clientDir)
const urls = files
  .filter((file) => !file.endsWith('.map'))
  .filter((file) => file !== 'sw.js' && file !== 'precache-manifest.json')
  .map((file) => `/${file}`)

await writeFile(join(clientDir, 'precache-manifest.json'), JSON.stringify(urls, null, 2))
console.log(`[precache] ${urls.length} aset ditulis ke dist/client/precache-manifest.json`)
