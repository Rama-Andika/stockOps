// Stamps the real app version, build time, and base path into dist/client/sw.js.
//
// public/sw.js — the SOURCE — keeps its 'dev' placeholders and is never modified. Only the copy
// vite put in dist/client is rewritten, which is why this script must run AFTER `vite build`.
//
// Why it exists at all: BUILD_TIME is part of CACHE_VERSION, so stamping makes sw.js differ on
// every build. That is the only thing that makes the browser run `install` again, and `install`
// is the only moment the precache manifest is read. BASE_PATH and TENANT_SLUG scope the caches
// and precaching URLs to the client subpath.
//
// Run from `npm run build` (see package.json).

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { normalizeBasePath, getTenantSlug } from './lib/base-path.mjs'
import { loadAppEnv } from './lib/load-env.mjs'

const { mode } = loadAppEnv()
const rootDir = fileURLToPath(new URL('..', import.meta.url))
const swPath = join(rootDir, 'dist', 'client', 'sw.js')

const pkg = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'))
const version = pkg.version
const buildTime = new Date().toISOString()
const basePath = normalizeBasePath(process.env.STOCKOPS_BASE_PATH)
const tenantSlug = getTenantSlug(basePath)

let source
try {
  source = await readFile(swPath, 'utf8')
} catch {
  console.error('[stamp-sw] dist/client/sw.js tidak ditemukan.')
  console.error(
    '[stamp-sw] Jalankan `vite build` lebih dulu (lihat script "build" di package.json).',
  )
  process.exit(1)
}

// Marker lines are matched as LITERAL TEXT. Failing loudly is the whole point: a silent miss here
// would ship a service worker whose CACHE_VERSION or BASE_PATH is incorrect.
const VERSION_MARKER = "const APP_VERSION = 'dev'"
const BUILD_TIME_MARKER = "const BUILD_TIME = 'dev'"
const BASE_PATH_MARKER = "const BASE_PATH = '/'"
const TENANT_SLUG_MARKER = "const TENANT_SLUG = ''"

for (const marker of [VERSION_MARKER, BUILD_TIME_MARKER, BASE_PATH_MARKER, TENANT_SLUG_MARKER]) {
  const count = source.split(marker).length - 1
  if (count !== 1) {
    console.error(`[stamp-sw] Baris penanda harus ada tepat satu kali, ditemukan ${count}x:`)
    console.error(`[stamp-sw]   ${marker}`)
    console.error('[stamp-sw] Perbaiki public/sw.js — bentuk baris penanda tidak boleh diubah.')
    process.exit(1)
  }
}

const stamped = source
  .replace(VERSION_MARKER, `const APP_VERSION = ${JSON.stringify(version)}`)
  .replace(BUILD_TIME_MARKER, `const BUILD_TIME = ${JSON.stringify(buildTime)}`)
  .replace(BASE_PATH_MARKER, `const BASE_PATH = ${JSON.stringify(basePath)}`)
  .replace(TENANT_SLUG_MARKER, `const TENANT_SLUG = ${JSON.stringify(tenantSlug)}`)

await writeFile(swPath, stamped)
console.log(
  `[stamp-sw] dist/client/sw.js distamp: ${version} (${buildTime}) mode=${mode} base=${basePath} slug=${tenantSlug || 'root'}`,
)
