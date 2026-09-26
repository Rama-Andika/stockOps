import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '~/server/db/client'
import { invalidateCache } from '~/server/db/cache'
import { pullChunk } from '~/server/services/pull-service'
import { FIXTURE, seedAll } from './helpers'

describe('pull-service (FR-2.1, FR-2.3, BR-13, NF-4)', () => {
  beforeEach(async () => {
    await seedAll()
  })

  afterAll(async () => {
    await closeDb()
  })

  describe('purchases', () => {
    it('hanya menarik PO berstatus CHECKED (BR-1)', async () => {
      const result = await pullChunk('purchases', 0, 100)
      expect(result.total).toBe(2)
      expect(result.rows.every((row) => row.status === 'CHECKED')).toBe(true)
      expect(result.rows.map((row) => row.purchaseId)).not.toContain(FIXTURE.purchase.DRAFT)
    })

    it('menyertakan nama vendor hasil join', async () => {
      const result = await pullChunk('purchases', 0, 100)
      const row = result.rows.find((r) => r.purchaseId === FIXTURE.purchase.CHECKED)
      expect(row?.vendorName).toBe('BALI LESTARI KOSMETIK')
      expect(row?.number).toBe('PO10250001')
    })

    it('BR-13: menarik PO dari SEMUA lokasi (tanpa filter lokasi)', async () => {
      const result = await pullChunk('purchases', 0, 100)
      expect(result.rows.map((row) => row.purchaseId)).toContain(FIXTURE.purchase.CHECKED_OTHER_LOC)
      expect(result.rows.map((row) => row.locationId)).toContain(FIXTURE.location.L2)
    })

    it('pagination bertahap (chunking) berjalan benar', async () => {
      const first = await pullChunk('purchases', 0, 1)
      expect(first.rows).toHaveLength(1)
      expect(first.nextOffset).toBe(1)
      expect(first.total).toBe(2)

      const second = await pullChunk('purchases', 1, 1)
      expect(second.rows).toHaveLength(1)
      expect(second.nextOffset).toBeNull()

      const beyond = await pullChunk('purchases', 2, 1)
      expect(beyond.rows).toHaveLength(0)
      expect(beyond.nextOffset).toBeNull()
    })
  })

  describe('purchaseItems', () => {
    it('hanya item milik PO CHECKED', async () => {
      const result = await pullChunk('purchaseItems', 0, 100)
      const ids = result.rows.map((row) => row.purchaseItemId)
      expect(ids).toContain(FIXTURE.purchaseItem.PI1)
      expect(ids).not.toContain(FIXTURE.purchaseItem.PI_DRAFT)
    })

    it('receivedQty = 0 bila belum ada penerimaan', async () => {
      const result = await pullChunk('purchaseItems', 0, 100)
      const row = result.rows.find((r) => r.purchaseItemId === FIXTURE.purchaseItem.PI1)
      expect(Number(row?.receivedQty)).toBe(0)
    })

    it('receivedQty mencerminkan total lintas dokumen (FR-5.4)', async () => {
      await getDb().execute(sql`
        INSERT INTO pos_receive
          (receive_id, status, number, counter, prefix_number, purchase_id, vendor_id, location_id, user_id)
        VALUES
          (1441151880758558720, 'DRAFT', 'IN10250099', 99, 'IN1025', ${FIXTURE.purchase.CHECKED}, ${FIXTURE.vendor.V1}, ${FIXTURE.location.L1}, ${FIXTURE.user.ACTIVE})
      `)
      await getDb().execute(sql`
        INSERT INTO pos_receive_item
          (receive_item_id, receive_id, purchase_item_id, item_master_id, qty, uom_id, uom_purchase_id, qty_purchase, conv_unit)
        VALUES
          (1441151880758558721, 1441151880758558720, ${FIXTURE.purchaseItem.PI1}, ${FIXTURE.item.I1}, 4, ${FIXTURE.uom.PCS}, ${FIXTURE.uom.KARTON}, 48, 12),
          (1441151880758558722, 1441151880758558720, ${FIXTURE.purchaseItem.PI1}, ${FIXTURE.item.I1}, 1.5, ${FIXTURE.uom.PCS}, ${FIXTURE.uom.KARTON}, 18, 12)
      `)
      invalidateCache()

      const result = await pullChunk('purchaseItems', 0, 100)
      const row = result.rows.find((r) => r.purchaseItemId === FIXTURE.purchaseItem.PI1)
      expect(Number(row?.receivedQty)).toBe(5.5)
    })
  })

  describe('data master lain', () => {
    it('items hanya yang is_active = 1 (FR-2.1)', async () => {
      const result = await pullChunk('items', 0, 100)
      expect(result.total).toBe(2)
      expect(result.rows.map((row) => row.itemMasterId)).not.toContain(FIXTURE.item.I3_INACTIVE)
    })

    it('items menyertakan barcode & satuan', async () => {
      const result = await pullChunk('items', 0, 100)
      const row = result.rows.find((r) => r.itemMasterId === FIXTURE.item.I1)
      expect(row?.barcode).toBe('22001771')
      expect(row?.barcode2).toBe('899123')
      expect(row?.uomStockId).toBe(FIXTURE.uom.PCS)
    })

    it('units', async () => {
      const result = await pullChunk('units', 0, 100)
      expect(result.total).toBe(3)
      expect(result.rows.map((row) => row.unit)).toEqual(['PCS', 'KARTON', 'PACK'])
    })

    it('vendors', async () => {
      const result = await pullChunk('vendors', 0, 100)
      expect(result.total).toBe(1)
      expect(result.rows[0]?.name).toBe('BALI LESTARI KOSMETIK')
      expect(String(result.rows[0]?.dueDate)).toBe('30')
    })

    it('vendorItems untuk konversi satuan (BR-7)', async () => {
      const result = await pullChunk('vendorItems', 0, 100)
      expect(result.total).toBe(2)
      const row = result.rows.find((r) => r.itemMasterId === FIXTURE.item.I1)
      expect(Number(row?.convQty)).toBe(12)
      expect(row?.uomPurchase).toBe(FIXTURE.uom.KARTON)
    })

    it('jenis pull yang tidak dikenal ditolak', async () => {
      await expect(pullChunk('tidak-ada' as never, 0, 10)).rejects.toThrow()
    })
  })
})
