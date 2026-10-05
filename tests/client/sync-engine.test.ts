import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '~/server/db/client'
import { checkCredentialRevocations, loginOnline } from '~/server/services/auth-service'
import { pullChunk } from '~/server/services/pull-service'
import { syncPush } from '~/server/services/sync-service'
import { StockOpsDb, type LocalCredential } from '~/client/db/local-db'
import { computeFingerprint } from '~/server/auth/credentials'
import { LocalRepository } from '~/client/db/local-repo'
import {
  buildSessionPayload,
  pullAllData,
  refreshPurchases,
  syncOutbox,
} from '~/client/sync/engine'
import type { SyncTransport } from '~/client/sync/transport'
import { addScannedItem, resolveScan } from '~/client/services/scanning'
import { toLocalDateTime } from '~/shared/receive-date'
import { SESSION_STATUS } from '~/shared/constants'
import { CREDENTIALS, FIXTURE, seedAll } from '../server/helpers'

/** Transport that calls server services directly (without HTTP). */
const directTransport: SyncTransport = {
  login: (input) => loginOnline(input),
  checkCredentials: async (input) => ({ revoked: await checkCredentialRevocations(input.credentials) }),
  pull: (input) => pullChunk(input.kind, input.offset, input.limit),
  push: (input) => syncPush(input),
}

let db: StockOpsDb
let repo: LocalRepository
const DEVICE = 'pdt-test-1'

/** Fingerprint the server issues to the ACTIVE user at online login. */
function activeFingerprint() {
  return {
    userId: FIXTURE.user.ACTIVE,
    loginId: CREDENTIALS.ACTIVE.loginId,
    fingerprint: computeFingerprint(CREDENTIALS.ACTIVE.password),
  }
}

/** Cached credential of the ACTIVE user, as saved after a real online login. */
function activeCredential(): LocalCredential {
  return {
    ...activeFingerprint(),
    key: `${DEVICE}:${FIXTURE.user.ACTIVE}`,
    deviceId: DEVICE,
    fullName: 'A',
    companyId: '0',
    salt: 's',
    passwordHash: 'h',
    iterations: 1000,
    lastOnlineLoginAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  }
}

beforeEach(async () => {
  await seedAll()
  db = new StockOpsDb(`stockops_engine_${Math.random().toString(36).slice(2)}`)
  repo = new LocalRepository(db)
  await repo.saveCredential(activeCredential())
})

afterEach(async () => {
  await db.delete()
})

afterAll(async () => {
  await closeDb()
})

