// Seed data DEMO untuk database `demo`.
//
// Prinsip:
// - Hanya INSERT baris baru dengan ID yang jelas khusus demo (mis. purchase_id
//   990001). Schema TIDAK diubah (BR-18).
// - Tidak menimpa data admin yang sudah ada; barang memakai master item yang
//   SUDAH ADA (menghindari pelanggaran foreign key).
// - SEMUA nilai bigint dikirim sebagai STRING, bukan number. Ini penting:
//   ID sistem admin > 2^53 sehingga akan kehilangan presisi bila dikirim
//   sebagai number JavaScript (BR-12).
// - Idempoten; `--clean` menghapus hanya baris demo ini.
//
// Pemakaian: npm run db:seed  |  npm run db:seed:clean

import mysql from 'mysql2/promise'
import 'dotenv/config'

// ID bigint sebagai string (BR-12).
const DEMO = {
  vendorId: '990001',
  itemIds: ['4000001', '4000002'], // master barang yang sudah ada di demo
  vendorItemIds: ['990201', '990202'],
  purchaseId: '990001',
  purchaseItemIds: ['990101', '990102'],
  userId: '9900001',
  purchaseNumber: 'PDTDEMO01',
  locationId: '6660031',
  units: {
    PCS: '504404793498968532',
    KARTON: '504404795314333035',
    PACK: '504404795314357956',
  },
  loginId: 'pdt',
  password: 'pdt123',
}

const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number.parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'demo',
}

async function clean(connection) {
  await connection.query('DELETE FROM pos_receive_item WHERE purchase_item_id IN (?, ?)', DEMO.purchaseItemIds)
  await connection.query('DELETE FROM pos_receive WHERE purchase_id = ?', [DEMO.purchaseId])
  await connection.query('DELETE FROM pos_purchase_item WHERE purchase_id = ?', [DEMO.purchaseId])
  await connection.query('DELETE FROM pos_purchase WHERE purchase_id = ?', [DEMO.purchaseId])
  await connection.query('DELETE FROM pos_vendor_item WHERE vendor_item_id IN (?, ?)', DEMO.vendorItemIds)
  await connection.query('DELETE FROM vendor WHERE vendor_id = ?', [DEMO.vendorId])
  await connection.query('DELETE FROM sysuser WHERE user_id = ?', [DEMO.userId])
  console.log('Data demo StockOps dihapus (master barang yang dipakai ulang tidak disentuh).')
}

async function assertMasterItemsExist(connection) {
  const [rows] = await connection.query(
    'SELECT item_master_id, code, barcode, name, uom_stock_id FROM pos_item_master WHERE item_master_id IN (?, ?) AND is_active = 1',
    DEMO.itemIds,
  )
  if (rows.length < 2) {
    throw new Error(
      `Master barang demo (${DEMO.itemIds.join(', ')}) tidak ditemukan/nonaktif di database ${config.database}. ` +
        'Jalankan pada database yang memiliki master barang, atau sesuaikan DEMO.itemIds pada skrip.',
    )
  }
  return rows
}

async function seed(connection) {
  const { units } = DEMO

  for (const [unit, uomId] of Object.entries(units)) {
    await connection.query(
      'INSERT INTO pos_unit (uom_id, unit) VALUES (?, ?) ON DUPLICATE KEY UPDATE unit = unit',
      [uomId, unit],
    )
  }

  await connection.query(
    `INSERT INTO vendor (vendor_id, code, name, due_date, wpage, company_id)
     VALUES (?, 'PDTDEMO', 'VENDOR DEMO STOCKOPS', 30, '', 0)
     ON DUPLICATE KEY UPDATE name = VALUES(name), due_date = VALUES(due_date)`,
    [DEMO.vendorId],
  )

  await connection.query(
    `INSERT INTO sysuser (user_id, login_id, password, full_name, user_status, company_id)
     VALUES (?, ?, ?, 'Operator PDT Demo', 1, 0)
     ON DUPLICATE KEY UPDATE login_id = VALUES(login_id), password = VALUES(password), user_status = 1`,
    [DEMO.userId, DEMO.loginId, DEMO.password],
  )

  await connection.query(
    `INSERT INTO pos_vendor_item (vendor_item_id, vendor_id, item_master_id, uom_purchase, conv_qty, company_id)
     VALUES (?, ?, ?, ?, 12, 0), (?, ?, ?, ?, 6, 0)
     ON DUPLICATE KEY UPDATE conv_qty = VALUES(conv_qty)`,
    [
      DEMO.vendorItemIds[0], DEMO.vendorId, DEMO.itemIds[0], units.KARTON,
      DEMO.vendorItemIds[1], DEMO.vendorId, DEMO.itemIds[1], units.PACK,
    ],
  )

  await connection.query(
    `INSERT INTO pos_purchase
       (purchase_id, number, status, vendor_id, location_id, user_id, company_id, purch_date, total_amount)
     VALUES (?, ?, 'CHECKED', ?, ?, ?, 0, NOW(), 1000000)
     ON DUPLICATE KEY UPDATE status = 'CHECKED', vendor_id = VALUES(vendor_id)`,
    [DEMO.purchaseId, DEMO.purchaseNumber, DEMO.vendorId, DEMO.locationId, DEMO.userId],
  )

  await connection.query(
    `INSERT INTO pos_purchase_item (purchase_item_id, purchase_id, item_master_id, qty, uom_id, status)
     VALUES (?, ?, ?, 10, ?, 'OPEN'), (?, ?, ?, 5, ?, 'OPEN')
     ON DUPLICATE KEY UPDATE qty = VALUES(qty), uom_id = VALUES(uom_id)`,
    [
      DEMO.purchaseItemIds[0], DEMO.purchaseId, DEMO.itemIds[0], units.KARTON,
      DEMO.purchaseItemIds[1], DEMO.purchaseId, DEMO.itemIds[1], units.PACK,
    ],
  )
}

const connection = await mysql.createConnection(config)
try {
  if (process.argv.includes('--clean')) {
    await clean(connection)
  } else {
    const items = await assertMasterItemsExist(connection)
    await seed(connection)
    console.log(`Seed demo selesai di database "${config.database}":`)
    console.log(`  PO          : ${DEMO.purchaseNumber} (status CHECKED, id ${DEMO.purchaseId})`)
    console.log(`  Vendor      : VENDOR DEMO STOCKOPS (id ${DEMO.vendorId})`)
    console.log(`  Barang 1     : ${items[0].name} — barcode ${items[0].barcode} (1 KARTON = 12 PCS)`)
    console.log(`  Barang 2     : ${items[1].name} — barcode ${items[1].barcode} (1 PACK = 6 PCS)`)
    console.log(`  Login PDT   : ${DEMO.loginId} / ${DEMO.password}`)
  }
} catch (error) {
  console.error('[seed-demo] gagal:', error.message ?? error)
  process.exitCode = 1
} finally {
  await connection.end()
}
