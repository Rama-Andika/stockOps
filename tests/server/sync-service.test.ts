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

/** Valid credential of the ACTIVE user (as issued by loginOnline). */
function validCredential(): PushInput['credentials'][number] {
  return {
    userId: FIXTURE.user.ACTIVE,
    loginId: CREDENTIALS.ACTIVE.loginId,
    fingerprint: computeFingerprint(CREDENTIALS.ACTIVE.password),
  }
}

function pushInput(
  sessions: ReceiveSessionInput[],
  credentials: PushInput['credentials'] = [validCredential()],
): PushInput {
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
      expect(Number(item.qty_purchase)).toBe(12) // conv_qty (BR-7), not qty x conv
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

      // Document history (document_history) is created with exactly one row.
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
      // Clearly distinct from admin namespace (appIdx 1).
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
      expect(Number(items[0]?.qty_purchase)).toBe(6) // conv_qty, not 2 x 6
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
      // Device 1 receives 6 out of 10.
      await syncPush(pushInput([session()]), { now: NOW })
      // Device 2 (different session) receives 5 -> total 11 > 10.
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

      // Document remains DRAFT (BR-5), not rejected.
      const headers = await queryRows<Record<string, string>>(
        sql`SELECT status, note FROM pos_receive ORDER BY receive_id`,
      )
      expect(headers).toHaveLength(2)
      expect(headers.every((row) => row.status === 'DRAFT')).toBe(true)

      // Over-received item is flagged via memo column (FR-6.2).
      const overItems = await queryRows<Record<string, string>>(
        sql`SELECT * FROM pos_receive_item WHERE memo IS NOT NULL`,
      )
      expect(overItems).toHaveLength(1)
      expect(String(overItems[0]?.memo)).toMatch(/^PDT\|OVER;ORD=10;TOT=11;EXC=1$/)
    })

    it('replay sesi over-receive mengembalikan previousQty & excess yang sama dengan hasil awal', async () => {
      await syncPush(pushInput([session()]), { now: NOW })
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
      const first = await syncPush(pushInput([device2]), { now: NOW })
      const replay = await syncPush(pushInput([device2]), { now: NOW })

      expect(replay.results[0]?.code).toBe('IDEMPOTENT_REPLAY')
      expect(replay.results[0]?.lines[0]?.previousQty).toBe(6)
      expect(replay.results[0]?.lines[0]?.previousQty).toBe(first.results[0]?.lines[0]?.previousQty)
      expect(replay.results[0]?.lines[0]?.newTotal).toBe(11)
      expect(replay.results[0]?.lines[0]?.excess).toBe(1)
      expect(replay.results[0]?.excessTotal).toBe(first.results[0]?.excessTotal)
    })

    it('menandai hanya baris yang over, baris lain tetap normal', async () => {
      const mixed = session({
        items: [
          {
            clientLineId: 'l1',
            purchaseItemId: FIXTURE.purchaseItem.PI1, // ordered 10
            itemMasterId: FIXTURE.item.I1,
            qty: 12,
            uomPurchaseId: FIXTURE.uom.KARTON,
            uomId: FIXTURE.uom.PCS,
            convQty: 12,
            convFound: true,
          },
          {
            clientLineId: 'l2',
            purchaseItemId: FIXTURE.purchaseItem.PI2, // ordered 5
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
                purchaseItemId: FIXTURE.purchaseItem.PI1, // belongs to another PO
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
                itemMasterId: FIXTURE.item.I2, // does not match
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
      // Item ID generator that always returns the same ID -> second item INSERT violates PK.
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
      // No leftover header/items (full rollback).
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
                purchaseItemId: FIXTURE.purchaseItem.PI3, // item without vendor-item row
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
      expect(Number(items[0]?.qty_purchase)).toBe(1) // default conv_qty = 1, not qty (3)
    })
  })

  describe('kredensial & urutan', () => {
    it('mengembalikan daftar kredensial yang dicabut saat sinkronisasi (BR-19)', async () => {
      const result = await syncPush(
        pushInput([session()], [
          validCredential(),
          {
            userId: FIXTURE.user.ACTIVE_2,
            loginId: CREDENTIALS.ACTIVE_2.loginId,
            fingerprint: computeFingerprint('basi'),
          },
        ]),
        { now: NOW },
      )
      expect(result.revoked).toEqual([{ userId: FIXTURE.user.ACTIVE_2, reason: 'CHANGED' }])
      // Session still syncs: the device is authorized by the other, still-valid credential.
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

  describe('otorisasi perangkat & data dari PO', () => {
    it('menolak semua sesi bila tidak ada kredensial (UNAUTHORIZED)', async () => {
      const result = await syncPush(pushInput([session()], []), { now: NOW })
      expect(result.results[0]?.status).toBe('FAILED')
      expect(result.results[0]?.code).toBe('UNAUTHORIZED')
      expect(await countRows('pos_receive')).toBe(0)
    })

    it('menolak bila semua kredensial sudah dicabut', async () => {
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
      expect(result.results[0]?.code).toBe('UNAUTHORIZED')
      expect(result.revoked).toEqual([{ userId: FIXTURE.user.ACTIVE_2, reason: 'CHANGED' }])
      expect(await countRows('pos_receive')).toBe(0)
    })

    it('menjumlahkan baris ganda untuk item PO yang sama sebelum menilai over-receive', async () => {
      const line = {
        purchaseItemId: FIXTURE.purchaseItem.PI1,
        itemMasterId: FIXTURE.item.I1,
        qty: 6,
        uomPurchaseId: FIXTURE.uom.KARTON,
        uomId: FIXTURE.uom.PCS,
        convQty: 12,
        convFound: true,
      }
      const result = await syncPush(
        pushInput([
          session({
            items: [
              { ...line, clientLineId: 'dup-1' },
              { ...line, clientLineId: 'dup-2' },
            ],
          }),
        ]),
        { now: NOW },
      )
      // PI1 ordered 10: 6 + 6 = 12 -> second line over by 2.
      expect(result.results[0]?.status).toBe('SYNCED')
      expect(result.results[0]?.lines[0]?.overReceive).toBe(false)
      expect(result.results[0]?.lines[1]?.previousQty).toBe(6)
      expect(result.results[0]?.lines[1]?.overReceive).toBe(true)
      expect(result.results[0]?.excessTotal).toBe(2)

      // Only the line that crossed the ordered qty is flagged, with its own excess.
      const flagged = await queryRows<Record<string, string>>(
        sql`SELECT memo FROM pos_receive_item WHERE memo IS NOT NULL`,
      )
      expect(flagged).toHaveLength(1)
      expect(String(flagged[0]?.memo)).toBe('PDT|OVER;ORD=10;TOT=12;EXC=2')
    })

    it('excessTotal tidak ganda untuk tiga baris item yang sama (3 x 6 dari pesanan 10)', async () => {
      const line = {
        purchaseItemId: FIXTURE.purchaseItem.PI1,
        itemMasterId: FIXTURE.item.I1,
        qty: 6,
        uomPurchaseId: FIXTURE.uom.KARTON,
        uomId: FIXTURE.uom.PCS,
        convQty: 12,
        convFound: true,
      }
      const result = await syncPush(
        pushInput([
          session({
            items: [
              { ...line, clientLineId: 'tri-1' },
              { ...line, clientLineId: 'tri-2' },
              { ...line, clientLineId: 'tri-3' },
            ],
          }),
        ]),
        { now: NOW },
      )
      // Totals 6, 12, 18 against 10: real excess is 8. Summing cumulative values would give 0 + 2 + 8 = 10.
      expect(result.results[0]?.lines.map((l) => l.excess)).toEqual([0, 2, 6])
      expect(result.results[0]?.excessTotal).toBe(8)
    })

    it('mengambil location_id & company_id dari PO, bukan dari payload klien', async () => {
      const result = await syncPush(
        pushInput([session({ locationId: '999999', companyId: '888888' })]),
        { now: NOW },
      )
      expect(result.results[0]?.status).toBe('SYNCED')
      const headers = await queryRows<{ location_id: string }>(sql`SELECT location_id FROM pos_receive`)
      expect(String(headers[0]?.location_id)).toBe(FIXTURE.location.L1)
      const items = await queryRows<{ company_id: string }>(sql`SELECT company_id FROM pos_receive_item`)
      expect(String(items[0]?.company_id)).toBe('0')
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
