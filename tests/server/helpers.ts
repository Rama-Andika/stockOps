import { sql } from 'drizzle-orm'
import { getDb } from '~/server/db/client'
import { invalidateCache } from '~/server/db/cache'
import { rowsOf } from '~/server/db/rows'

/** Tables cloned to the test schema. */
export const TEST_TABLES = [
  'document_history',
  'pos_receive_item',
  'pos_receive',
  'pos_purchase_item',
  'pos_purchase',
  'pos_vendor_item',
  'pos_item_master',
  'pos_unit',
  'vendor',
  'sysuser',
] as const

/** Reference fixture data (recreated for each test). */
export const FIXTURE = {
  uom: {
    PCS: '504404793498968532',
    KARTON: '504404795314333035',
    PACK: '504404795314357956',
  },
  vendor: { V1: '6000001' },
  item: { I1: '4000001', I2: '4000002', I3_INACTIVE: '4000003' },
  user: {
    ACTIVE: '1200001',
    ACTIVE_2: '1200003',
    INACTIVE: '1200004',
  },
  purchase: { CHECKED: '720593553946113952', DRAFT: '720593553977094985', CHECKED_OTHER_LOC: '720593553977261000' },
  purchaseItem: {
    PI1: '720593553946114417',
    PI2: '720593553977261243',
    PI3: '720593553977261244',
    PI_DRAFT: '720593553977095148',
    PI_OTHER: '720593553977261001',
  },
  location: { L1: '5044048676177565078', L2: '6660031' },
  currency: { IDR: '504404384818397770' },
} as const

export const CREDENTIALS = {
  ACTIVE: { loginId: 'gedesujana', password: 'Desubali' },
  ACTIVE_2: { loginId: '100318', password: 'sariwangi25' },
  INACTIVE: { loginId: '101352', password: 'resign2024' },
} as const