describe('sinkronisasi end-to-end (klien Dexie <-> server <-> MySQL)', () => {
  describe('pullAllData (FR-2.1, BR-16)', () => {
    it('mengisi seluruh data lokal yang dibutuhkan untuk kerja offline', async () => {
      const summary = await pullAllData(repo, directTransport, { chunkSize: 2 })
      expect(summary.counts.purchases).toBe(2)
      expect(summary.counts.items).toBe(2)
      expect(summary.counts.units).toBe(3)
      expect(summary.counts.vendors).toBe(1)
      expect(summary.counts.vendorItems).toBe(2)

      const counts = await repo.masterCounts()
      expect(counts.purchases).toBe(2)
      expect(await repo.searchPurchases('PO1025')).toHaveLength(2)
      expect((await repo.getItemByBarcodeOrCode('22001771'))?.itemMasterId).toBe(FIXTURE.item.I1)
    })

    it('chunking menangani data lebih besar dari ukuran chunk', async () => {
      const events: number[] = []
      await pullAllData(repo, directTransport, {
        chunkSize: 1,
        onProgress: (event) => events.push(event.total),
      })
      expect(events.length).toBeGreaterThan(0)
      expect(await repo.db.purchaseItems.count()).toBe(4)
    })
  })

  describe('alur offline lengkap (Skenario A)', () => {
    it('scan -> finalisasi -> sinkron -> nomor resmi tersimpan lokal', async () => {
      await pullAllData(repo, directTransport)

      // Operator selects PO & starts session (FR-3.3, FR-4.1).
      const session = await repo.createSession({
        purchaseId: FIXTURE.purchase.CHECKED,
        userId: FIXTURE.user.ACTIVE,
        deviceId: DEVICE,
        receiveDate: toLocalDateTime(new Date()),
      })

      // Scan barcode (FR-4.3/FR-4.4).
      const scan = await addScannedItem(repo, session.sessionId, session.purchaseId, '22001771', 6)
      expect(scan.ok).toBe(true)
      expect(scan.line?.convQty).toBe(12)
      expect(scan.line?.convFound).toBe(true)

      // Finalize (FR-4.7) with invoice & DO (BR-9).
      await repo.finalizeSession(session.sessionId, {
        invoiceNumber: 'INV-100',
        doNumber: 'DO-100',
        receiveDate: session.receiveDate,
      })

      // Automatic/manual synchronization (FR-5.1).
      const outcome = await syncOutbox(repo, directTransport)
      expect(outcome.synced).toBe(1)
      expect(outcome.failed).toBe(0)

      const saved = await repo.getSession(session.sessionId)
      expect(saved?.status).toBe(SESSION_STATUS.SYNCED)
      expect(saved?.number).toMatch(/^IN\d{4}0001$/)
      expect(saved?.receiveId).toBeTruthy()

      // Synced session = read-only: no longer present in outbox (FR-4.8).
      expect(await repo.outboxSessions()).toHaveLength(0)
    })

    it('mengirim ulang tidak menduplikasi (FR-5.3)', async () => {
      await pullAllData(repo, directTransport)
      const session = await repo.createSession({
        purchaseId: FIXTURE.purchase.CHECKED,
        userId: FIXTURE.user.ACTIVE,
        deviceId: DEVICE,
        receiveDate: toLocalDateTime(new Date()),
      })
      await addScannedItem(repo, session.sessionId, session.purchaseId, '22001771', 2)
      await repo.finalizeSession(session.sessionId, {
        invoiceNumber: 'INV-1',
        doNumber: 'DO-1',
        receiveDate: session.receiveDate,
      })

      const first = await syncOutbox(repo, directTransport)
      const synced = await repo.getSession(session.sessionId)
      expect(first.synced).toBe(1)

      // Resend identical payload -> server recognizes it (idempotent).
      const purchase = (await repo.getPurchase(session.purchaseId))!
      const items = await repo.sessionItems(session.sessionId)
      const payload = buildSessionPayload(synced!, items, {
        vendorId: purchase.vendorId,
        locationId: purchase.locationId,
        companyId: purchase.companyId,
      })
      const replay = await directTransport.push({
        deviceId: DEVICE,
        sessions: [payload],
        credentials: [activeFingerprint()],
      })
      expect(replay.results[0]?.code).toBe('IDEMPOTENT_REPLAY')
      expect(replay.results[0]?.receiveId).toBe(synced?.receiveId)
    })
  })

  describe('over-receive terlihat di klien (FR-6.3)', () => {
    it('menandai sesi over-receive beserta kelebihannya', async () => {
      await pullAllData(repo, directTransport)
      const session = await repo.createSession({
        purchaseId: FIXTURE.purchase.CHECKED,
        userId: FIXTURE.user.ACTIVE,
        deviceId: DEVICE,
        receiveDate: toLocalDateTime(new Date()),
      })
      // PI1 ordered 10; sent 12 -> over 2.
      await addScannedItem(repo, session.sessionId, session.purchaseId, '22001771', 12)
      await repo.finalizeSession(session.sessionId, {
        invoiceNumber: 'INV-2',
        doNumber: 'DO-2',
        receiveDate: session.receiveDate,
      })

      const outcome = await syncOutbox(repo, directTransport)
      expect(outcome.synced).toBe(1)
      const saved = await repo.getSession(session.sessionId)
      expect(saved?.overReceive).toBe(true)
      expect(saved?.excessTotal).toBe(2)
    })
  })

  describe('pencabutan kredensial saat sinkronisasi (BR-19)', () => {
    it('menghapus cache kredensial yang berubah & mengunci user', async () => {
      await pullAllData(repo, directTransport)
      await repo.saveCredential({
        key: `${DEVICE}:${FIXTURE.user.ACTIVE_2}`,
        deviceId: DEVICE,
        userId: FIXTURE.user.ACTIVE_2,
        loginId: CREDENTIALS.ACTIVE_2.loginId,
        fullName: 'B',
        companyId: '0',
        salt: 's',
        passwordHash: 'h',
        iterations: 1000,
        fingerprint: 'fingerprint-basi',
        lastOnlineLoginAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      })

      const session = await repo.createSession({
        purchaseId: FIXTURE.purchase.CHECKED,
        userId: FIXTURE.user.ACTIVE,
        deviceId: DEVICE,
        receiveDate: toLocalDateTime(new Date()),
      })
      await addScannedItem(repo, session.sessionId, session.purchaseId, '22001771', 1)
      await repo.finalizeSession(session.sessionId, {
        invoiceNumber: 'INV-3',
        doNumber: 'DO-3',
        receiveDate: session.receiveDate,
      })

      const outcome = await syncOutbox(repo, directTransport)
      expect(outcome.revokedUserIds).toContain(FIXTURE.user.ACTIVE_2)
      // Only the revoked credential is removed; the valid ACTIVE credential stays.
      expect((await repo.listCredentials()).map((credential) => credential.userId)).toEqual([
        FIXTURE.user.ACTIVE,
      ])
    })
  })

  describe('otorisasi perangkat saat sinkronisasi', () => {
    it('tanpa kredensial valid -> sesi FAILED (UNAUTHORIZED) dan tetap di antrian', async () => {
      await pullAllData(repo, directTransport)
      await repo.removeCredentialsForUsers([FIXTURE.user.ACTIVE])
      const session = await repo.createSession({
        purchaseId: FIXTURE.purchase.CHECKED,
        userId: FIXTURE.user.ACTIVE,
        deviceId: DEVICE,
        receiveDate: toLocalDateTime(new Date()),
      })
      await addScannedItem(repo, session.sessionId, session.purchaseId, '22001771', 1)
      await repo.finalizeSession(session.sessionId, {
        invoiceNumber: 'INV-12',
        doNumber: 'DO-12',
        receiveDate: session.receiveDate,
      })

      const outcome = await syncOutbox(repo, directTransport)
      expect(outcome.failed).toBe(1)
      const saved = await repo.getSession(session.sessionId)
      expect(saved?.status).toBe(SESSION_STATUS.FAILED)
      expect(saved?.failureCode).toBe('UNAUTHORIZED')
      expect(await repo.outboxSessions()).toHaveLength(1)
    })
  })

  describe('menyegarkan PO (FR-2.3) & unduh ulang (FR-2.2)', () => {
    it('refreshPurchases tidak menghapus sesi yang belum tersinkron', async () => {
      await pullAllData(repo, directTransport)
      const session = await repo.createSession({
        purchaseId: FIXTURE.purchase.CHECKED,
        userId: FIXTURE.user.ACTIVE,
        deviceId: DEVICE,
        receiveDate: toLocalDateTime(new Date()),
      })
      await addScannedItem(repo, session.sessionId, session.purchaseId, '22001771', 3)

      const refreshed = await refreshPurchases(repo, directTransport, { chunkSize: 1 })
      expect(refreshed.purchases).toBe(2)
      expect(await repo.getSession(session.sessionId)).toBeDefined()
      expect(await repo.sessionItems(session.sessionId)).toHaveLength(1)
    })

    it('pull ulang penuh juga mempertahankan sesi lokal', async () => {
      await pullAllData(repo, directTransport)
      const session = await repo.createSession({
        purchaseId: FIXTURE.purchase.CHECKED,
        userId: FIXTURE.user.ACTIVE,
        deviceId: DEVICE,
        receiveDate: toLocalDateTime(new Date()),
      })
      await pullAllData(repo, directTransport)
      expect(await repo.getSession(session.sessionId)).toBeDefined()
    })
  })

  describe('validasi scan di klien', () => {
    it('menolak barang di luar PO (BR-14)', async () => {
      await pullAllData(repo, directTransport)
      // Barcode I2 exists in this PO, so use another PO to trigger rejection.
      const resolution = await resolveScan(repo, FIXTURE.purchase.CHECKED_OTHER_LOC, '22001773')
      expect(resolution.status).toBe('NOT_IN_PO')
      expect(resolution.message).toContain('bukan bagian dari PO')
    })

    it('menolak barcode yang tidak dikenali (FR-4.3)', async () => {
      await pullAllData(repo, directTransport)
      const resolution = await resolveScan(repo, FIXTURE.purchase.CHECKED, '999999999')
      expect(resolution.status).toBe('ITEM_NOT_FOUND')
    })

    it('memakai faktor 1 & menandai convFound=false bila konversi tidak ada (BR-7)', async () => {
      await pullAllData(repo, directTransport)
      // Local item & PO line without conversion data in vendor-item.
      await repo.upsertItems([
        {
          itemMasterId: 'I-NOCONV',
          code: '48009999',
          barcode: '77777777',
          barcode2: null,
          barcode3: null,
          name: 'Tanpa Konversi',
          uomStockId: FIXTURE.uom.PCS,
          uomPurchaseId: FIXTURE.uom.PCS,
        },
      ])
      await repo.upsertPurchaseItems([
        {
          purchaseItemId: 'PI-NOCONV',
          purchaseId: FIXTURE.purchase.CHECKED,
          itemMasterId: 'I-NOCONV',
          qty: '9',
          uomId: FIXTURE.uom.PCS,
          receivedQty: '0',
        },
      ])

      const resolution = await resolveScan(repo, FIXTURE.purchase.CHECKED, '77777777')
      expect(resolution.status).toBe('OK')
      expect(resolution.convFound).toBe(false)
      expect(resolution.convQty).toBe(1)
      expect(resolution.message).toContain('konversi satuan tidak ditemukan')
    })
  })

  describe('sesi ditolak saat PO ditutup (REJECTED)', () => {
    it('server menolak PO CLOSED -> sesi jadi REJECTED dan keluar dari antrian', async () => {
      await pullAllData(repo, directTransport)
      const session = await repo.createSession({
        purchaseId: FIXTURE.purchase.CHECKED,
        userId: FIXTURE.user.ACTIVE,
        deviceId: DEVICE,
        receiveDate: toLocalDateTime(new Date()),
      })
      await addScannedItem(repo, session.sessionId, session.purchaseId, '22001771', 6)
      await repo.finalizeSession(session.sessionId, {
        invoiceNumber: 'INV-9',
        doNumber: 'DO-9',
        receiveDate: session.receiveDate,
      })

      // Admin closes the PO in central system after data has been pulled to the device.
      await getDb().execute(sql`
        UPDATE pos_purchase SET status = 'CLOSED' WHERE purchase_id = ${FIXTURE.purchase.CHECKED}
      `)

      const outcome = await syncOutbox(repo, directTransport)
      expect(outcome.synced).toBe(0)
      expect(outcome.failed).toBe(1)

      const saved = await repo.getSession(session.sessionId)
      expect(saved?.status).toBe(SESSION_STATUS.REJECTED)
      expect(saved?.failureCode).toBe('PURCHASE_NOT_CHECKED')
      expect(await repo.outboxSessions()).toHaveLength(0)
    })

    it('kegagalan transport -> sesi FAILED dan tetap bisa dicoba ulang', async () => {
      await pullAllData(repo, directTransport)
      const session = await repo.createSession({
        purchaseId: FIXTURE.purchase.CHECKED,
        userId: FIXTURE.user.ACTIVE,
        deviceId: DEVICE,
        receiveDate: toLocalDateTime(new Date()),
      })
      await addScannedItem(repo, session.sessionId, session.purchaseId, '22001771', 2)
      await repo.finalizeSession(session.sessionId, {
        invoiceNumber: 'INV-10',
        doNumber: 'DO-10',
        receiveDate: session.receiveDate,
      })

      const brokenTransport: SyncTransport = {
        ...directTransport,
        push: async () => {
          throw new Error('Koneksi terputus')
        },
      }
      const outcome = await syncOutbox(repo, brokenTransport)
      expect(outcome.error).toBe('Koneksi terputus')

      const saved = await repo.getSession(session.sessionId)
      expect(saved?.status).toBe(SESSION_STATUS.FAILED)
      expect(await repo.outboxSessions()).toHaveLength(1)
    })
  })
})
