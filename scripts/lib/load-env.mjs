import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
 * Parses a simple key=value env file and populates process.env without overwriting existing entries.
 * Zero external dependencies: works reliably in minimal production containers without dotenv.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function loadSingleEnvFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8')
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const eqIdx = line.indexOf('=')
      if (eqIdx === -1) continue
      const key = line.slice(0, eqIdx).trim()
      let val = line.slice(eqIdx + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      // Never overwrite existing process.env variables (e.g. injected by Docker, systemd, or shell)
      if (process.env[key] === undefined) {
        process.env[key] = val
      }
    }
    return true
  } catch {
    return false
  }
}

/**
 * Loads environment variables according to mode priority:
 * 1. .env.[mode].local
 * 2. .env.[mode]
 * 3. .env.local
 * 4. .env
 * 5. stockops.env (server environment file if present)
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
      if (loadSingleEnvFile(fullPath)) {
        loadedFiles.push(candidate)
      }
    }
  }

  // Export resolved APP_ENV to process.env so downstream code knows the active mode
  process.env.APP_ENV = mode

  return { mode, loadedFiles }
}