export async function resetDatabase(): Promise<void> {
  const db = getDb()
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`)
  for (const table of TEST_TABLES) {
    await db.execute(sql.raw(`TRUNCATE TABLE \`${table}\``))
  }
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`)
  invalidateCache()
}

export async function seedBase(): Promise<void> {
  const db = getDb()
  const { uom, vendor, item, user, purchase, location, currency } = FIXTURE

  await db.execute(sql`
    INSERT INTO pos_unit (uom_id, unit) VALUES
      (${uom.PCS}, 'PCS'),
      (${uom.KARTON}, 'KARTON'),
      (${uom.PACK}, 'PACK')
  `)

  await db.execute(sql`
    INSERT INTO vendor (vendor_id, code, name, due_date, wpage, company_id) VALUES
      (${vendor.V1}, '101', 'BALI LESTARI KOSMETIK', 30, '', 0)
  `)

  await db.execute(sql`
    INSERT INTO pos_item_master
      (item_master_id, code, barcode, barcode_2, barcode_3, name, uom_stock_id, uom_purchase_id, is_active)
    VALUES
      (${item.I1}, '48000001', '22001771', '899123', NULL, 'SISIR ANAK SAILIYA', ${uom.PCS}, ${uom.KARTON}, 1),
      (${item.I2}, '48000002', '22001773', NULL, 'ALT-2', 'SISIR CARAVAN SET 4', ${uom.PCS}, ${uom.PACK}, 1),
      (${item.I3_INACTIVE}, '48000003', '22001776', NULL, NULL, 'BARANG NONAKTIF', ${uom.PCS}, ${uom.PCS}, 0)
  `)

  // Conversion: 1 KARTON = 12 PCS ; 1 PACK = 6 PCS
  await db.execute(sql`
    INSERT INTO pos_vendor_item (vendor_item_id, vendor_id, item_master_id, uom_purchase, conv_qty, company_id) VALUES
      ('900001', ${vendor.V1}, ${item.I1}, ${uom.KARTON}, 12, 0),
      ('900002', ${vendor.V1}, ${item.I2}, ${uom.PACK}, 6, 0)
  `)

  await db.execute(sql`
    INSERT INTO sysuser (user_id, login_id, password, full_name, user_status, company_id) VALUES
      (${user.ACTIVE}, ${CREDENTIALS.ACTIVE.loginId}, ${CREDENTIALS.ACTIVE.password}, 'I Gede Sujana', 1, 0),
      (${user.ACTIVE_2}, ${CREDENTIALS.ACTIVE_2.loginId}, ${CREDENTIALS.ACTIVE_2.password}, 'I Putu Ratmaja', 1, 0),
      (${user.INACTIVE}, ${CREDENTIALS.INACTIVE.loginId}, ${CREDENTIALS.INACTIVE.password}, 'Ketut Erlina Wati', 2, 0)
  `)

  await db.execute(sql`
    INSERT INTO pos_purchase
      (purchase_id, number, status, vendor_id, location_id, user_id, company_id, purch_date, total_amount,
       include_tax, tax_percent, discount_percent, payment_type, currency_id, price_include_tax)
    VALUES
      (${purchase.CHECKED}, 'PO10250001', 'CHECKED', ${vendor.V1}, ${location.L1}, ${user.ACTIVE}, 0, '2025-10-25 00:00:00', 100000, 1, 11.00, 0.00, 'Cash', ${currency.IDR}, 0),
      (${purchase.DRAFT}, 'PO10250002', 'DRAFT', ${vendor.V1}, ${location.L1}, ${user.ACTIVE}, 0, '2025-10-25 00:00:00', 50000, 1, 11.00, 0.00, 'Cash', ${currency.IDR}, 0),
      (${purchase.CHECKED_OTHER_LOC}, 'PO10250003', 'CHECKED', ${vendor.V1}, ${location.L2}, ${user.ACTIVE}, 0, '2025-10-25 00:00:00', 70000, 1, 11.00, 0.00, 'Cash', ${currency.IDR}, 0)
  `)

  const { purchaseItem } = FIXTURE
  await db.execute(sql`
    INSERT INTO pos_purchase_item
      (purchase_item_id, purchase_id, item_master_id, qty, uom_id, status, amount, discount_amount) VALUES
      (${purchaseItem.PI1}, ${purchase.CHECKED}, ${item.I1}, 10, ${uom.KARTON}, 'OPEN', 100000.00, 39403.99),
      (${purchaseItem.PI2}, ${purchase.CHECKED}, ${item.I2}, 5, ${uom.PACK}, 'OPEN', 100000.00, 0.00),
      (${purchaseItem.PI3}, ${purchase.CHECKED}, ${item.I3_INACTIVE}, 3, ${uom.PCS}, 'OPEN', 100000.00, 0.00),
      (${purchaseItem.PI_DRAFT}, ${purchase.DRAFT}, ${item.I1}, 1, ${uom.KARTON}, 'OPEN', 100000.00, 0.00),
      (${purchaseItem.PI_OTHER}, ${purchase.CHECKED_OTHER_LOC}, ${item.I1}, 7, ${uom.KARTON}, 'OPEN', 100000.00, 0.00)
  `)
}

export async function seedAll(): Promise<void> {
  await resetDatabase()
  await seedBase()
}

export async function queryRows<T extends Record<string, unknown>>(
  query: ReturnType<typeof sql>,
): Promise<T[]> {
  return rowsOf<T>(await getDb().execute(query))
}

export async function countRows(table: string): Promise<number> {
  const rows = await queryRows<{ total: number | string }>(
    sql.raw(`SELECT COUNT(*) AS total FROM \`${table}\``),
  )
  return Number(rows[0]?.total ?? 0)
}

/** Creates a valid receiving session payload (ready to send to syncPush). */
export function makeSessionPayload(overrides: Partial<Record<string, unknown>> = {}) {
  const base = {
    sessionId: '11111111-2222-4333-8444-555555555555',
    deviceId: 'device-test-1',
    userId: FIXTURE.user.ACTIVE,
    purchaseId: FIXTURE.purchase.CHECKED,
    vendorId: FIXTURE.vendor.V1,
    locationId: FIXTURE.location.L1,
    companyId: '0',
    receiveDate: '2025-10-25 17:00:00',
    dueDate: null,
    invoiceNumber: 'INV-001',
    doNumber: 'DO-001',
    finalizedAt: '2025-10-25T17:05:00.000Z',
    items: [
      {
        clientLineId: 'line-1',
        purchaseItemId: FIXTURE.purchaseItem.PI1,
        itemMasterId: FIXTURE.item.I1,
        qty: 6,
        uomPurchaseId: FIXTURE.uom.KARTON,
        uomId: FIXTURE.uom.PCS,
        convQty: 12,
        convFound: true,
      },
    ],
  }
  return { ...base, ...overrides }
}
