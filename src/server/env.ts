import 'dotenv/config'

function readInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function readString(name: string, fallback: string): string {
  const raw = process.env[name]
  return raw === undefined || raw.trim() === '' ? fallback : raw
}

export interface ServerEnv {
  host: string
  port: number
  user: string
  password: string
  database: string
  testDatabase: string
  adminAppIdx: number
  pdtAppIdx: number
  credentialHmacSecret: string
  sessionTtlDays: number
  credentialTtlDays: number
  receivePrefix: string
}

export const serverEnv: ServerEnv = {
  host: readString('DB_HOST', '127.0.0.1'),
  port: readInt('DB_PORT', 3306),
  user: readString('DB_USER', 'root'),
  password: readString('DB_PASSWORD', 'root'),
  database: readString('DB_NAME', 'demo'),
  testDatabase: readString('DB_TEST_NAME', 'stockops_test'),
  adminAppIdx: readInt('ADMIN_APP_ID_INDEX', 1),
  pdtAppIdx: readInt('PDT_APP_ID_INDEX', 2),
  credentialHmacSecret: readString('CREDENTIAL_HMAC_SECRET', 'stockops-dev-secret'),
  sessionTtlDays: readInt('SESSION_TTL_DAYS', 7),
  credentialTtlDays: readInt('CREDENTIAL_TTL_DAYS', 30),
  receivePrefix: readString('RECEIVE_DOC_PREFIX', 'IN'),
}

/**
 * The PDT's application index must differ from admin's. Both mint IDs into the same tables
 * with no shared sequence, and the index is the only thing keeping their ranges apart — share
 * it and the two writers eventually collide on a primary key.
 */
export function assertDistinctAppIdx(env: ServerEnv = serverEnv): void {
  if (env.pdtAppIdx === env.adminAppIdx) {
    throw new Error(
      `PDT_APP_ID_INDEX (${env.pdtAppIdx}) tidak boleh sama dengan ADMIN_APP_ID_INDEX (${env.adminAppIdx})`,
    )
  }
}

/** Values that must never be used as the HMAC secret in production. */
const WEAK_HMAC_SECRETS = new Set(['stockops-dev-secret', 'ganti-dengan-kunci-rahasia-anda'])
const MIN_HMAC_SECRET_LENGTH = 32

/** True only when the process runs as the production server (`npm start` sets NODE_ENV). */
export function isProductionRuntime(raw: NodeJS.ProcessEnv = process.env): boolean {
  return raw.NODE_ENV === 'production'
}

/**
 * Production must not silently fall back to development defaults: a publicly known
 * HMAC secret lets anyone turn cached fingerprints back into passwords, and the
 * root/root database fallback must never be used implicitly.
 */
export function assertProductionSecrets(
  env: ServerEnv = serverEnv,
  raw: NodeJS.ProcessEnv = process.env,
): void {
  const problems: string[] = []
  const secret = env.credentialHmacSecret
  if (WEAK_HMAC_SECRETS.has(secret) || secret.length < MIN_HMAC_SECRET_LENGTH) {
    problems.push(`CREDENTIAL_HMAC_SECRET wajib berisi nilai acak minimal ${MIN_HMAC_SECRET_LENGTH} karakter`)
  }
  for (const name of ['DB_USER', 'DB_PASSWORD', 'DB_NAME'] as const) {
    const value = raw[name]
    if (value === undefined || value.trim() === '') problems.push(`${name} wajib diisi`)
  }
  if (problems.length > 0) {
    throw new Error(`Konfigurasi produksi tidak aman: ${problems.join('; ')}.`)
  }
}
