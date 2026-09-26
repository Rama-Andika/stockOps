import mysql from 'mysql2/promise'
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import type { RowDataPacket } from 'mysql2/promise'
import * as schema from './schema'
import { assertDistinctAppIdx, serverEnv } from '../env'

export type Database = MySql2Database<typeof schema>

let poolInstance: mysql.Pool | undefined
let dbInstance: Database | undefined

/**
 * Pool MySQL. `supportBigNumbers` + `bigNumberStrings` WAJIB agar BIGINT
 * dikembalikan sebagai string, bukan Number yang kehilangan presisi (BR-12).
 */
export function createMysqlPool(database: string = serverEnv.database): mysql.Pool {
  return mysql.createPool({
    host: serverEnv.host,
    port: serverEnv.port,
    user: serverEnv.user,
    password: serverEnv.password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    charset: 'utf8mb4',
    multipleStatements: false,
  })
}

export function getPool(): mysql.Pool {
  if (!poolInstance) {
    assertDistinctAppIdx()
    poolInstance = createMysqlPool()
  }
  return poolInstance
}

export function getDb(): Database {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema, mode: 'default' })
  }
  return dbInstance
}

export async function closeDb(): Promise<void> {
  if (poolInstance) {
    const pool = poolInstance
    poolInstance = undefined
    dbInstance = undefined
    await pool.end()
  }
}

/**
 * Kunci bernama MySQL (GET_LOCK) untuk mengserialisasi bagian kritis:
 * - nomor dokumen (counter) antar proses/instance
 * - satu sesi agar tidak diproses dua kali bersamaan (idempotensi)
 *
 * GET_LOCK bersifat global per nama, sehingga aman walau koneksinya berbeda
 * dari koneksi transaksi.
 */
export async function withNamedLock<T>(
  name: string,
  fn: () => Promise<T>,
  timeoutSeconds = 10,
): Promise<T> {
  const connection = await getPool().getConnection()
  try {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT GET_LOCK(?, ?) AS acquired',
      [name, timeoutSeconds],
    )
    const acquired = rows[0]?.acquired
    if (acquired !== 1 && acquired !== '1') {
      throw new Error(`Gagal memperoleh lock "${name}" (timeout ${timeoutSeconds}s)`)
    }
    return await fn()
  } finally {
    try {
      await connection.query('SELECT RELEASE_LOCK(?)', [name])
    } finally {
      connection.release()
    }
  }
}

/** Menjalankan fn dengan database (schema) tertentu; dipakai oleh skrip & test. */
export async function withDatabase<T>(
  database: string,
  fn: (db: Database, pool: mysql.Pool) => Promise<T>,
): Promise<T> {
  assertDistinctAppIdx()
  const pool = createMysqlPool(database)
  const db = drizzle(pool, { schema, mode: 'default' })
  try {
    return await fn(db, pool)
  } finally {
    await pool.end()
  }
}
