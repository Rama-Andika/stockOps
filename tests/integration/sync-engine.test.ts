import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '~/server/db/client'
import { checkCredentialRevocations, loginOnline } from '~/server/services/auth-service'
import { pullChunk } from '~/server/services/pull-service'
import { syncPush } from '~/server/services/sync-service'
import { StockOpsDb, type LocalCredential } from '~/data/local-db'
import { computeFingerprint } from '~/server/crypto/credentials'
import { LocalRepository } from '~/data/local-repo'
import {
  buildSessionPayload,
  pullAllData,
  refreshPurchases,
  syncOutbox,
} from '~/features/sync/engine'
import type { SyncTransport } from '~/features/sync/transport'
import type { PullResult } from '~/core/contracts/schemas'
import { addScannedItem, resolveScan } from '~/features/receiving/scanning'
import { toLocalDateTime } from '~/core/receiving/receive-date'
import { MAX_SCAN_QTY, PURCHASES_STALE_META_KEY, SESSION_STATUS } from '~/core/contracts/constants'
import { CREDENTIALS, FIXTURE, seedAll } from '../server/helpers'

/** Transport that calls server services directly (without HTTP). */
const directTransport: SyncTransport = {
  login: (input) => loginOnline(input),
  checkCredentials: async (input) => ({
    revoked: await checkCredentialRevocations(input.credentials),
  }),
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
  describe('pullAllData', () => {
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

      // Operator selects PO & starts session.
      const session = await repo.createSession({
        purchaseId: FIXTURE.purchase.CHECKED,
        userId: FIXTURE.user.ACTIVE,
        deviceId: DEVICE,
        receiveDate: toLocalDateTime(new Date()),
      })

      // Scan barcode.
      const scan = await addScannedItem(repo, session.sessionId, session.purchaseId, '22001771', 6)
      expect(scan.ok).toBe(true)
      expect(scan.line?.convQty).toBe(12)
      expect(scan.line?.convFound).toBe(true)

      // Finalize with invoice & DO.
      await repo.finalizeSession(session.sessionId, {
        invoiceNumber: 'INV-100',
        doNumber: 'DO-100',
        receiveDate: session.receiveDate,
      })

      // Automatic/manual synchronization.
      const outcome = await syncOutbox(repo, directTransport)
      expect(outcome.synced).toBe(1)
      expect(outcome.failed).toBe(0)

      const saved = await repo.getSession(session.sessionId)
      expect(saved?.status).toBe(SESSION_STATUS.SYNCED)
      expect(saved?.number).toMatch(/^IN\d{4}0001$/)
      expect(saved?.receiveId).toBeTruthy()

      // Synced session = read-only: no longer present in outbox.
      expect(await repo.outboxSessions()).toHaveLength(0)
    })

    it('mengirim ulang tidak menduplikasi', async () => {
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

  describe('over-receive terlihat di klien', () => {
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

  describe('pencabutan kredensial saat sinkronisasi', () => {
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

  describe('balasan server hilang (timeout) lalu kirim ulang', () => {
    it('replay idempoten tidak menghitung qty dua kali di progress lokal', async () => {
      await pullAllData(repo, directTransport)
      const session = await repo.createSession({
        purchaseId: FIXTURE.purchase.CHECKED,
        userId: FIXTURE.user.ACTIVE,
        deviceId: DEVICE,
        receiveDate: toLocalDateTime(new Date()),
      })
      await addScannedItem(repo, session.sessionId, session.purchaseId, '22001771', 6)
      await repo.finalizeSession(session.sessionId, {
        invoiceNumber: 'INV-11',
        doNumber: 'DO-11',
        receiveDate: session.receiveDate,
      })

      // The server stores the document, but the device never receives the answer.
      const finalized = (await repo.getSession(session.sessionId))!
      const purchase = (await repo.getPurchase(session.purchaseId))!
      const payload = buildSessionPayload(finalized, await repo.sessionItems(session.sessionId), {
        vendorId: purchase.vendorId,
        locationId: purchase.locationId,
        companyId: purchase.companyId,
      })
      await directTransport.push({
        deviceId: DEVICE,
        sessions: [payload],
        credentials: [activeFingerprint()],
      })

      // A later PO refresh already contains the 6 received units.
      await refreshPurchases(repo, directTransport)

      const outcome = await syncOutbox(repo, directTransport)
      expect(outcome.results[0]?.code).toBe('IDEMPOTENT_REPLAY')
      const progress = await repo.getPurchaseProgress(session.purchaseId)
      expect(progress.items.get(FIXTURE.purchaseItem.PI1)?.totalReceivedQty).toBe(6)
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

  describe('batas waktu unduhan (pull)', () => {
    // Never answers: simulates a half-dead connection.
    const hangingTransport: SyncTransport = {
      ...directTransport,
      pull: () => new Promise<PullResult>(() => {}),
    }

    it('pullAllData berhenti dengan error timeout dan data lama tetap utuh', async () => {
      await pullAllData(repo, directTransport)
      const before = await repo.masterCounts()
      await expect(pullAllData(repo, hangingTransport, { timeoutMs: 50 })).rejects.toThrow(
        'batas waktu',
      )
      expect(await repo.masterCounts()).toEqual(before)
    })

    it('refreshPurchases berhenti dengan error timeout dan daftar PO lama tetap utuh', async () => {
      await pullAllData(repo, directTransport)
      await expect(refreshPurchases(repo, hangingTransport, { timeoutMs: 50 })).rejects.toThrow(
        'batas waktu',
      )
      expect(await repo.db.purchases.count()).toBe(2)
      expect(await repo.db.purchaseItems.count()).toBe(4)
    })
  })

  describe('penanda "PO perlu diperbarui"', () => {
    it('refreshPurchases yang berhasil membersihkan penanda', async () => {
      await pullAllData(repo, directTransport)
      await repo.setMeta(PURCHASES_STALE_META_KEY, '1')
      await refreshPurchases(repo, directTransport)
      expect(await repo.getMeta(PURCHASES_STALE_META_KEY)).toBe('0')
    })

    it('pullAllData yang berhasil membersihkan penanda', async () => {
      await repo.setMeta(PURCHASES_STALE_META_KEY, '1')
      await pullAllData(repo, directTransport)
      expect(await repo.getMeta(PURCHASES_STALE_META_KEY)).toBe('0')
    })

    it('refreshPurchases yang gagal membiarkan penanda tetap menyala', async () => {
      await pullAllData(repo, directTransport)
      await repo.setMeta(PURCHASES_STALE_META_KEY, '1')
      const failing: SyncTransport = {
        ...directTransport,
        pull: async () => {
          throw new Error('Koneksi terputus')
        },
      }
      await expect(refreshPurchases(repo, failing)).rejects.toThrow('Koneksi terputus')
      expect(await repo.getMeta(PURCHASES_STALE_META_KEY)).toBe('1')
    })
  })

  describe('hasil sinkronisasi diproses per sesi', () => {
    /** Pulls the data and creates one finalized session ready for syncOutbox. */
    async function finalizedSession(invoice: string) {
      await pullAllData(repo, directTransport)
      const session = await repo.createSession({
        purchaseId: FIXTURE.purchase.CHECKED,
        userId: FIXTURE.user.ACTIVE,
        deviceId: DEVICE,
        receiveDate: toLocalDateTime(new Date()),
      })
      await addScannedItem(repo, session.sessionId, session.purchaseId, '22001771', 1)
      await repo.finalizeSession(session.sessionId, {
        invoiceNumber: invoice,
        doNumber: `DO-${invoice}`,
        receiveDate: session.receiveDate,
      })
      return session
    }

    it('kegagalan menulis log tidak membalik sesi yang sudah tersinkron', async () => {
      const session = await finalizedSession('INV-L1')
      vi.spyOn(repo, 'logEvent').mockRejectedValue(new Error('log error'))

      const outcome = await syncOutbox(repo, directTransport)

      expect(outcome.synced).toBe(1)
      expect(outcome.failed).toBe(0)
      expect((await repo.getSession(session.sessionId))?.status).toBe(SESSION_STATUS.SYNCED)
    })

    it('kegagalan lokal pada satu sesi tidak membalik sesi lain yang sudah tersinkron', async () => {
      const first = await finalizedSession('INV-L2A')
      const second = await finalizedSession('INV-L2B')
      // Saving the result of the SECOND session fails locally; the first one is saved normally.
      const realMarkSynced = repo.markSynced.bind(repo)
      vi.spyOn(repo, 'markSynced').mockImplementation(async (sessionId, result) => {
        if (sessionId === second.sessionId) throw new Error('storage error')
        return realMarkSynced(sessionId, result)
      })

      const outcome = await syncOutbox(repo, directTransport)

      expect(outcome.synced).toBe(1)
      expect(outcome.failed).toBe(1)
      expect((await repo.getSession(first.sessionId))?.status).toBe(SESSION_STATUS.SYNCED)
      expect((await repo.getSession(second.sessionId))?.status).toBe(SESSION_STATUS.FAILED)
      expect(await repo.outboxSessions()).toHaveLength(1)

      // The server stored both documents, so sending the second one again is an idempotent replay.
      vi.restoreAllMocks()
      const retry = await syncOutbox(repo, directTransport)
      expect(retry.results[0]?.code).toBe('IDEMPOTENT_REPLAY')
      expect((await repo.getSession(second.sessionId))?.status).toBe(SESSION_STATUS.SYNCED)
    })

    it('sesi yang menggantung di SYNCING dikirim ulang pada sync berikutnya', async () => {
      const session = await finalizedSession('INV-L5')
      // Simulates an app that died right after marking the session as sending.
      await repo.markSyncing(session.sessionId)
      expect(await repo.outboxSessions()).toHaveLength(0)

      const outcome = await syncOutbox(repo, directTransport)

      expect(outcome).toMatchObject({ attempted: 1, synced: 1, failed: 0 })
      expect((await repo.getSession(session.sessionId))?.status).toBe(SESSION_STATUS.SYNCED)
    })

    it('hasil ganda atau untuk sesi tak dikenal diabaikan dan tidak menggelembungkan hitungan', async () => {
      const session = await finalizedSession('INV-L4')
      const noisy: SyncTransport = {
        ...directTransport,
        push: async (input) => {
          const response = await directTransport.push(input)
          const first = response.results[0]!
          return {
            ...response,
            results: [
              ...response.results,
              { ...first, sessionId: 'unknown-session-0001' }, // not part of the payload
              { ...first }, // a second answer for the same session
            ],
          }
        },
      }

      const outcome = await syncOutbox(repo, noisy)

      expect(outcome).toMatchObject({ attempted: 1, synced: 1, failed: 0 })
      expect(outcome.results).toHaveLength(1)
      expect((await repo.getSession(session.sessionId))?.status).toBe(SESSION_STATUS.SYNCED)
    })

    it('jawaban kedua yang bertentangan untuk sesi yang sama diabaikan', async () => {
      const session = await finalizedSession('INV-L6')
      const contradicting: SyncTransport = {
        ...directTransport,
        push: async (input) => {
          const response = await directTransport.push(input)
          const first = response.results[0]!
          return {
            ...response,
            results: [
              first,
              {
                ...first,
                status: 'FAILED' as const,
                code: 'VALIDATION' as const,
                message: 'ganda',
              },
            ],
          }
        },
      }

      const outcome = await syncOutbox(repo, contradicting)

      expect(outcome).toMatchObject({ synced: 1, failed: 0 })
      const saved = await repo.getSession(session.sessionId)
      expect(saved?.status).toBe(SESSION_STATUS.SYNCED)
      expect(saved?.lastError).toBeNull()
    })

    it('sesi yang tidak dijawab server tidak menggantung di SYNCING', async () => {
      const session = await finalizedSession('INV-L3')
      const silent: SyncTransport = {
        ...directTransport,
        push: async () => ({ results: [], revoked: [], serverTime: new Date().toISOString() }),
      }

      const outcome = await syncOutbox(repo, silent)

      expect(outcome.failed).toBe(1)
      expect((await repo.getSession(session.sessionId))?.status).toBe(SESSION_STATUS.FAILED)
    })
  })

  describe('menyegarkan PO & unduh ulang', () => {
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

    it('pullAllData yang gagal di tengah tidak menghapus data lama', async () => {
      await pullAllData(repo, directTransport)
      const before = await repo.masterCounts()
      const flaky: SyncTransport = {
        ...directTransport,
        pull: async (input) => {
          if (input.kind === 'purchaseItems') throw new Error('Koneksi terputus')
          return directTransport.pull(input)
        },
      }
      await expect(pullAllData(repo, flaky)).rejects.toThrow('Koneksi terputus')
      expect(await repo.masterCounts()).toEqual(before)
    })

    it('refreshPurchases yang gagal di tengah mempertahankan daftar PO lama', async () => {
      await pullAllData(repo, directTransport)
      const flaky: SyncTransport = {
        ...directTransport,
        pull: async (input) => {
          if (input.kind === 'purchaseItems') throw new Error('Koneksi terputus')
          return directTransport.pull(input)
        },
      }
      await expect(refreshPurchases(repo, flaky)).rejects.toThrow('Koneksi terputus')
      expect(await repo.db.purchases.count()).toBe(2)
      expect(await repo.db.purchaseItems.count()).toBe(4)
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
    it('menolak barang di luar PO', async () => {
      await pullAllData(repo, directTransport)
      // Barcode I2 exists in this PO, so use another PO to trigger rejection.
      const resolution = await resolveScan(repo, FIXTURE.purchase.CHECKED_OTHER_LOC, '22001773')
      expect(resolution.status).toBe('NOT_IN_PO')
      expect(resolution.message).toContain('bukan bagian dari PO')
    })

    it('menolak barcode yang tidak dikenali', async () => {
      await pullAllData(repo, directTransport)
      const resolution = await resolveScan(repo, FIXTURE.purchase.CHECKED, '999999999')
      expect(resolution.status).toBe('ITEM_NOT_FOUND')
    })

    it('memakai faktor 1 & menandai convFound=false bila konversi tidak ada', async () => {
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

describe('batas besaran qty scan', () => {
  it('menolak qty di atas MAX_SCAN_QTY tanpa menulis baris sesi', async () => {
    await pullAllData(repo, directTransport)
    const session = await repo.createSession({
      purchaseId: FIXTURE.purchase.CHECKED,
      userId: FIXTURE.user.ACTIVE,
      deviceId: DEVICE,
      receiveDate: toLocalDateTime(new Date()),
    })

    const tooMuch = await addScannedItem(
      repo,
      session.sessionId,
      session.purchaseId,
      '22001771',
      MAX_SCAN_QTY + 1,
    )
    expect(tooMuch.ok).toBe(false)
    // The session screen picks its toast branch from this status: if it ever stops being 'OK',
    // the operator sees "Bukan item PO ini" again instead of the real reason.
    expect(tooMuch.resolution.status).toBe('OK')
    expect(await repo.sessionItems(session.sessionId)).toHaveLength(0)

    const atLimit = await addScannedItem(
      repo,
      session.sessionId,
      session.purchaseId,
      '22001771',
      MAX_SCAN_QTY,
    )
    expect(atLimit.ok).toBe(true)
  })

  it('menolak qty nol', async () => {
    await pullAllData(repo, directTransport)
    const session = await repo.createSession({
      purchaseId: FIXTURE.purchase.CHECKED,
      userId: FIXTURE.user.ACTIVE,
      deviceId: DEVICE,
      receiveDate: toLocalDateTime(new Date()),
    })

    const zero = await addScannedItem(repo, session.sessionId, session.purchaseId, '22001771', 0)
    expect(zero.ok).toBe(false)
    expect(zero.resolution.status).toBe('OK')
    expect(await repo.sessionItems(session.sessionId)).toHaveLength(0)
  })
})

describe('mencari PO lain yang memuat barang', () => {
  it('menemukan PO CHECKED lain dan mengecualikan PO yang sedang dibuka', async () => {
    await pullAllData(repo, directTransport)

    const others = await repo.findPurchasesWithItem(FIXTURE.item.I1, FIXTURE.purchase.CHECKED)

    // I1 ada di CHECKED, DRAFT, dan CHECKED_OTHER_LOC. CHECKED dikecualikan, dan DRAFT tidak
    // pernah ditarik ke perangkat, jadi hanya satu yang tersisa.
    expect(others.rows).toHaveLength(1)
    expect(others.total).toBe(1)
    expect(others.rows[0]?.purchaseId).toBe(FIXTURE.purchase.CHECKED_OTHER_LOC)
    expect(others.rows[0]?.number).toBe('PO10250003')
    expect(others.rows[0]?.vendorName).toBe('BALI LESTARI KOSMETIK')
  })

  it('mengurutkan PO terbaru lebih dulu, membatasi daftarnya, tapi menghitung semuanya', async () => {
    await pullAllData(repo, directTransport)

    // Tujuh PO tambahan yang memuat I1, tanggalnya 2025-11-01 … 2025-11-07 — semuanya lebih baru
    // dari CHECKED_OTHER_LOC (2025-10-25), jadi urutan yang diharapkan tidak ambigu.
    const extra = Array.from({ length: 7 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0')
      return {
        purchaseId: `90000000000000${day}`,
        number: `PO9900${day}`,
        purchDate: `2025-11-${day} 08:00:00`,
      }
    })
    await repo.db.purchases.bulkPut(
      extra.map((row) => ({
        purchaseId: row.purchaseId,
        number: row.number,
        status: 'CHECKED',
        vendorId: FIXTURE.vendor.V1,
        vendorName: 'BALI LESTARI KOSMETIK',
        locationId: FIXTURE.location.L1,
        userId: FIXTURE.user.ACTIVE,
        companyId: '0',
        purchDate: row.purchDate,
        totalAmount: '100000',
        updatedAt: row.purchDate,
      })),
    )
    await repo.db.purchaseItems.bulkPut(
      extra.map((row) => ({
        purchaseItemId: `${row.purchaseId}1`,
        purchaseId: row.purchaseId,
        itemMasterId: FIXTURE.item.I1,
        qty: '10',
        uomId: FIXTURE.uom.KARTON,
        receivedQty: '0',
        updatedAt: row.purchDate,
      })),
    )

    const others = await repo.findPurchasesWithItem(FIXTURE.item.I1, FIXTURE.purchase.CHECKED)

    // Default limit = 5, terbaru dulu: 07 … 03. CHECKED_OTHER_LOC yang paling tua jatuh keluar.
    expect(others.rows.map((row) => row.number)).toEqual([
      'PO990007',
      'PO990006',
      'PO990005',
      'PO990004',
      'PO990003',
    ])
    // Dihitung sebelum dipotong: kartunya harus menulis "(+7 PO lain)", bukan "(+4 PO lain)".
    expect(others.total).toBe(8)
  })

  it('mengembalikan daftar kosong untuk barang yang hanya ada di satu PO', async () => {
    await pullAllData(repo, directTransport)

    // I2 hanya ada di purchase.CHECKED, jadi tidak ada PO lain.
    const others = await repo.findPurchasesWithItem(FIXTURE.item.I2, FIXTURE.purchase.CHECKED)

    expect(others).toEqual({ rows: [], total: 0 })
  })
})
