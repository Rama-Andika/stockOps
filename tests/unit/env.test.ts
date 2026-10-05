import { describe, expect, it } from 'vitest'
import {
  assertProductionSecrets,
  isProductionRuntime,
  serverEnv,
  type ServerEnv,
} from '~/server/env'

const STRONG_SECRET = 'k'.repeat(40)
const RAW_OK = { DB_USER: 'stockops', DB_PASSWORD: 'rahasia', DB_NAME: 'erp' }

function envWith(secret: string): ServerEnv {
  return { ...serverEnv, credentialHmacSecret: secret }
}

describe('assertProductionSecrets', () => {
  it('lolos untuk secret kuat & kredensial DB yang diisi eksplisit', () => {
    expect(() => assertProductionSecrets(envWith(STRONG_SECRET), RAW_OK)).not.toThrow()
  })

  it('menolak secret default pengembangan', () => {
    expect(() => assertProductionSecrets(envWith('stockops-dev-secret'), RAW_OK)).toThrow(
      /CREDENTIAL_HMAC_SECRET/,
    )
  })

  it('menolak placeholder dari .env.example', () => {
    expect(() =>
      assertProductionSecrets(envWith('ganti-dengan-kunci-rahasia-anda'), RAW_OK),
    ).toThrow(/CREDENTIAL_HMAC_SECRET/)
  })

  it('menolak secret yang terlalu pendek', () => {
    expect(() => assertProductionSecrets(envWith('pendek'), RAW_OK)).toThrow(/CREDENTIAL_HMAC_SECRET/)
  })

  it('menolak bila DB_PASSWORD tidak diisi', () => {
    expect(() =>
      assertProductionSecrets(envWith(STRONG_SECRET), { DB_USER: 'stockops', DB_NAME: 'erp' }),
    ).toThrow(/DB_PASSWORD/)
  })
})

describe('isProductionRuntime', () => {
  it('hanya true bila NODE_ENV = production', () => {
    expect(isProductionRuntime({ NODE_ENV: 'production' })).toBe(true)
    expect(isProductionRuntime({ NODE_ENV: 'test' })).toBe(false)
    expect(isProductionRuntime({})).toBe(false)
  })
})
