import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '~/server/db/client'
import { syncPush, overReceiveWorklist } from '~/server/services/sync-service'
import { pullChunk } from '~/server/services/pull-service'
import { computeFingerprint } from '~/server/auth/credentials'
import { minIdForApp, maxIdForApp, type IdGenerator } from '~/shared/ids'
import type { PushInput, ReceiveSessionInput } from '~/shared/schemas'
import {
  CREDENTIALS,
  FIXTURE,
  countRows,
  makeSessionPayload,
  queryRows,
  seedAll,
} from './helpers'

const NOW = () => new Date('2025-10-26T00:00:00')

function session(overrides: Record<string, unknown> = {}): ReceiveSessionInput {
  return makeSessionPayload(overrides) as unknown as ReceiveSessionInput
}

function pushInput(sessions: ReceiveSessionInput[], credentials: PushInput['credentials'] = []): PushInput {
  return { deviceId: 'device-test-1', sessions, credentials }
}

describe('sync-service (FR-5.x, F6, BR-8/BR-17)', () => {
  beforeEach(async () => {
    await seedAll()
  })

  afterAll(async () => {
    await closeDb()
  })

  describe('alur sukses', () => {
    it('menyimpan header + item dalam satu transaksi sebagai DRAFT', async () => {
      const result = await syncPush(pushInput([session()]), { now: NOW })
      expect(result.results).toHaveLength(1)
      const res = result.results[0]!
      expect(res.status).toBe('SYNCED')
      expect(res.code).toBe('OK')
      expect(res.number).toBe('IN10250001')
      expect(res.overReceive).toBe(false)

      const headers = await queryRows<Record<string, string>>(sql`SELECT * FROM pos_receive`)
      expect(headers).toHaveLength(1)
      const header = headers[0]!
      expect(header.status).toBe('DRAFT')
      expect(header.number).toBe('IN10250001')
      expect(header.prefix_number).toBe('IN1025')
      expect(Number(header.counter)).toBe(1)
      expect(header.purchase_id).toBe(FIXTURE.purchase.CHECKED)
      expect(header.invoice_number).toBe('INV-001')
      expect(header.do_number).toBe('DO-001')
      expect(Number(header.approval_1)).toBe(0)
      expect(Number(header.approval_2)).toBe(0)
      expect(Number(header.approval_3)).toBe(0)
      expect(Number(header.include_tax)).toBe(1)
      expect(Number(header.tax_percent)).toBe(11)
      expect(Number(header.discount_percent)).toBe(0)
      expect(Number(header.discount_total)).toBe(0)
      expect(Number(header.total_amount)).toBe(576357.61)
      expect(Number(header.total_tax)).toBe(63399.34)
      expect(header.payment_type).toBe('Cash')
      expect(header.currency_id).toBe(FIXTURE.currency.IDR)
      expect(Number(header.price_include_tax)).toBe(0)
      expect(Number(header.type)).toBe(1)
      expect(header.company_id).toBeNull()
      expect(String(header.note)).toContain('PDT|SESS=11111111-2222-4333-8444-555555555555')

      const items = await queryRows<Record<string, string>>(sql`SELECT * FROM pos_receive_item`)
      expect(items).toHaveLength(1)
      const item = items[0]!
      expect(Number(item.qty)).toBe(6)
      expect(Number(item.qty_purchase)).toBe(12) // conv_qty (BR-7), bukan qty x conv
      expect(Number(item.conv_unit)).toBe(1)
      expect(item.uom_purchase_id).toBe(FIXTURE.uom.KARTON)
      expect(item.uom_id).toBe(FIXTURE.uom.PCS)
      expect(item.memo).toBeNull()
      expect(Number(item.amount)).toBe(100000)
      expect(Number(item.discount_amount)).toBe(23642.39)
      expect(Number(item.total_amount)).toBe(576357.61)
      expect(String(item.delivery_date)).toContain('2025-10-25')
      expect(String(item.expired_date)).toBe('2025-10-25')
      expect(Number(item.ap_coa_id)).toBe(0)
      expect(Number(item.type)).toBe(0)
      expect(Number(item.company_id)).toBe(0)
      expect(Number(item.is_bonus)).toBe(0)
      expect(Number(item.price_import)).toBe(0)
      expect(Number(item.transport)).toBe(0)
      expect(Number(item.bea)).toBe(0)
      expect(Number(item.komisi)).toBe(0)
      expect(Number(item.lain_lain)).toBe(0)
      expect(Number(item.segment1_id)).toBe(0)
      expect(Number(item.dis_1_percent)).toBe(0)
      expect(Number(item.dis_1_val)).toBe(0)
      expect(Number(item.dis_4_percent)).toBe(0)
      expect(Number(item.dis_4_val)).toBe(0)
      expect(Number(item.expired_check_status)).toBe(0)
      expect(Number(item.expired_check_id)).toBe(0)
      expect(item.status).toBeNull()

      // Riwayat dokumen (document_history) dibuat tepat satu baris.
      const history = await queryRows<Record<string, string>>(sql`SELECT * FROM document_history`)
      expect(history).toHaveLength(1)
      const hist = history[0]!
      expect(Number(hist.type)).toBe(2)
      expect(hist.user_id).toBe(FIXTURE.user.ACTIVE)
      expect(Number(hist.employee_id)).toBe(0)
      expect(hist.ref_id).toBe(header.receive_id)
      expect(String(hist.description)).toBe(
        'New incoming document IN10250001 created from PDT device device-test-1.',
      )
      expect(hist.date).toBeTruthy()
      const histId = BigInt(hist.document_history_id!)
      expect(histId).toBeGreaterThanOrEqual(minIdForApp(2))
      expect(histId).toBeLessThanOrEqual(maxIdForApp(2))
    })

    it('membuat receiveId di namespace appIdx PDT (BR-17) dan mengangkutnya sebagai string (BR-12)', async () => {
      const result = await syncPush(pushInput([session()]), { now: NOW })
      const receiveId = result.results[0]!.receiveId!
      expect(typeof receiveId).toBe('string')
      const id = BigInt(receiveId)
      expect(id).toBeGreaterThanOrEqual(minIdForApp(2))
      expect(id).toBeLessThanOrEqual(maxIdForApp(2))
      // Jelas berbeda dari namespace admin (appIdx 1).
      expect(id).toBeGreaterThan(maxIdForApp(1))
    })

    it('mengisi jatuh tempo dari termin vendor (vendor.due_date = 30 hari)', async () => {
      await syncPush(pushInput([session()]), { now: NOW })
      const headers = await queryRows<Record<string, string>>(sql`SELECT due_date, date FROM pos_receive`)
      expect(String(headers[0]?.due_date)).toContain('2025-11-24')
      expect(String(headers[0]?.date)).toContain('2025-10-25')
    })

    it('menyimpan qty_purchase = conv_qty dan conv_unit = 1 dari data vendor-item', async () => {
      await syncPush(
        pushInput([
          session({
            items: [
              {
                clientLineId: 'l1',
                purchaseItemId: FIXTURE.purchaseItem.PI2,
                itemMasterId: FIXTURE.item.I2,
                qty: 2,
                uomPurchaseId: FIXTURE.uom.PACK,
                uomId: FIXTURE.uom.PCS,
                convQty: 6,
                convFound: true,
              },
            ],
          }),
        ]),
        { now: NOW },
      )
      const items = await queryRows<Record<string, string>>(sql`SELECT * FROM pos_receive_item`)
      expect(Number(items[0]?.qty_purchase)).toBe(6) // conv_qty, bukan 2 x 6
      expect(Number(items[0]?.conv_unit)).toBe(1)
    })
  })

  describe('finansial dokumen (pos_receive & pos_receive_item)', () => {
    it('menghitung total_amount, discount_total, dan total_tax (price_include_tax = 1)', async () => {
      await getDb().execute(sql`
        UPDATE pos_purchase SET tax_percent = 25.00, price_include_tax = 1, discount_percent = 10.00
        WHERE purchase_id = ${FIXTURE.purchase.CHECKED}
      `)
      await getDb().execute(sql`
        UPDATE pos_purchase_item SET amount = 1000.00, discount_amount = 0.00
        WHERE purchase_item_id = ${FIXTURE.purchaseItem.PI1}
      `)
      await syncPush(
        pushInput([
          session({
            items: [
              {
                clientLineId: 'l1',
                purchaseItemId: FIXTURE.purchaseItem.PI1,
                itemMasterId: FIXTURE.item.I1,
                qty: 5,
                uomPurchaseId: FIXTURE.uom.KARTON,
                uomId: FIXTURE.uom.PCS,
                convQty: 12,
                convFound: true,
              },
            ],
          }),
        ]),
        { now: NOW },
      )

      const headers = await queryRows<Record<string, string>>(sql`SELECT * FROM pos_receive`)
      const header = headers[0]!
      expect(Number(header.total_amount)).toBe(5000)
      expect(Number(header.discount_total)).toBe(500)
      expect(Number(header.total_tax)).toBe(900)

      const items = await queryRows<Record<string, string>>(sql`SELECT * FROM pos_receive_item`)
      expect(Number(items[0]?.amount)).toBe(1000)
      expect(Number(items[0]?.discount_amount)).toBe(0)
      expect(Number(items[0]?.total_amount)).toBe(5000)
    })
  })

  describe('penolakan PO & riwayat dokumen (document_history)', () => {
    it('menolak PO berstatus CLOSED dan tidak menulis data apa pun', async () => {
      await getDb().execute(sql`
        UPDATE pos_purchase SET status = 'CLOSED' WHERE purchase_id = ${FIXTURE.purchase.CHECKED}
      `)
      const result = await syncPush(pushInput([session()]), { now: NOW })
      expect(result.results[0]?.status).toBe('FAILED')
      expect(result.results[0]?.code).toBe('PURCHASE_NOT_CHECKED')
      expect(await countRows('pos_receive')).toBe(0)
      expect(await countRows('pos_receive_item')).toBe(0)
      expect(await countRows('document_history')).toBe(0)
    })

    it('sukses bila PO dibuka kembali (CHECKED) setelah sempat CLOSED', async () => {
      await getDb().execute(sql`
        UPDATE pos_purchase SET status = 'CLOSED' WHERE purchase_id = ${FIXTURE.purchase.CHECKED}
      `)
      const first = await syncPush(pushInput([session()]), { now: NOW })
      expect(first.results[0]?.code).toBe('PURCHASE_NOT_CHECKED')

      await getDb().execute(sql`
        UPDATE pos_purchase SET status = 'CHECKED' WHERE purchase_id = ${FIXTURE.purchase.CHECKED}
      `)
      const second = await syncPush(pushInput([session()]), { now: NOW })
      expect(second.results[0]?.status).toBe('SYNCED')
      expect(await countRows('pos_receive')).toBe(1)
      expect(await countRows('document_history')).toBe(1)
    })
  })

  describe('idempotensi (FR-5.3, Skenario C)', () => {
    it('mengirim ulang sesi yang sama tidak menghasilkan dokumen ganda', async () => {
      const first = await syncPush(pushInput([session()]), { now: NOW })
      const second = await syncPush(pushInput([session()]), { now: NOW })

      expect(first.results[0]?.code).toBe('OK')
      expect(second.results[0]?.code).toBe('IDEMPOTENT_REPLAY')
      expect(second.results[0]?.receiveId).toBe(first.results[0]?.receiveId)
      expect(second.results[0]?.number).toBe(first.results[0]?.number)

      expect(await countRows('pos_receive')).toBe(1)
      expect(await countRows('pos_receive_item')).toBe(1)
      expect(await countRows('document_history')).toBe(1)
    })

    it('tidak menambah slot nomor dokumen saat replay', async () => {
      await syncPush(pushInput([session()]), { now: NOW })
      await syncPush(pushInput([session()]), { now: NOW })
      await syncPush(pushInput([session({ sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })]), {
        now: NOW,
      })
      const headers = await queryRows<Record<string, string>>(
        sql`SELECT number FROM pos_receive ORDER BY number`,
      )
      expect(headers.map((row) => row.number)).toEqual(['IN10250001', 'IN10250002'])
    })
  })

  describe('over-receive lintas device (Skenario B)', () => {
    it('menandai item yang melebihi pesanan dan tetap menyimpan sebagai DRAFT', async () => {
      // Device 1 menerima 6 dari 10.
      await syncPush(pushInput([session()]), { now: NOW })
      // Device 2 (sesi berbeda) menerima 5 -> total 11 > 10.
      const device2 = session({
        sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        deviceId: 'device-test-2',
        items: [
          {
            clientLineId: 'line-1',
            purchaseItemId: FIXTURE.purchaseItem.PI1,
            itemMasterId: FIXTURE.item.I1,
            qty: 5,
            uomPurchaseId: FIXTURE.uom.KARTON,
            uomId: FIXTURE.uom.PCS,
            convQty: 12,
            convFound: true,
          },
        ],
      })
      const result = await syncPush(pushInput([device2]), { now: NOW })
      const res = result.results[0]!

      expect(res.status).toBe('SYNCED')
      expect(res.overReceive).toBe(true)
      expect(res.excessTotal).toBe(1)
      expect(res.lines[0]?.previousQty).toBe(6)
      expect(res.lines[0]?.newTotal).toBe(11)
      expect(res.lines[0]?.excess).toBe(1)
      expect(res.message).toContain('menunggu persetujuan admin')

      // Dokumen tetap DRAFT (BR-5), bukan ditolak.
      const headers = await queryRows<Record<string, string>>(
        sql`SELECT status, note FROM pos_receive ORDER BY receive_id`,
      )
      expect(headers).toHaveLength(2)
      expect(headers.every((row) => row.status === 'DRAFT')).toBe(true)

      // Item over-receive ditandai lewat kolom memo (FR-6.2).
      const overItems = await queryRows<Record<string, string>>(
        sql`SELECT * FROM pos_receive_item WHERE memo IS NOT NULL`,
      )
      expect(overItems).toHaveLength(1)
      expect(String(overItems[0]?.memo)).toMatch(/^PDT\|OVER;ORD=10;TOT=11;EXC=1$/)
    })

    it('menandai hanya baris yang over, baris lain tetap normal', async () => {
      const mixed = session({
        items: [
          {
            clientLineId: 'l1',
            purchaseItemId: FIXTURE.purchaseItem.PI1, // dipesan 10
            itemMasterId: FIXTURE.item.I1,
            qty: 12,
            uomPurchaseId: FIXTURE.uom.KARTON,
            uomId: FIXTURE.uom.PCS,
            convQty: 12,
            convFound: true,
          },
          {
            clientLineId: 'l2',
            purchaseItemId: FIXTURE.purchaseItem.PI2, // dipesan 5
            itemMasterId: FIXTURE.item.I2,
            qty: 1,
            uomPurchaseId: FIXTURE.uom.PACK,
            uomId: FIXTURE.uom.PCS,
            convQty: 6,
            convFound: true,
          },
        ],
      })
      const result = await syncPush(pushInput([mixed]), { now: NOW })
      const lines = result.results[0]!.lines
      expect(lines[0]?.overReceive).toBe(true)
      expect(lines[1]?.overReceive).toBe(false)

      const items = await queryRows<Record<string, string>>(
        sql`SELECT purchase_item_id, memo FROM pos_receive_item ORDER BY purchase_item_id`,
      )
      const byItem = new Map(items.map((row) => [row.purchase_item_id, row.memo]))
      expect(byItem.get(FIXTURE.purchaseItem.PI1)).toBeTruthy()
      expect(byItem.get(FIXTURE.purchaseItem.PI2)).toBeNull()
    })

    it('menampilkan item over-receive di worklist admin (FR-6.4)', async () => {
      await syncPush(pushInput([session()]), { now: NOW })
      await syncPush(
        pushInput([
          session({
            sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            items: [
              {
                clientLineId: 'line-1',
                purchaseItemId: FIXTURE.purchaseItem.PI1,
                itemMasterId: FIXTURE.item.I1,
                qty: 5,
                uomPurchaseId: FIXTURE.uom.KARTON,
                uomId: FIXTURE.uom.PCS,
                convQty: 12,
                convFound: true,
              },
            ],
          }),
        ]),
        { now: NOW },
      )
      const worklist = await overReceiveWorklist()
      expect(worklist).toHaveLength(1)
      expect(worklist[0]?.excess).toBe(1)
      expect(worklist[0]?.orderedQty).toBe(10)
      expect(worklist[0]?.newTotal).toBe(11)
      expect(worklist[0]?.itemName).toBe('SISIR ANAK SAILIYA')
    })

    it('receivedQty pada pull ikut bertambah setelah sinkronisasi (FR-5.4)', async () => {
      await syncPush(pushInput([session()]), { now: NOW })
      const pulled = await pullChunk('purchaseItems', 0, 100)
      const row = pulled.rows.find((r) => r.purchaseItemId === FIXTURE.purchaseItem.PI1)
      expect(Number(row?.receivedQty)).toBe(6)
    })
  })

  describe('nomor dokumen (BR-8)', () => {
    it('menaikkan counter per bulan', async () => {
      await syncPush(pushInput([session()]), { now: NOW })
      await syncPush(pushInput([session({ sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1' })]), {
        now: NOW,
      })
      const numbers = await queryRows<Record<string, string>>(
        sql`SELECT number, counter FROM pos_receive ORDER BY counter`,
      )
      expect(numbers.map((row) => row.number)).toEqual(['IN10250001', 'IN10250002'])
      expect(numbers.map((row) => Number(row.counter))).toEqual([1, 2])
    })

    it('memakai prefix bulan sesuai tanggal penerimaan', async () => {
      await syncPush(pushInput([session({ receiveDate: '2025-11-05 08:00:00' })]), {
        now: () => new Date('2025-11-06T00:00:00'),
      })
      const headers = await queryRows<Record<string, string>>(sql`SELECT number, prefix_number FROM pos_receive`)
      expect(headers[0]?.prefix_number).toBe('IN1125')
      expect(headers[0]?.number).toBe('IN11250001')
    })
  })

  describe('validasi', () => {
    it('menolak PO yang tidak berstatus CHECKED (BR-1)', async () => {
      const result = await syncPush(
        pushInput([
          session({
            purchaseId: FIXTURE.purchase.DRAFT,
            items: [
              {
                clientLineId: 'l1',
                purchaseItemId: FIXTURE.purchaseItem.PI_DRAFT,
                itemMasterId: FIXTURE.item.I1,
                qty: 1,
                uomPurchaseId: FIXTURE.uom.KARTON,
                uomId: FIXTURE.uom.PCS,
                convQty: 12,
                convFound: true,
              },
            ],
          }),
        ]),
        { now: NOW },
      )
      expect(result.results[0]?.status).toBe('FAILED')
      expect(result.results[0]?.code).toBe('PURCHASE_NOT_CHECKED')
      expect(await countRows('pos_receive')).toBe(0)
      expect(await countRows('document_history')).toBe(0)
    })

    it('menolak PO yang tidak ditemukan', async () => {
      const result = await syncPush(pushInput([session({ purchaseId: '999999999' })]), { now: NOW })
      expect(result.results[0]?.code).toBe('PURCHASE_NOT_FOUND')
      expect(await countRows('pos_receive')).toBe(0)
    })

    it('menolak barang di luar PO (BR-14)', async () => {
      const result = await syncPush(
        pushInput([
          session({
            purchaseId: FIXTURE.purchase.CHECKED_OTHER_LOC,
            items: [
              {
                clientLineId: 'l1',
                purchaseItemId: FIXTURE.purchaseItem.PI1, // milik PO lain
                itemMasterId: FIXTURE.item.I1,
                qty: 1,
                uomPurchaseId: FIXTURE.uom.KARTON,
                uomId: FIXTURE.uom.PCS,
                convQty: 12,
                convFound: true,
              },
            ],
          }),
        ]),
        { now: NOW },
      )
      expect(result.results[0]?.code).toBe('VALIDATION')
      expect(await countRows('pos_receive')).toBe(0)
    })

    it('menolak barang yang item master-nya tidak cocok dengan item PO', async () => {
      const result = await syncPush(
        pushInput([
          session({
            items: [
              {
                clientLineId: 'l1',
                purchaseItemId: FIXTURE.purchaseItem.PI1,
                itemMasterId: FIXTURE.item.I2, // tidak cocok
                qty: 1,
                uomPurchaseId: FIXTURE.uom.KARTON,
                uomId: FIXTURE.uom.PCS,
                convQty: 12,
                convFound: true,
              },
            ],
          }),
        ]),
        { now: NOW },
      )
      expect(result.results[0]?.code).toBe('VALIDATION')
    })
  })

  describe('transaksi utuh (FR-5.7)', () => {
    it('membatalkan SELURUH dokumen bila satu item gagal disimpan', async () => {
      // Generator ID item yang selalu sama -> INSERT item kedua melanggar PK.
      class ConstantIdGen {
        constructor(private readonly id: bigint) {}
        next(): bigint {
          return this.id
        }
      }
      const failing = session({
        items: [
          {
            clientLineId: 'l1',
            purchaseItemId: FIXTURE.purchaseItem.PI1,
            itemMasterId: FIXTURE.item.I1,
            qty: 1,
            uomPurchaseId: FIXTURE.uom.KARTON,
            uomId: FIXTURE.uom.PCS,
            convQty: 12,
            convFound: true,
          },
          {
            clientLineId: 'l2',
            purchaseItemId: FIXTURE.purchaseItem.PI2,
            itemMasterId: FIXTURE.item.I2,
            qty: 1,
            uomPurchaseId: FIXTURE.uom.PACK,
            uomId: FIXTURE.uom.PCS,
            convQty: 6,
            convFound: true,
          },
        ],
      })

      const result = await syncPush(pushInput([failing]), {
        now: NOW,
        itemIdGen: new ConstantIdGen(minIdForApp(2)) as unknown as IdGenerator,
      })

      expect(result.results[0]?.status).toBe('FAILED')
      // Tidak ada sisa header/item (rollback penuh).
      expect(await countRows('pos_receive')).toBe(0)
      expect(await countRows('pos_receive_item')).toBe(0)
    })
  })

  describe('konversi satuan', () => {
    it('memakai faktor 1 bila data konversi tidak ditemukan (BR-7)', async () => {
      await syncPush(
        pushInput([
          session({
            items: [
              {
                clientLineId: 'l1',
                purchaseItemId: FIXTURE.purchaseItem.PI3, // item tanpa baris vendor-item
                itemMasterId: FIXTURE.item.I3_INACTIVE,
                qty: 3,
                uomPurchaseId: FIXTURE.uom.PCS,
                uomId: FIXTURE.uom.PCS,
                convQty: 1,
                convFound: false,
              },
            ],
          }),
        ]),
        { now: NOW },
      )
      const items = await queryRows<Record<string, string>>(sql`SELECT * FROM pos_receive_item`)
      expect(Number(items[0]?.conv_unit)).toBe(1)
      expect(Number(items[0]?.qty_purchase)).toBe(1) // conv_qty default = 1, bukan qty (3)
    })
  })

  describe('kredensial & urutan', () => {
    it('mengembalikan daftar kredensial yang dicabut saat sinkronisasi (BR-19)', async () => {
      const result = await syncPush(
        pushInput([session()], [
          {
            userId: FIXTURE.user.ACTIVE_2,
            loginId: CREDENTIALS.ACTIVE_2.loginId,
            fingerprint: computeFingerprint('basi'),
          },
        ]),
        { now: NOW },
      )
      expect(result.revoked).toEqual([{ userId: FIXTURE.user.ACTIVE_2, reason: 'CHANGED' }])
      // Sesi tetap tersinkron walau ada kredensial dicabut.
      expect(result.results[0]?.status).toBe('SYNCED')
    })

    it('memproses sesi berurutan FIFO sesuai input (FR-5.1)', async () => {
      const first = session({ sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1' })
      const second = session({ sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2' })
      const result = await syncPush(pushInput([first, second]), { now: NOW })
      expect(result.results.map((r) => r.sessionId)).toEqual([first.sessionId, second.sessionId])
      expect(result.results[0]?.number).toBe('IN10250001')
      expect(result.results[1]?.number).toBe('IN10250002')
    })
  })

  describe('sanitasi tanggal (jam device salah)', () => {
    it('memakai waktu server bila tanggal penerimaan di masa depan', async () => {
      const result = await syncPush(
        pushInput([session({ receiveDate: '2030-01-01 00:00:00' })]),
        { now: NOW },
      )
      expect(result.results[0]?.number).toBe('IN10250001')
      const headers = await queryRows<Record<string, string>>(sql`SELECT date FROM pos_receive`)
      expect(String(headers[0]?.date)).toContain('2025-10-26')
    })

    it('memakai waktu server bila tanggal penerimaan terlalu lampau', async () => {
      await syncPush(pushInput([session({ receiveDate: '2020-01-01 00:00:00' })]), { now: NOW })
      const headers = await queryRows<Record<string, string>>(sql`SELECT date FROM pos_receive`)
      expect(String(headers[0]?.date)).toContain('2025-10-26')
    })
  })
})
