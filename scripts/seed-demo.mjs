// DEMO data seed for the `demo` database.
//
// Principles:
// - Only INSERT new rows with IDs clearly specific to the demo (e.g. purchase_id
//   990001). The schema is NOT modified (BR-18).
// - Do not overwrite existing admin data; items use master items that
//   ALREADY EXIST (avoiding foreign key violations).
// - ALL bigint values are passed as STRINGS, not numbers. This is critical:
//   Admin system IDs > 2^53, so precision is lost if passed
//   as JavaScript numbers (BR-12).
// - Idempotent; `--clean` deletes only these demo rows.
//
// Usage: npm run db:seed  |  npm run db:seed:clean

import mysql from 'mysql2/promise'
import 'dotenv/config'

// bigint IDs as strings (BR-12).
const DEMO = {
  vendorId: '990001',
  itemIds: ['4000001', '4000002'], // master items that already exist in demo
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
  currencyId: '504404384818397770',
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
       (purchase_id, number, status, vendor_id, location_id, user_id, company_id, purch_date, total_amount,
        include_tax, tax_percent, discount_percent, payment_type, currency_id, price_include_tax)
     VALUES (?, ?, 'CHECKED', ?, ?, ?, 0, NOW(), 1000000, 1, 11.00, 0.00, 'Cash', ?, 0)
     ON DUPLICATE KEY UPDATE status = 'CHECKED', vendor_id = VALUES(vendor_id)`,
    [DEMO.purchaseId, DEMO.purchaseNumber, DEMO.vendorId, DEMO.locationId, DEMO.userId, DEMO.currencyId],
  )

  await connection.query(
    `INSERT INTO pos_purchase_item
       (purchase_item_id, purchase_id, item_master_id, qty, uom_id, status, amount, discount_amount)
     VALUES (?, ?, ?, 10, ?, 'OPEN', 100000.00, 0.00), (?, ?, ?, 5, ?, 'OPEN', 100000.00, 0.00)
     ON DUPLICATE KEY UPDATE qty = VALUES(qty), uom_id = VALUES(uom_id), amount = VALUES(amount)`,
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
