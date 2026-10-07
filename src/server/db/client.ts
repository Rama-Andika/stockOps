import mysql from 'mysql2/promise'
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import type { RowDataPacket } from 'mysql2/promise'
import * as schema from './schema'
import { assertDistinctAppIdx, assertProductionSecrets, isProductionRuntime, serverEnv } from '../env'

export type Database = MySql2Database<typeof schema>

let poolInstance: mysql.Pool | undefined
let dbInstance: Database | undefined

/**
 * The MySQL pool. `supportBigNumbers` + `bigNumberStrings` are MANDATORY: without them the
 * driver hands back BIGINT ids as JavaScript numbers, which silently rounds away their last
 * digits. The corruption is invisible at the call site — the id simply stops matching any row.
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
    // Fail closed: never open the production pool with development defaults.
    if (isProductionRuntime()) {
      try {
        assertProductionSecrets()
      } catch (error) {
        console.error('[env]', error instanceof Error ? error.message : error)
        throw error
      }
    }
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
 * MySQL named lock (GET_LOCK) to serialize critical sections:
 * - document numbers (counter) across processes/instances
 * - a single session so it is not processed concurrently twice (idempotency)
 *
 * GET_LOCK is global per lock name, so it is safe even if its connection differs
 * from the transaction connection.
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

/** Runs fn with a specific database (schema); used by scripts & tests. */
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
