// Orchestrates the entire build pipeline for a given environment mode:
// 1. Loads mode-specific environment variables (.env.<mode>, .env)
// 2. Executes `vite build --mode <mode>`
// 3. Generates precache manifest with correct subpath prefix
// 4. Stamps dist/client/sw.js with version, build time, and subpath
//
// Usage:
//   node scripts/build.mjs              (defaults to production)
//   node scripts/build.mjs production   (or npm run build:prod)
//   node scripts/build.mjs staging      (or npm run build:staging)
//   node scripts/build.mjs --mode staging

import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeBasePath } from './lib/base-path.mjs'
import { loadAppEnv } from './lib/load-env.mjs'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))

// 1. Resolve mode and load environment configuration
const { mode, loadedFiles } = loadAppEnv()
const basePath = normalizeBasePath(process.env.STOCKOPS_BASE_PATH)

console.log('='.repeat(60))
console.log(`[build] StockOps Build Pipeline`)
console.log(`[build] Target mode : ${mode}`)
console.log(`[build] Base path   : ${basePath}`)
console.log(
  `[build] Env sources : ${loadedFiles.length > 0 ? loadedFiles.join(', ') : '(process environment only)'}`,
)
console.log('='.repeat(60))

// 2. Run Vite build
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
console.log(`\n[build] Step 1/3: Running Vite build (--mode ${mode})...`)
const viteBuild = spawnSync(`${npxCmd} vite build --mode ${mode}`, {
  cwd: rootDir,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    APP_ENV: mode,
    NODE_ENV: 'production',
  },
})

if (viteBuild.status !== 0) {
  console.error(`\n[build] Error: Vite build failed with exit code ${viteBuild.status}.`)
  process.exit(viteBuild.status ?? 1)
}

// 3. Generate precache manifest
console.log(`\n[build] Step 2/3: Generating precache manifest...`)
const precacheScript = join(rootDir, 'scripts', 'generate-precache.mjs')
const precacheStep = spawnSync(process.execPath, [precacheScript, mode], {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    APP_ENV: mode,
  },
})

if (precacheStep.status !== 0) {
  console.error(
    `\n[build] Error: Precache manifest generation failed with exit code ${precacheStep.status}.`,
  )
  process.exit(precacheStep.status ?? 1)
}

// 4. Stamp service worker
console.log(`\n[build] Step 3/3: Stamping service worker...`)
const stampScript = join(rootDir, 'scripts', 'stamp-sw.mjs')
const stampStep = spawnSync(process.execPath, [stampScript, mode], {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    APP_ENV: mode,
  },
})

if (stampStep.status !== 0) {
  console.error(
    `\n[build] Error: Service worker stamping failed with exit code ${stampStep.status}.`,
  )
  process.exit(stampStep.status ?? 1)
}

console.log('\n' + '='.repeat(60))
console.log(`[build] SUCCESS: StockOps build completed for mode "${mode}".`)
console.log(`[build] Output directory: dist/`)
console.log(`[build] Configured base path: ${basePath}`)
console.log('='.repeat(60) + '\n')
