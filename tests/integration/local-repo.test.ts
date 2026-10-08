import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StockOpsDb } from '~/data/local-db'
import { LocalRepository } from '~/data/local-repo'
import { SESSION_STATUS, PROGRESS_STATUS } from '~/core/contracts/constants'
import { expiryFrom } from '~/features/auth/offline-auth'
import { canEditSession, ownerName } from '~/features/receiving/logic/session-owner'

let db: StockOpsDb
let repo: LocalRepository

async function seedLocal(target: LocalRepository): Promise<void> {
  await target.upsertUnits([
    { uomId: 'U-PCS', unit: 'PCS' },
    { uomId: 'U-KRT', unit: 'KARTON' },
  ])
  await target.upsertVendors([{ vendorId: 'V1', code: '101', name: 'Vendor A', dueDate: '30' }])
  await target.upsertItems([
    {
      itemMasterId: 'I1',
      code: '48000001',
      barcode: '22001771',
      barcode2: '899123',
      barcode3: null,
      name: 'Item 1',
      uomStockId: 'U-PCS',
      uomPurchaseId: 'U-KRT',
    },
    {
      itemMasterId: 'I2',
      code: '48000002',
      barcode: '22001773',
      barcode2: null,
      barcode3: 'ALT-2',
      name: 'Item 2',
      uomStockId: 'U-PCS',
      uomPurchaseId: 'U-PCS',
    },
  ])
  await target.upsertVendorItems([
    {
      vendorItemId: 'VI1',
      vendorId: 'V1',
      itemMasterId: 'I1',
      uomPurchase: 'U-KRT',
      convQty: '12',
    },
  ])
  await target.upsertPurchases([
    {
      purchaseId: 'P1',
      number: 'PO10250001',
      status: 'CHECKED',
      vendorId: 'V1',
      vendorName: 'Vendor A',
      locationId: 'L1',
      userId: '1200001',
      companyId: '0',
      purchDate: '2025-10-25 00:00:00',
      totalAmount: '100',
    },
  ])
  await target.upsertPurchaseItems([
    {
      purchaseItemId: 'PI1',
      purchaseId: 'P1',
      itemMasterId: 'I1',
      qty: '10',
      uomId: 'U-KRT',
      receivedQty: '4',
    },
    {
      purchaseItemId: 'PI2',
      purchaseId: 'P1',
      itemMasterId: 'I2',
      qty: '5',
      uomId: 'U-PCS',
      receivedQty: '0',
    },
  ])
}

beforeEach(async () => {
  db = new StockOpsDb(`stockops_repo_${Math.random().toString(36).slice(2)}`)
  repo = new LocalRepository(db)
  await seedLocal(repo)
})

afterEach(async () => {
  await db.delete()
})

