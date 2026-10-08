import { sql } from 'drizzle-orm'
import { getDb, type Database } from '~/server/db/client'
import { memoize } from '~/server/db/cache'
import { rowsOf } from '~/server/db/rows'
import { PULLABLE_PURCHASE_STATUS } from '~/core/contracts/constants'
import type { PullCell, PullKind, PullResult } from '~/core/contracts/schemas'

const RECEIVED_AGGREGATE_CACHE_KEY = 'receivedAggregate'
const RECEIVED_AGGREGATE_TTL_MS = 10_000

type Row = Record<string, unknown>

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function nullableStr(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

/**
 * Qty already received per PO item, summed over ALL documents and devices — the figure the
 * device needs to show real progress and to warn about over-receive before a push.
 *
 * Cached for a few seconds because one chunked pull asks for it on every chunk; the cost is
 * that a PO list may be a moment behind a colleague's just-synced delivery.
 */
export async function getReceivedAggregate(db: Database = getDb()): Promise<Map<string, string>> {
  return memoize(RECEIVED_AGGREGATE_CACHE_KEY, RECEIVED_AGGREGATE_TTL_MS, async () => {
    const rows = rowsOf<Row>(
      await db.execute(sql`
        SELECT purchase_item_id, SUM(qty) AS received_qty
        FROM pos_receive_item
        WHERE purchase_item_id <> 0
        GROUP BY purchase_item_id
      `),
    )
    const map = new Map<string, string>()
    for (const row of rows) {
      map.set(str(row.purchase_item_id), str(row.received_qty ?? '0'))
    }
    return map
  })
}

async function count(db: Database, query: ReturnType<typeof sql>): Promise<number> {
  const rows = rowsOf<Row>(await db.execute(query))
  return Number(rows[0]?.total ?? 0)
}

interface Chunk {
  rows: Row[]
  total: number
}

async function loadPurchases(db: Database, offset: number, limit: number): Promise<Chunk> {
  const rows = rowsOf<Row>(
    await db.execute(sql`
      SELECT p.purchase_id, p.number, p.status, p.vendor_id,
             COALESCE(v.name, '') AS vendor_name,
             p.location_id, p.user_id, p.company_id, p.purch_date, p.total_amount
      FROM pos_purchase p
      LEFT JOIN vendor v ON v.vendor_id = p.vendor_id
      WHERE p.status = ${PULLABLE_PURCHASE_STATUS}
      ORDER BY p.purchase_id
      LIMIT ${limit} OFFSET ${offset}
    `),
  )
  const total = await count(
    db,
    sql`SELECT COUNT(*) AS total FROM pos_purchase WHERE status = ${PULLABLE_PURCHASE_STATUS}`,
  )
  return { rows, total }
}

async function loadPurchaseItems(db: Database, offset: number, limit: number): Promise<Chunk> {
  const received = await getReceivedAggregate(db)
  const rows = rowsOf<Row>(
    await db.execute(sql`
      SELECT pi.purchase_item_id, pi.purchase_id, pi.item_master_id, pi.qty, pi.uom_id
      FROM pos_purchase_item pi
      JOIN pos_purchase p ON p.purchase_id = pi.purchase_id
      WHERE p.status = ${PULLABLE_PURCHASE_STATUS}
      ORDER BY pi.purchase_item_id
      LIMIT ${limit} OFFSET ${offset}
    `),
  )
  const total = await count(
    db,
    sql`
      SELECT COUNT(*) AS total
      FROM pos_purchase_item pi
      JOIN pos_purchase p ON p.purchase_id = pi.purchase_id
      WHERE p.status = ${PULLABLE_PURCHASE_STATUS}
    `,
  )
  // receivedQty is retrieved from aggregate cache (not per row) to keep it fast.
  for (const row of rows) {
    row.received_qty = received.get(str(row.purchase_item_id)) ?? '0.00'
  }
  return { rows, total }
}

async function loadItems(db: Database, offset: number, limit: number): Promise<Chunk> {
  const rows = rowsOf<Row>(
    await db.execute(sql`
      SELECT item_master_id, code, barcode, barcode_2, barcode_3, name,
             uom_stock_id, uom_purchase_id
      FROM pos_item_master
      WHERE is_active = 1
      ORDER BY item_master_id
      LIMIT ${limit} OFFSET ${offset}
    `),
  )
  const total = await count(
    db,
    sql`SELECT COUNT(*) AS total FROM pos_item_master WHERE is_active = 1`,
  )
  return { rows, total }
}

async function loadUnits(db: Database, offset: number, limit: number): Promise<Chunk> {
  const rows = rowsOf<Row>(
    await db.execute(sql`
      SELECT uom_id, unit FROM pos_unit ORDER BY uom_id LIMIT ${limit} OFFSET ${offset}
    `),
  )
  const total = await count(db, sql`SELECT COUNT(*) AS total FROM pos_unit`)
  return { rows, total }
}

async function loadVendors(db: Database, offset: number, limit: number): Promise<Chunk> {
  const rows = rowsOf<Row>(
    await db.execute(sql`
      SELECT vendor_id, code, name, due_date
      FROM vendor
      ORDER BY vendor_id
      LIMIT ${limit} OFFSET ${offset}
    `),
  )
  const total = await count(db, sql`SELECT COUNT(*) AS total FROM vendor`)
  return { rows, total }
}

async function loadVendorItems(db: Database, offset: number, limit: number): Promise<Chunk> {
  const rows = rowsOf<Row>(
    await db.execute(sql`
      SELECT vendor_item_id, vendor_id, item_master_id, uom_purchase, conv_qty
      FROM pos_vendor_item
      ORDER BY vendor_item_id
      LIMIT ${limit} OFFSET ${offset}
    `),
  )
  const total = await count(db, sql`SELECT COUNT(*) AS total FROM pos_vendor_item`)
  return { rows, total }
}

function mapRow(kind: PullKind, row: Row): Record<string, PullCell> {
  switch (kind) {
    case 'purchases':
      return {
        purchaseId: str(row.purchase_id),
        number: nullableStr(row.number),
        status: nullableStr(row.status),
        vendorId: str(row.vendor_id),
        vendorName: str(row.vendor_name),
        locationId: str(row.location_id),
        userId: str(row.user_id),
        companyId: str(row.company_id),
        purchDate: nullableStr(row.purch_date),
        totalAmount: str(row.total_amount ?? '0.00'),
      }
    case 'purchaseItems':
      return {
        purchaseItemId: str(row.purchase_item_id),
        purchaseId: str(row.purchase_id),
        itemMasterId: str(row.item_master_id),
        qty: str(row.qty ?? '0'),
        uomId: str(row.uom_id),
        receivedQty: str(row.received_qty ?? '0'),
      }
    case 'items':
      return {
        itemMasterId: str(row.item_master_id),
        code: nullableStr(row.code),
        barcode: nullableStr(row.barcode),
        barcode2: nullableStr(row.barcode_2),
        barcode3: nullableStr(row.barcode_3),
        name: str(row.name),
        uomStockId: str(row.uom_stock_id),
        uomPurchaseId: str(row.uom_purchase_id),
      }
    case 'units':
      return { uomId: str(row.uom_id), unit: str(row.unit) }
    case 'vendors':
      return {
        vendorId: str(row.vendor_id),
        code: nullableStr(row.code),
        name: str(row.name),
        dueDate: row.due_date === null || row.due_date === undefined ? null : str(row.due_date),
      }
    case 'vendorItems':
      return {
        vendorItemId: str(row.vendor_item_id),
        vendorId: str(row.vendor_id),
        itemMasterId: str(row.item_master_id),
        uomPurchase: str(row.uom_purchase),
        convQty: str(row.conv_qty ?? '0'),
      }
    default:
      return row as Record<string, PullCell>
  }
}

const LOADERS: Record<PullKind, (db: Database, offset: number, limit: number) => Promise<Chunk>> = {
  purchases: loadPurchases,
  purchaseItems: loadPurchaseItems,
  items: loadItems,
  units: loadUnits,
  vendors: loadVendors,
  vendorItems: loadVendorItems,
}

/**
 * One chunk of a download, for master data as well as for receivable POs. Chunked because a
 * first pull covers around 50k master items, far more than one response can carry over a
 * warehouse connection.
 *
 * Only CHECKED POs are sent, and with no filter by warehouse location — a device therefore
 * holds POs it will never receive. That is a known gap, not a bug to patch here.
 */
export async function pullChunk(
  kind: PullKind,
  offset: number,
  limit: number,
  db: Database = getDb(),
): Promise<PullResult> {
  const loader = LOADERS[kind]
  if (!loader) throw new Error(`Jenis pull tidak dikenal: ${kind}`)
  const { rows, total } = await loader(db, offset, limit)
  const mapped = rows.map((row) => mapRow(kind, row))
  const nextOffset = offset + mapped.length
  return {
    kind,
    offset,
    nextOffset: mapped.length === 0 || nextOffset >= total ? null : nextOffset,
    total,
    rows: mapped,
    pulledAt: new Date().toISOString(),
  }
}
