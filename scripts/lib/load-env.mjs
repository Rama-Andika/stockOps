import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const rootDir = resolve(fileURLToPath(new URL('../..', import.meta.url)))

/**
 * Normalizes common mode aliases into canonical names.
 * @param {string} mode
 * @returns {string}
 */
export function normalizeMode(mode) {
  if (!mode || typeof mode !== 'string') return 'production'
  const trimmed = mode.trim().toLowerCase()
  if (trimmed === 'prod') return 'production'
  if (trimmed === 'dev') return 'development'
  return trimmed
}

/**
 * Extracts target mode from CLI arguments, environment variables, or fallback.
 * Checks for:
 * 1. `--mode <value>` or `--mode=<value>`
 * 2. Positional argument (e.g. `node scripts/build.mjs staging`)
 * 3. `process.env.APP_ENV`
 * 4. `process.env.NODE_ENV`
 * 5. Provided defaultMode
 *
 * @param {string} [defaultMode='production']
 * @returns {string}
 */
export function resolveMode(defaultMode = 'production') {
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--mode' && args[i + 1]) {
      return normalizeMode(args[i + 1])
    }
    if (arg.startsWith('--mode=')) {
      return normalizeMode(arg.slice(7))
    }
  }

  // Check first positional argument if not an option flag
  for (const arg of args) {
    if (!arg.startsWith('-')) {
      return normalizeMode(arg)
    }
  }

  if (process.env.APP_ENV) {
    return normalizeMode(process.env.APP_ENV)
  }

  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'test') {
    return normalizeMode(process.env.NODE_ENV)
  }

  return normalizeMode(defaultMode)
}

/**
 * Loads environment variables according to mode priority:
 * 1. .env.[mode].local
 * 2. .env.[mode]
 * 3. .env.local
 * 4. .env
 * 5. stockops.env (server environment file if present)
 *
 * Note: By default, dotenv does not overwrite variables already in process.env.
 * Loading higher-priority files first preserves their values over fallbacks.
 *
 * @param {string} [explicitMode]
 * @returns {{ mode: string, loadedFiles: string[] }}
 */
export function loadAppEnv(explicitMode) {
  const mode = normalizeMode(explicitMode || resolveMode('production'))

  const candidates = [`.env.${mode}.local`, `.env.${mode}`, '.env.local', '.env', 'stockops.env']

  const loadedFiles = []
  for (const candidate of candidates) {
    const fullPath = join(rootDir, candidate)
    if (existsSync(fullPath)) {
      dotenv.config({ path: fullPath })
      loadedFiles.push(candidate)
    }
  }

  // Export resolved APP_ENV to process.env so downstream code knows the active mode
  process.env.APP_ENV = mode

  return { mode, loadedFiles }
}