describe('LocalRepository (Dexie)', () => {
  describe('data master', () => {
    it('menghitung isi tabel master', async () => {
      const counts = await repo.masterCounts()
      expect(counts).toEqual({
        purchases: 1,
        purchaseItems: 2,
        items: 2,
        units: 2,
        vendors: 1,
        vendorItems: 1,
      })
    })

    it('mencari PO berdasarkan nomor/vendor (offline)', async () => {
      expect(await repo.searchPurchases('PO1025')).toHaveLength(1)
      expect(await repo.searchPurchases('vendor a')).toHaveLength(1)
      expect(await repo.searchPurchases('tidak ada')).toHaveLength(0)
    })

    it('mencocokkan barcode, barcode_2, barcode_3, dan kode', async () => {
      expect((await repo.getItemByBarcodeOrCode('22001771'))?.itemMasterId).toBe('I1')
      expect((await repo.getItemByBarcodeOrCode('899123'))?.itemMasterId).toBe('I1')
      expect((await repo.getItemByBarcodeOrCode('ALT-2'))?.itemMasterId).toBe('I2')
      expect((await repo.getItemByBarcodeOrCode('48000002'))?.itemMasterId).toBe('I2')
      expect(await repo.getItemByBarcodeOrCode('TIDAK-ADA')).toBeUndefined()
    })

    it('mengambil data vendor-item untuk konversi', async () => {
      const rows = await repo.getVendorItems('V1', 'I1')
      expect(rows).toHaveLength(1)
      expect(Number(rows[0]?.convQty)).toBe(12)
    })

    it('clearMasterData TIDAK menghapus sesi', async () => {
      const session = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      await repo.clearMasterData()
      expect(await repo.getSession(session.sessionId)).toBeDefined()
      expect(await repo.masterCounts()).toMatchObject({ purchases: 0, items: 0 })
    })
  })

  describe('sesi penerimaan', () => {
    it('membuat sesi baru berstatus RUNNING dengan ID lokal', async () => {
      const session = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      expect(session.status).toBe(SESSION_STATUS.RUNNING)
      expect(session.receiveId).toBeNull()
      expect(session.number).toBeNull()
      expect(session.sequence).toBe(1)
      expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('menyimpan nama pemilik pada sesi baru, dan hanya pemilik yang boleh mengubah', async () => {
      const session = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        userFullName: 'Budi Santoso',
        userLoginId: 'op_budi',
        deviceId: 'D1',
      })
      expect(session.userFullName).toBe('Budi Santoso')
      expect(session.userLoginId).toBe('op_budi')
      expect(ownerName(session)).toBe('Budi Santoso')
      expect(canEditSession(session, '1200001')).toBe(true)
      // Satu PDT dipakai bergantian: operator lain tidak boleh melanjutkan sesi ini.
      expect(canEditSession(session, '1200002')).toBe(false)
    })

    it('pemanggil tanpa nama pemilik menyimpan null, bukan undefined', async () => {
      // Jalur ini dipakai seluruh test lain di berkas ini. Nilainya harus null supaya sama dengan
      // hasil migrasi v1 -> v2 dan supaya `ownerName` memberi label generik, bukan string kosong.
      const session = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      expect(session.userFullName).toBeNull()
      expect(session.userLoginId).toBeNull()
      expect(ownerName(session)).toBe('Operator lain')
    })

    it('menambah & menggabungkan qty baris yang sama', async () => {
      const session = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      await repo.addOrIncrementLine(session.sessionId, {
        purchaseItemId: 'PI1',
        itemMasterId: 'I1',
        barcode: '22001771',
        qty: 1,
        uomPurchaseId: 'U-KRT',
        uomId: 'U-PCS',
        convQty: 12,
        convFound: true,
      })
      await repo.addOrIncrementLine(session.sessionId, {
        purchaseItemId: 'PI1',
        itemMasterId: 'I1',
        barcode: '22001771',
        qty: 2,
        uomPurchaseId: 'U-KRT',
        uomId: 'U-PCS',
        convQty: 12,
        convFound: true,
      })
      const items = await repo.sessionItems(session.sessionId)
      expect(items).toHaveLength(1)
      expect(items[0]?.qty).toBe(3)
    })

    it('dua penambahan bersamaan untuk item yang sama digabung jadi satu baris', async () => {
      const session = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      const input = {
        purchaseItemId: 'PI1',
        itemMasterId: 'I1',
        barcode: '22001771',
        qty: 1,
        uomPurchaseId: 'U-KRT',
        uomId: 'U-PCS',
        convQty: 12,
        convFound: true,
      }
      await Promise.all([
        repo.addOrIncrementLine(session.sessionId, input),
        repo.addOrIncrementLine(session.sessionId, input),
      ])
      const items = await repo.sessionItems(session.sessionId)
      expect(items).toHaveLength(1)
      expect(items[0]?.qty).toBe(2)
    })

    it('mengubah & menghapus baris sebelum finalisasi', async () => {
      const session = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      const line = await repo.addOrIncrementLine(session.sessionId, {
        purchaseItemId: 'PI2',
        itemMasterId: 'I2',
        barcode: 'ALT-2',
        qty: 1,
        uomPurchaseId: 'U-PCS',
        uomId: 'U-PCS',
        convQty: 1,
        convFound: false,
      })
      await repo.setLineQty(line.lineId, 4)
      expect((await repo.sessionItems(session.sessionId))[0]?.qty).toBe(4)
      await repo.setLineQty(line.lineId, 0)
      expect(await repo.sessionItems(session.sessionId)).toHaveLength(0)
    })

    it('finalisasi memindahkan sesi ke antrian FIFO', async () => {
      const first = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      const second = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      await repo.finalizeSession(first.sessionId, {
        invoiceNumber: 'INV-1',
        doNumber: 'DO-1',
        receiveDate: '2025-10-25 17:00:00',
      })
      await repo.finalizeSession(second.sessionId, {
        invoiceNumber: 'INV-2',
        doNumber: 'DO-2',
        receiveDate: '2025-10-25 18:00:00',
      })
      const outbox = await repo.outboxSessions()
      expect(outbox.map((session) => session.sessionId)).toEqual([
        first.sessionId,
        second.sessionId,
      ])
      expect(outbox[0]?.status).toBe(SESSION_STATUS.PENDING)
    })

    it('menyimpan nomor resmi & mengunci sesi setelah sukses', async () => {
      const session = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      await repo.markSynced(session.sessionId, {
        receiveId: '1441151880758558720',
        number: 'IN10250001',
        overReceive: false,
        excessTotal: 0,
      })
      const saved = await repo.getSession(session.sessionId)
      expect(saved?.status).toBe(SESSION_STATUS.SYNCED)
      expect(saved?.number).toBe('IN10250001')
      expect(saved?.syncedAt).toBeTruthy()
    })

    it('menandai gagal tanpa menghapus data', async () => {
      const session = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      await repo.addOrIncrementLine(session.sessionId, {
        purchaseItemId: 'PI1',
        itemMasterId: 'I1',
        barcode: null,
        qty: 1,
        uomPurchaseId: 'U-KRT',
        uomId: 'U-PCS',
        convQty: 12,
        convFound: true,
      })
      await repo.markFailed(session.sessionId, 'Koneksi putus')
      const saved = await repo.getSession(session.sessionId)
      expect(saved?.status).toBe(SESSION_STATUS.FAILED)
      expect(saved?.lastError).toBe('Koneksi putus')
      expect(await repo.sessionItems(session.sessionId)).toHaveLength(1)
      expect(await repo.outboxSessions()).toHaveLength(1)
    })

    it('markRejected menandai sesi terminal & tidak masuk antrian', async () => {
      const session = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      await repo.markRejected(session.sessionId, 'PO tidak dapat diterima.', 'PURCHASE_NOT_CHECKED')
      const saved = await repo.getSession(session.sessionId)
      expect(saved?.status).toBe(SESSION_STATUS.REJECTED)
      expect(saved?.failureCode).toBe('PURCHASE_NOT_CHECKED')
      expect(saved?.lastError).toBe('PO tidak dapat diterima.')
      expect(await repo.outboxSessions()).toHaveLength(0)
    })

    it('markFailed dan markRejected tidak pernah mengubah sesi yang sudah SYNCED', async () => {
      const session = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      await repo.markSynced(session.sessionId, {
        receiveId: '1',
        number: 'IN1',
        overReceive: false,
        excessTotal: 0,
      })
      await repo.markFailed(session.sessionId, 'Gagal lokal')
      await repo.markRejected(session.sessionId, 'Ditolak', 'VALIDATION')
      const saved = await repo.getSession(session.sessionId)
      expect(saved?.status).toBe(SESSION_STATUS.SYNCED)
      expect(saved?.number).toBe('IN1')
      expect(saved?.lastError).toBeNull()
    })

    it('resetStaleSyncingSessions hanya memulihkan sesi SYNCING dan tidak menyentuh yang lain', async () => {
      const stuck = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      const done = await repo.createSession({ purchaseId: 'P1', userId: '1200001', deviceId: 'D1' })
      const waiting = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      await repo.setSessionStatus(stuck.sessionId, SESSION_STATUS.SYNCING)
      await repo.markSynced(done.sessionId, {
        receiveId: '1',
        number: 'IN1',
        overReceive: false,
        excessTotal: 0,
      })
      await repo.setSessionStatus(waiting.sessionId, SESSION_STATUS.PENDING)

      expect(await repo.resetStaleSyncingSessions()).toBe(1)

      const saved = await repo.getSession(stuck.sessionId)
      expect(saved?.status).toBe(SESSION_STATUS.FAILED)
      expect(saved?.lastError).toBe('Sinkronisasi terputus. Coba lagi.')
      expect((await repo.getSession(done.sessionId))?.status).toBe(SESSION_STATUS.SYNCED)
      expect((await repo.getSession(waiting.sessionId))?.status).toBe(SESSION_STATUS.PENDING)
      expect(await repo.resetStaleSyncingSessions()).toBe(0)
    })

    it('markFailed menyimpan kode kegagalan dan tetap di antrian', async () => {
      const session = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      await repo.markFailed(session.sessionId, 'Koneksi putus', 'SERVER_ERROR')
      const saved = await repo.getSession(session.sessionId)
      expect(saved?.status).toBe(SESSION_STATUS.FAILED)
      expect(saved?.failureCode).toBe('SERVER_ERROR')
      expect(await repo.outboxSessions()).toHaveLength(1)
    })

    it('membersihkan sesi tersinkron saja', async () => {
      const a = await repo.createSession({ purchaseId: 'P1', userId: '1200001', deviceId: 'D1' })
      const b = await repo.createSession({ purchaseId: 'P1', userId: '1200001', deviceId: 'D1' })
      await repo.markSynced(a.sessionId, {
        receiveId: '1',
        number: 'IN1',
        overReceive: false,
        excessTotal: 0,
      })
      const removed = await repo.deleteSyncedSessions()
      expect(removed).toBe(1)
      expect(await repo.getSession(a.sessionId)).toBeUndefined()
      expect(await repo.getSession(b.sessionId)).toBeDefined()
    })
  })

  describe('progress PO', () => {
    it('menggabungkan qty tersinkron server + sesi lokal yang belum terkirim', async () => {
      const session = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      await repo.addOrIncrementLine(session.sessionId, {
        purchaseItemId: 'PI1',
        itemMasterId: 'I1',
        barcode: null,
        qty: 3,
        uomPurchaseId: 'U-KRT',
        uomId: 'U-PCS',
        convQty: 12,
        convFound: true,
      })

      const progress = await repo.getPurchaseProgress('P1')
      const pi1 = progress.items.get('PI1')
      expect(pi1?.serverReceivedQty).toBe(4)
      expect(pi1?.localPendingQty).toBe(3)
      expect(pi1?.totalReceivedQty).toBe(7)
      expect(pi1?.progress).toBe(PROGRESS_STATUS.PARTIAL)
      expect(progress.orderedTotal).toBe(15)
    })

    it('sesi yang sudah tersinkron tidak dihitung dua kali', async () => {
      const session = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      await repo.addOrIncrementLine(session.sessionId, {
        purchaseItemId: 'PI1',
        itemMasterId: 'I1',
        barcode: null,
        qty: 3,
        uomPurchaseId: 'U-KRT',
        uomId: 'U-PCS',
        convQty: 12,
        convFound: true,
      })
      await repo.markSynced(session.sessionId, {
        receiveId: '1',
        number: 'IN1',
        overReceive: false,
        excessTotal: 0,
      })
      const progress = await repo.getPurchaseProgress('P1')
      expect(progress.items.get('PI1')?.localPendingQty).toBe(0)
      // Regression bug "Received": after sync, session qty must move to server snapshot
      // (seed receivedQty = 4, plus session qty 3 => 7), so the total does not decrease.
      expect(progress.items.get('PI1')?.serverReceivedQty).toBe(7)
      expect(progress.items.get('PI1')?.totalReceivedQty).toBe(7)
    })

    it('markSynced dua kali tidak menambah receivedQty dua kali', async () => {
      const session = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      await repo.addOrIncrementLine(session.sessionId, {
        purchaseItemId: 'PI1',
        itemMasterId: 'I1',
        barcode: null,
        qty: 3,
        uomPurchaseId: 'U-KRT',
        uomId: 'U-PCS',
        convQty: 12,
        convFound: true,
      })
      const result = { receiveId: '1', number: 'IN1', overReceive: false, excessTotal: 0 }
      await repo.markSynced(session.sessionId, result)
      await repo.markSynced(session.sessionId, result)
      const progress = await repo.getPurchaseProgress('P1')
      // Seed receivedQty = 4, plus session qty 3 exactly once => 7.
      expect(progress.items.get('PI1')?.serverReceivedQty).toBe(7)
    })

    it('markSynced untuk replay idempoten tidak menambah receivedQty', async () => {
      const session = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      await repo.addOrIncrementLine(session.sessionId, {
        purchaseItemId: 'PI1',
        itemMasterId: 'I1',
        barcode: null,
        qty: 3,
        uomPurchaseId: 'U-KRT',
        uomId: 'U-PCS',
        convQty: 12,
        convFound: true,
      })
      await repo.markSynced(session.sessionId, {
        receiveId: '1',
        number: 'IN1',
        overReceive: false,
        excessTotal: 0,
        replay: true,
      })
      const saved = await repo.getSession(session.sessionId)
      expect(saved?.status).toBe(SESSION_STATUS.SYNCED)
      const progress = await repo.getPurchaseProgress('P1')
      expect(progress.items.get('PI1')?.serverReceivedQty).toBe(4)
    })

    it('markSynced menyimpan excess per baris dari jawaban server', async () => {
      const session = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      const line = await repo.addOrIncrementLine(session.sessionId, {
        purchaseItemId: 'PI2',
        itemMasterId: 'I2',
        barcode: null,
        qty: 5,
        uomPurchaseId: 'U-PCS',
        uomId: 'U-PCS',
        convQty: 1,
        convFound: true,
      })
      // PI2: ordered 5, nothing received before, this session 5 — exactly full, so the server
      // reports no excess. The local formula would answer 5 + 5 - 5 = 5 once the increment below
      // lands, which is the bug this stores its way out of.
      await repo.markSynced(session.sessionId, {
        receiveId: '1',
        number: 'IN1',
        overReceive: false,
        excessTotal: 0,
        lines: [{ purchaseItemId: 'PI2', excess: 0 }],
      })
      const saved = await repo.db.sessionItems.get(line.lineId)
      expect(saved?.serverExcess).toBe(0)
      expect((await repo.getPurchaseProgress('P1')).items.get('PI2')?.serverReceivedQty).toBe(5)
    })

    it('markSynced untuk replay tetap menyimpan excess per baris', async () => {
      const session = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      const line = await repo.addOrIncrementLine(session.sessionId, {
        purchaseItemId: 'PI1',
        itemMasterId: 'I1',
        barcode: null,
        qty: 8,
        uomPurchaseId: 'U-KRT',
        uomId: 'U-PCS',
        convQty: 12,
        convFound: true,
      })
      await repo.markSynced(session.sessionId, {
        receiveId: '1',
        number: 'IN1',
        overReceive: true,
        excessTotal: 2,
        lines: [{ purchaseItemId: 'PI1', excess: 2 }],
        replay: true,
      })
      // The per-line figure IS stored on a replay; only the receivedQty increment is skipped.
      expect((await repo.db.sessionItems.get(line.lineId))?.serverExcess).toBe(2)
      expect((await repo.getPurchaseProgress('P1')).items.get('PI1')?.serverReceivedQty).toBe(4)
    })

    it('sesi ditolak (REJECTED) tidak dihitung di "diterima"', async () => {
      const session = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      await repo.addOrIncrementLine(session.sessionId, {
        purchaseItemId: 'PI1',
        itemMasterId: 'I1',
        barcode: null,
        qty: 3,
        uomPurchaseId: 'U-KRT',
        uomId: 'U-PCS',
        convQty: 12,
        convFound: true,
      })
      await repo.markRejected(session.sessionId, 'PO ditutup.', 'PURCHASE_NOT_CHECKED')

      const progress = await repo.getPurchaseProgress('P1')
      expect(progress.items.get('PI1')?.localPendingQty).toBe(0)
      expect(progress.items.get('PI1')?.serverReceivedQty).toBe(4)
      expect(progress.items.get('PI1')?.totalReceivedQty).toBe(4)

      const summaries = await repo.listPurchaseSummaries()
      const summary = summaries.find((row) => row.purchaseId === 'P1')
      expect(summary?.totalReceivedTotal).toBe(4)
      expect(summary?.serverReceivedTotal).toBe(4)
      expect(summary?.localPendingTotal).toBe(0)
      expect(summary?.serverReceivedTotal ?? 0).toBeLessThanOrEqual(
        summary?.totalReceivedTotal ?? 0,
      )
    })
  })

  describe('kredensial offline', () => {
    it('menyimpan per (device, user) & mencabut berdasarkan daftar user', async () => {
      const now = new Date('2026-01-01T00:00:00Z')
      await repo.saveCredential({
        key: 'D1:1200001',
        deviceId: 'D1',
        userId: '1200001',
        loginId: 'gedesujana',
        fullName: 'A',
        companyId: '0',
        salt: 's',
        passwordHash: 'h',
        iterations: 1000,
        fingerprint: 'f',
        lastOnlineLoginAt: now.toISOString(),
        expiresAt: expiryFrom(now, 7),
      })
      await repo.saveCredential({
        key: 'D1:1200003',
        deviceId: 'D1',
        userId: '1200003',
        loginId: '100318',
        fullName: 'B',
        companyId: '0',
        salt: 's',
        passwordHash: 'h',
        iterations: 1000,
        fingerprint: 'f',
        lastOnlineLoginAt: now.toISOString(),
        expiresAt: expiryFrom(now, 7),
      })

      expect(await repo.listCredentials()).toHaveLength(2)
      expect((await repo.getCredential('D1', 'gedesujana'))?.userId).toBe('1200001')

      const removed = await repo.removeCredentialsForUsers(['1200003'])
      expect(removed).toBe(1)
      expect(await repo.listCredentials()).toHaveLength(1)
    })

    it('deviceId stabil antar pemanggilan', async () => {
      const first = await repo.ensureDeviceId()
      const second = await repo.ensureDeviceId()
      expect(first).toBe(second)
      expect(first).toMatch(/^[0-9a-f-]{36}$/)
    })
  })

  describe('daftar status kirim', () => {
    it('runningSessions mengembalikan yang terbaru lebih dulu', async () => {
      // Urutannya load-bearing: daftar PO memakai `running[0]` sebagai sesi yang ditawarkan untuk
      // dilanjutkan. Sebelum diurutkan, `where('status').equals(...)` mengembalikan baris dalam
      // urutan primary key — yaitu UUID sessionId, praktis acak.
      const first = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      const second = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      const third = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })

      const running = await repo.runningSessions()

      expect(running.map((session) => session.sequence)).toEqual([3, 2, 1])
      expect(running[0]?.sessionId).toBe(third.sessionId)
      expect(running[2]?.sessionId).toBe(first.sessionId)
      expect(second.sequence).toBe(2)
    })

    it('runningSessions mengabaikan sesi yang sudah difinalisasi', async () => {
      const running = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      const finalized = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      await repo.finalizeSession(finalized.sessionId, {
        invoiceNumber: 'INV-1',
        doNumber: 'DO-1',
        receiveDate: '2026-10-06 10:00:00',
      })

      const result = await repo.runningSessions()

      expect(result).toHaveLength(1)
      expect(result[0]?.sessionId).toBe(running.sessionId)
    })

    it('countItemsBySession menghitung per sesi dan MENGHILANGKAN sesi tanpa baris', async () => {
      // Sesi tanpa baris sengaja absen dari peta: layar status membacanya dengan `?? 0`.
      const withLines = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      const empty = await repo.createSession({
        purchaseId: 'P1',
        userId: '1200001',
        deviceId: 'D1',
      })
      for (const purchaseItemId of ['PI1', 'PI2']) {
        await repo.addOrIncrementLine(withLines.sessionId, {
          purchaseItemId,
          itemMasterId: 'I1',
          barcode: '22001771',
          qty: 1,
          uomPurchaseId: 'U-KRT',
          uomId: 'U-PCS',
          convQty: 12,
          convFound: true,
        })
      }
      // Scan kedua atas PI1 menyatu ke baris yang sama, jadi hitungannya tetap 2, bukan 3.
      await repo.addOrIncrementLine(withLines.sessionId, {
        purchaseItemId: 'PI1',
        itemMasterId: 'I1',
        barcode: '22001771',
        qty: 1,
        uomPurchaseId: 'U-KRT',
        uomId: 'U-PCS',
        convQty: 12,
        convFound: true,
      })

      const counts = await repo.countItemsBySession()

      expect(counts.get(withLines.sessionId)).toBe(2)
      expect(counts.has(empty.sessionId)).toBe(false)
    })
  })
})
