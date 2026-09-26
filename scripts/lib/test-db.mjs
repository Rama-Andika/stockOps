// Utilitas pembuatan schema database UJI.
//
// Prinsip penting:
// - Database produksi (`demo`) TIDAK PERNAH diubah. Kita hanya membaca DDL-nya
//   lewat SHOW CREATE TABLE untuk meniru struktur tabelnya di schema uji.
// - Nama tabel di schema uji SAMA dengan produksi, supaya kode/schema Drizzle
//   yang sama bisa diuji apa adanya.
// - Foreign key dilepas di schema uji agar tidak bergantung pada tabel lain
//   yang tidak ikut dikloning.

import mysql from 'mysql2/promise'
import 'dotenv/config'

export const CLONED_TABLES = [
  'pos_purchase',
  'pos_purchase_item',
  'pos_receive',
  'pos_receive_item',
  'pos_item_master',
  'pos_unit',
  'vendor',
  'pos_vendor_item',
  'sysuser',
]

export function resolveDbConfig() {
  const host = process.env.DB_HOST || '127.0.0.1'
  const port = Number.parseInt(process.env.DB_PORT || '3306', 10)
  const user = process.env.DB_USER || 'root'
  const password = process.env.DB_PASSWORD || 'root'
  const production = process.env.DB_NAME || 'demo'
  const test = process.env.DB_TEST_NAME || 'stockops_test'

  if (test === production) {
    throw new Error(`DB_TEST_NAME tidak boleh sama dengan DB_NAME (${production})`)
  }
  if (!/test/i.test(test)) {
    // Pengaman tambahan: nama schema uji harus mengandung "test".
    throw new Error(`Nama schema uji tidak aman: "${test}" (harus mengandung "test")`)
  }
  return { host, port, user, password, production, test }
}

function stripForeignKeys(ddl) {
  return ddl.replace(
    /,\s*CONSTRAINT\s+`[^`]+`\s+FOREIGN\s+KEY\s+\([^)]*\)\s+REFERENCES\s+`[^`]+`\s+\([^)]*\)/gi,
    '',
  )
}

export async function createTestSchema(options = {}) {
  const { log = () => {} } = options
  const config = resolveDbConfig()
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    multipleStatements: false,
  })

  try {
    log(`Membuat schema uji "${config.test}" (meniru DDL dari "${config.production}")`)
    await connection.query(`DROP DATABASE IF EXISTS \`${config.test}\``)
    await connection.query(
      `CREATE DATABASE \`${config.test}\` CHARACTER SET latin1 COLLATE latin1_swedish_ci`,
    )
    await connection.query(`USE \`${config.test}\``)
    await connection.query('SET FOREIGN_KEY_CHECKS = 0')

    for (const table of CLONED_TABLES) {
      const [rows] = await connection.query(`SHOW CREATE TABLE \`${config.production}\`.\`${table}\``)
      const ddlRaw = rows[0]?.['Create Table']
      if (!ddlRaw) throw new Error(`Gagal membaca DDL untuk tabel ${table}`)
      const ddl = stripForeignKeys(ddlRaw)
      await connection.query(`DROP TABLE IF EXISTS \`${table}\``)
      await connection.query(ddl)
      log(`  - ${table} ok`)
    }

    await connection.query('SET FOREIGN_KEY_CHECKS = 1')
    return config
  } finally {
    await connection.end()
  }
}

export async function dropTestSchema(options = {}) {
  const { log = () => {} } = options
  const config = resolveDbConfig()
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
  })
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${config.test}\``)
    log(`Schema uji "${config.test}" dihapus`)
  } finally {
    await connection.end()
  }
}

// Jalankan langsung: `node scripts/setup-test-db.mjs`
const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href
if (invokedDirectly) {
  createTestSchema({ log: console.log })
    .then((config) => {
      console.log(`Selesai. Schema uji siap: ${config.test}`)
    })
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
