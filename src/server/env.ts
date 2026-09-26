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

/** appIdx PDT harus berbeda dari admin, kalau tidak ID bisa bertabrakan (BR-17). */
export function assertDistinctAppIdx(env: ServerEnv = serverEnv): void {
  if (env.pdtAppIdx === env.adminAppIdx) {
    throw new Error(
      `PDT_APP_ID_INDEX (${env.pdtAppIdx}) tidak boleh sama dengan ADMIN_APP_ID_INDEX (${env.adminAppIdx})`,
    )
  }
}
