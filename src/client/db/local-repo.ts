import {
  getOfflineDb,
  type LocalCredential,
  type LocalItem,
  type LocalPurchase,
  type LocalPurchaseItem,
  type LocalSession,
  type LocalSessionItem,
  type LocalUnit,
  type LocalVendor,
  type LocalVendorItem,
  type StockOpsDb,
} from './local-db'
import { newUuid } from '~/shared/uuid'
import { toLocalDateTime } from '~/shared/receive-date'
import { SESSION_STATUS, type SessionStatus } from '~/shared/constants'
import { dec2 } from '~/shared/num'
import { progressOf } from '~/shared/over-receive'
import type { ProgressStatus } from '~/shared/constants'

export interface PurchaseRowInput {
  purchaseId: string
  number: string | null
  status: string | null
  vendorId: string
  vendorName: string
  locationId: string
  userId: string
  companyId: string
  purchDate: string | null
  totalAmount: string
}

export interface PurchaseItemRowInput {
  purchaseItemId: string
  purchaseId: string
  itemMasterId: string
  qty: string
  uomId: string
  receivedQty: string
}

export interface ItemRowInput {
  itemMasterId: string
  code: string | null
  barcode: string | null
  barcode2: string | null
  barcode3: string | null
  name: string
  uomStockId: string
  uomPurchaseId: string
}

export interface NewLineInput {
  purchaseItemId: string
  itemMasterId: string
  barcode: string | null
  qty: number
  uomPurchaseId: string
  uomId: string
  convQty: number
  convFound: boolean
}

export interface PurchaseItemProgress {
  purchaseItemId: string
  orderedQty: number
  serverReceivedQty: number
  localPendingQty: number
  totalReceivedQty: number
  progress: ProgressStatus
}

export interface PurchaseProgress {
  orderedTotal: number
  serverReceivedTotal: number
  localPendingTotal: number
  totalReceivedTotal: number
  progress: ProgressStatus
  items: Map<string, PurchaseItemProgress>
}

export interface PurchaseDetail {
  purchase: LocalPurchase | undefined
  items: Array<
    LocalPurchaseItem & {
      item: LocalItem | undefined
      orderedQty: number
      serverReceivedQty: number
      localPendingQty: number
      totalReceivedQty: number
      progress: ProgressStatus
    }
  >
  progress: PurchaseProgress
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Repositori data lokal (Dexie). Satu instance per database; `offlineDb`
 * dipakai aplikasi, sedangkan test boleh membuat instance terpisah.
 */
export class LocalRepository {
  constructor(private readonly explicitDb?: StockOpsDb) {}

  get db(): StockOpsDb {
    return this.explicitDb ?? getOfflineDb()
  }

  /* ----------------------------- Meta ----------------------------- */

  async getMeta(key: string): Promise<string | null> {
    const row = await this.db.meta.get(key)
    return row?.value ?? null
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.meta.put({ key, value })
  }

  /** Identitas device ini (dipakai untuk kredensial per device — FR-1.4). */
  async ensureDeviceId(): Promise<string> {
    const existing = await this.getMeta('deviceId')
    if (existing) return existing
    const deviceId = newUuid()
    await this.setMeta('deviceId', deviceId)
    return deviceId
  }

  async log(level: 'info' | 'error', message: string, sessionId?: string): Promise<void> {
    await this.db.syncLog.add({ at: nowIso(), level, message, sessionId })
  }

  /* -------------------------- Data master ------------------------- */

  async upsertPurchases(rows: readonly PurchaseRowInput[]): Promise<number> {
    const at = nowIso()
    await this.db.purchases.bulkPut(rows.map((row) => ({ ...row, updatedAt: at })))
    return rows.length
  }

  async upsertPurchaseItems(rows: readonly PurchaseItemRowInput[]): Promise<number> {
    const at = nowIso()
    await this.db.purchaseItems.bulkPut(rows.map((row) => ({ ...row, updatedAt: at })))
    return rows.length
  }

  async upsertItems(rows: readonly ItemRowInput[]): Promise<number> {
    const at = nowIso()
    await this.db.items.bulkPut(rows.map((row) => ({ ...row, updatedAt: at })))
    return rows.length
  }

  async upsertUnits(rows: ReadonlyArray<{ uomId: string; unit: string }>): Promise<number> {
    const at = nowIso()
    await this.db.units.bulkPut(rows.map((row) => ({ ...row, updatedAt: at })))
    return rows.length
  }

  async upsertVendors(
    rows: ReadonlyArray<{ vendorId: string; code: string | null; name: string; dueDate: string | null }>,
  ): Promise<number> {
    const at = nowIso()
    await this.db.vendors.bulkPut(rows.map((row) => ({ ...row, updatedAt: at })))
    return rows.length
  }

  async upsertVendorItems(
    rows: ReadonlyArray<{
      vendorItemId: string
      vendorId: string
      itemMasterId: string
      uomPurchase: string
      convQty: string
    }>,
  ): Promise<number> {
    const at = nowIso()
    await this.db.vendorItems.bulkPut(rows.map((row) => ({ ...row, updatedAt: at })))
    return rows.length
  }

  /**
   * FR-2.2: unduh ulang TIDAK boleh menghapus dokumen penerimaan yang belum
   * tersinkron. Karena itu hanya tabel master/PO yang dibersihkan.
   */
  async clearMasterData(): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.purchases, this.db.purchaseItems, this.db.items, this.db.units, this.db.vendors, this.db.vendorItems],
      async () => {
        await Promise.all([
          this.db.purchases.clear(),
          this.db.purchaseItems.clear(),
          this.db.items.clear(),
          this.db.units.clear(),
          this.db.vendors.clear(),
          this.db.vendorItems.clear(),
        ])
      },
    )
  }

  /** FR-2.3: hanya menyegarkan daftar PO (tanpa menyentuh master barang). */
  async clearPurchases(): Promise<void> {
    await this.db.transaction('rw', [this.db.purchases, this.db.purchaseItems], async () => {
      await this.db.purchases.clear()
      await this.db.purchaseItems.clear()
    })
  }

  async masterCounts(): Promise<Record<string, number>> {
    const [purchases, purchaseItems, items, units, vendors, vendorItems] = await Promise.all([
      this.db.purchases.count(),
      this.db.purchaseItems.count(),
      this.db.items.count(),
      this.db.units.count(),
      this.db.vendors.count(),
      this.db.vendorItems.count(),
    ])
    return { purchases, purchaseItems, items, units, vendors, vendorItems }
  }

  /* ---------------------------- Query ---------------------------- */

  async getPurchase(purchaseId: string): Promise<LocalPurchase | undefined> {
    return this.db.purchases.get(purchaseId)
  }

  async listPurchases(): Promise<LocalPurchase[]> {
    return this.db.purchases.orderBy('number').toArray()
  }

  /**
   * Daftar PO + ringkasan kemajuan (dihitung sekali jalan, bukan per PO).
   * Kemajuan = qty tersinkron (snapshot server) + qty sesi lokal yang belum terkirim.
   */
  async listPurchaseSummaries(): Promise<
    Array<
      LocalPurchase & {
        orderedTotal: number
        totalReceivedTotal: number
        progress: ProgressStatus
      }
    >
  > {
    const [purchases, purchaseItems, sessions] = await Promise.all([
      this.db.purchases.orderBy('number').toArray(),
      this.db.purchaseItems.toArray(),
      this.db.sessions.toArray(),
    ])

    const ordered = new Map<string, number>()
    const serverReceived = new Map<string, number>()
    for (const item of purchaseItems) {
      ordered.set(item.purchaseId, dec2((ordered.get(item.purchaseId) ?? 0) + Number(item.qty ?? 0)))
      serverReceived.set(
        item.purchaseId,
        dec2((serverReceived.get(item.purchaseId) ?? 0) + Number(item.receivedQty ?? 0)),
      )
    }

    const purchaseBySession = new Map(sessions.map((session) => [session.sessionId, session]))
    const pendingLines = purchaseItems.length
      ? await this.db.sessionItems.toArray()
      : []
    const localPending = new Map<string, number>()
    for (const line of pendingLines) {
      const session = purchaseBySession.get(line.sessionId)
      if (
        !session ||
        session.status === SESSION_STATUS.SYNCED ||
        session.status === SESSION_STATUS.REJECTED
      )
        continue
      localPending.set(
        session.purchaseId,
        dec2((localPending.get(session.purchaseId) ?? 0) + line.qty),
      )
    }

    return purchases.map((purchase) => {
      const orderedTotal = ordered.get(purchase.purchaseId) ?? 0
      const totalReceivedTotal = dec2(
        (serverReceived.get(purchase.purchaseId) ?? 0) + (localPending.get(purchase.purchaseId) ?? 0),
      )
      return {
        ...purchase,
        orderedTotal,
        totalReceivedTotal,
        progress: progressOf(orderedTotal, totalReceivedTotal),
      }
    })
  }

  async searchPurchases(term: string): Promise<LocalPurchase[]> {
    const needle = term.trim().toLowerCase()
    const all = await this.db.purchases.toArray()
    if (!needle) return all.sort((a, b) => (a.number ?? '').localeCompare(b.number ?? ''))
    return all
      .filter(
        (purchase) =>
          (purchase.number ?? '').toLowerCase().includes(needle) ||
          purchase.vendorName.toLowerCase().includes(needle),
      )
      .sort((a, b) => (a.number ?? '').localeCompare(b.number ?? ''))
  }

  async getPurchaseItems(purchaseId: string): Promise<LocalPurchaseItem[]> {
    return this.db.purchaseItems.where('purchaseId').equals(purchaseId).toArray()
  }

  /** FR-4.3: cocokkan barcode/barcode_2/barcode_3; B-4: fallback ke kode. */
  async getItemByBarcodeOrCode(scanned: string): Promise<LocalItem | undefined> {
    const needle = scanned.trim()
    if (!needle) return undefined
    const byBarcode =
      (await this.db.items.where('barcode').equals(needle).first()) ??
      (await this.db.items.where('barcode2').equals(needle).first()) ??
      (await this.db.items.where('barcode3').equals(needle).first())
    if (byBarcode) return byBarcode
    return this.db.items.where('code').equals(needle).first()
  }

  async getVendorItems(vendorId: string, itemMasterId: string): Promise<LocalVendorItem[]> {
    return this.db.vendorItems.where('[vendorId+itemMasterId]').equals([vendorId, itemMasterId]).toArray()
  }

  async getUnitName(uomId: string): Promise<string> {
    const unit = await this.db.units.get(uomId)
    return unit?.unit ?? ''
  }

  async getItemMaster(itemMasterId: string): Promise<LocalItem | undefined> {
    return this.db.items.get(itemMasterId)
  }

  /* --------------------------- Sessions --------------------------- */

  async createSession(input: {
    purchaseId: string
    userId: string
    deviceId: string
    receiveDate?: string
  }): Promise<LocalSession> {
    const purchase = await this.getPurchase(input.purchaseId)
    const session: LocalSession = {
      sessionId: newUuid(),
      purchaseId: input.purchaseId,
      purchaseNumber: purchase?.number ?? null,
      vendorName: purchase?.vendorName ?? null,
      userId: input.userId,
      deviceId: input.deviceId,
      status: SESSION_STATUS.RUNNING,
      invoiceNumber: '',
      doNumber: '',
      receiveDate: input.receiveDate ?? toLocalDateTime(new Date()),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      finalizedAt: null,
      syncedAt: null,
      receiveId: null,
      number: null,
      lastError: null,
      failureCode: null,
      overReceive: false,
      excessTotal: 0,
      sequence: await this.nextSequence(),
    }
    await this.db.sessions.put(session)
    return session
  }

  private async nextSequence(): Promise<number> {
    const last = await this.db.sessions.orderBy('sequence').last()
    return (last?.sequence ?? 0) + 1
  }

  async getSession(sessionId: string): Promise<LocalSession | undefined> {
    return this.db.sessions.get(sessionId)
  }

  async listSessions(): Promise<LocalSession[]> {
    return this.db.sessions.orderBy('sequence').reverse().toArray()
  }

  async runningSessions(): Promise<LocalSession[]> {
    return this.db.sessions.where('status').equals(SESSION_STATUS.RUNNING).toArray()
  }

  /** FR-4.6: sesi belum final tersimpan lokal & bisa dilanjutkan. */
  async sessionItems(sessionId: string): Promise<LocalSessionItem[]> {
    return this.db.sessionItems.where('sessionId').equals(sessionId).toArray()
  }

  async addOrIncrementLine(sessionId: string, input: NewLineInput): Promise<LocalSessionItem> {
    const existing = await this.db.sessionItems
      .where('[sessionId+purchaseItemId]')
      .equals([sessionId, input.purchaseItemId])
      .first()

    if (existing) {
      const updated: LocalSessionItem = { ...existing, qty: dec2(existing.qty + input.qty) }
      await this.db.sessionItems.put(updated)
      await this.touchSession(sessionId)
      return updated
    }

    const line: LocalSessionItem = {
      lineId: newUuid(),
      sessionId,
      purchaseItemId: input.purchaseItemId,
      itemMasterId: input.itemMasterId,
      barcode: input.barcode,
      qty: dec2(input.qty),
      uomPurchaseId: input.uomPurchaseId,
      uomId: input.uomId,
      convQty: input.convQty,
      convFound: input.convFound,
      createdAt: nowIso(),
    }
    await this.db.sessionItems.put(line)
    await this.touchSession(sessionId)
    return line
  }

  async setLineQty(lineId: string, qty: number): Promise<void> {
    const line = await this.db.sessionItems.get(lineId)
    if (!line) return
    if (qty <= 0) {
      await this.db.sessionItems.delete(lineId)
    } else {
      await this.db.sessionItems.put({ ...line, qty: dec2(qty) })
    }
    await this.touchSession(line.sessionId)
  }

  async removeLine(lineId: string): Promise<void> {
    const line = await this.db.sessionItems.get(lineId)
    if (!line) return
    await this.db.sessionItems.delete(lineId)
    await this.touchSession(line.sessionId)
  }

  private async touchSession(sessionId: string): Promise<void> {
    const session = await this.db.sessions.get(sessionId)
    if (!session) return
    await this.db.sessions.put({ ...session, updatedAt: nowIso() })
  }

  async updateSessionDraft(
    sessionId: string,
    patch: Partial<Pick<LocalSession, 'invoiceNumber' | 'doNumber' | 'receiveDate'>>,
  ): Promise<void> {
    const session = await this.db.sessions.get(sessionId)
    if (!session) return
    await this.db.sessions.put({ ...session, ...patch, updatedAt: nowIso() })
  }

  /** FR-4.7: finalisasi -> masuk outbox "Menunggu Sinkronisasi". */
  async finalizeSession(
    sessionId: string,
    input: { invoiceNumber: string; doNumber: string; receiveDate: string },
  ): Promise<LocalSession | undefined> {
    const session = await this.db.sessions.get(sessionId)
    if (!session) return undefined
    const updated: LocalSession = {
      ...session,
      invoiceNumber: input.invoiceNumber.trim(),
      doNumber: input.doNumber.trim(),
      receiveDate: input.receiveDate,
      status: SESSION_STATUS.PENDING,
      finalizedAt: nowIso(),
      lastError: null,
      failureCode: null,
      updatedAt: nowIso(),
    }
    await this.db.sessions.put(updated)
    return updated
  }

  /** FR-5.1: antrian FIFO sesi yang menunggu/gagal. */
  async outboxSessions(): Promise<LocalSession[]> {
    const pending = await this.db.sessions.where('status').equals(SESSION_STATUS.PENDING).toArray()
    const failed = await this.db.sessions.where('status').equals(SESSION_STATUS.FAILED).toArray()
    return [...pending, ...failed].sort((a, b) => a.sequence - b.sequence)
  }

  async setSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    const session = await this.db.sessions.get(sessionId)
    if (!session) return
    await this.db.sessions.put({ ...session, status, updatedAt: nowIso() })
  }

  async markSyncing(sessionId: string): Promise<void> {
    await this.setSessionStatus(sessionId, SESSION_STATUS.SYNCING)
  }

  /** Reset sesi yang nyangkut di status SYNCING (mis. aplikasi tertutup di tengah sinkronisasi). */
  async resetStaleSyncingSessions(): Promise<number> {
    const syncing = await this.db.sessions.where('status').equals(SESSION_STATUS.SYNCING).toArray()
    if (syncing.length === 0) return 0
    await this.db.sessions.bulkPut(
      syncing.map((session) => ({
        ...session,
        status: SESSION_STATUS.FAILED,
        lastError: 'Sinkronisasi terputus. Coba lagi.',
        failureCode: null,
        updatedAt: nowIso(),
      })),
    )
    return syncing.length
  }

  /** FR-5.5/FR-4.8: simpan nomor resmi & kunci sesi (read-only). */
  async markSynced(
    sessionId: string,
    result: { receiveId: string; number: string; overReceive: boolean; excessTotal: number },
  ): Promise<void> {
    const session = await this.db.sessions.get(sessionId)
    if (!session) return
    await this.db.sessions.put({
      ...session,
      status: SESSION_STATUS.SYNCED,
      receiveId: result.receiveId,
      number: result.number,
      overReceive: result.overReceive,
      excessTotal: result.excessTotal,
      syncedAt: nowIso(),
      lastError: null,
      failureCode: null,
      updatedAt: nowIso(),
    })

    // Perbaikan bug "Diterima": sesi yang baru tersinkron sebelumnya dihitung sebagai
    // "belum terkirim" (localPending). Setelah status berubah menjadi SYNCED, qty sesi
    // dikeluarkan dari localPending, tetapi snapshot receivedQty dari server belum diperbarui.
    // Akibatnya angka "Diterima" turun. Solusi: naikkan receivedQty lokal sebesar qty sesi
    // yang baru tersinkron. Nilai ini akan ditimpa oleh pull berikutnya (tidak double-count).
    const lines = await this.db.sessionItems.where('sessionId').equals(sessionId).toArray()
    if (lines.length > 0) {
      await this.db.transaction('rw', this.db.purchaseItems, async () => {
        for (const line of lines) {
          const purchaseItem = await this.db.purchaseItems.get(line.purchaseItemId)
          if (!purchaseItem) continue
          const current = Number(purchaseItem.receivedQty ?? 0)
          await this.db.purchaseItems.put({
            ...purchaseItem,
            receivedQty: String(dec2(current + line.qty)),
          })
        }
      })
    }
  }

  /** FR-5.6: gagal SEMENTARA -> tetap di antrian, data tidak dihapus. */
  async markFailed(sessionId: string, error: string, code?: string | null): Promise<void> {
    const session = await this.db.sessions.get(sessionId)
    if (!session) return
    await this.db.sessions.put({
      ...session,
      status: SESSION_STATUS.FAILED,
      lastError: error,
      failureCode: code ?? null,
      updatedAt: nowIso(),
    })
  }

  /** Ditolak PERMANEN (PO ditutup/dihapus/validasi): terminal, keluar dari antrian. */
  async markRejected(sessionId: string, error: string, code: string): Promise<void> {
    const session = await this.db.sessions.get(sessionId)
    if (!session) return
    await this.db.sessions.put({
      ...session,
      status: SESSION_STATUS.REJECTED,
      lastError: error,
      failureCode: code,
      updatedAt: nowIso(),
    })
  }

  /** FR-8.2: bersihkan sesi yang sudah tersinkron (dengan konfirmasi di UI). */
  async deleteSyncedSessions(): Promise<number> {
    const synced = await this.db.sessions.where('status').equals(SESSION_STATUS.SYNCED).toArray()
    const ids = synced.map((session) => session.sessionId)
    await this.db.transaction('rw', [this.db.sessions, this.db.sessionItems], async () => {
      for (const id of ids) {
        await this.db.sessionItems.where('sessionId').equals(id).delete()
      }
      await this.db.sessions.bulkDelete(ids)
    })
    return ids.length
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.db.transaction('rw', [this.db.sessions, this.db.sessionItems], async () => {
      await this.db.sessionItems.where('sessionId').equals(sessionId).delete()
      await this.db.sessions.delete(sessionId)
    })
  }

  /* ------------------------- Progress (FR-3.2) ------------------------- */

  async getPurchaseProgress(purchaseId: string): Promise<PurchaseProgress> {
    const items = await this.getPurchaseItems(purchaseId)
    const sessions = await this.db.sessions.where('purchaseId').equals(purchaseId).toArray()
    const pendingSessions = sessions.filter(
      (session) =>
        session.status !== SESSION_STATUS.SYNCED && session.status !== SESSION_STATUS.REJECTED,
    )
    const sessionIds = pendingSessions.map((session) => session.sessionId)

    const lines = sessionIds.length
      ? await this.db.sessionItems.where('sessionId').anyOf(sessionIds).toArray()
      : []

    const localPending = new Map<string, number>()
    for (const line of lines) {
      localPending.set(
        line.purchaseItemId,
        dec2((localPending.get(line.purchaseItemId) ?? 0) + line.qty),
      )
    }

    const map = new Map<string, PurchaseItemProgress>()
    let orderedTotal = 0
    let serverTotal = 0
    let pendingTotal = 0
    for (const item of items) {
      const orderedQty = Number(item.qty ?? 0)
      const serverReceivedQty = Number(item.receivedQty ?? 0)
      const localPendingQty = localPending.get(item.purchaseItemId) ?? 0
      const totalReceivedQty = dec2(serverReceivedQty + localPendingQty)
      orderedTotal = dec2(orderedTotal + orderedQty)
      serverTotal = dec2(serverTotal + serverReceivedQty)
      pendingTotal = dec2(pendingTotal + localPendingQty)
      map.set(item.purchaseItemId, {
        purchaseItemId: item.purchaseItemId,
        orderedQty,
        serverReceivedQty,
        localPendingQty,
        totalReceivedQty,
        progress: progressOf(orderedQty, totalReceivedQty),
      })
    }

    return {
      orderedTotal,
      serverReceivedTotal: serverTotal,
      localPendingTotal: pendingTotal,
      totalReceivedTotal: dec2(serverTotal + pendingTotal),
      progress: progressOf(orderedTotal, dec2(serverTotal + pendingTotal)),
      items: map,
    }
  }

  async getPurchaseDetail(purchaseId: string): Promise<PurchaseDetail> {
    const purchase = await this.getPurchase(purchaseId)
    const rawItems = await this.getPurchaseItems(purchaseId)
    const progress = await this.getPurchaseProgress(purchaseId)
    const items = await Promise.all(
      rawItems.map(async (item) => {
        const itemProgress = progress.items.get(item.purchaseItemId)
        return {
          ...item,
          item: await this.getItemMaster(item.itemMasterId),
          orderedQty: itemProgress?.orderedQty ?? Number(item.qty ?? 0),
          serverReceivedQty: itemProgress?.serverReceivedQty ?? 0,
          localPendingQty: itemProgress?.localPendingQty ?? 0,
          totalReceivedQty: itemProgress?.totalReceivedQty ?? 0,
          progress: itemProgress?.progress ?? progressOf(0, 0),
        }
      }),
    )
    return { purchase, items, progress }
  }

  /* -------------------------- Credentials -------------------------- */

  async saveCredential(credential: LocalCredential): Promise<void> {
    await this.db.credentials.put(credential)
  }

  async listCredentials(): Promise<LocalCredential[]> {
    return this.db.credentials.toArray()
  }

  async getCredential(deviceId: string, loginId: string): Promise<LocalCredential | undefined> {
    const all = await this.db.credentials.where('deviceId').equals(deviceId).toArray()
    return all.find((credential) => credential.loginId === loginId)
  }

  async getActiveCredentialForDevice(deviceId: string): Promise<LocalCredential | undefined> {
    return this.db.credentials.where('deviceId').equals(deviceId).first()
  }

  async removeCredential(key: string): Promise<void> {
    await this.db.credentials.delete(key)
  }

  /** BR-19: pencabutan berlaku untuk semua user ter-cache. */
  async removeCredentialsForUsers(userIds: readonly string[]): Promise<number> {
    if (userIds.length === 0) return 0
    const keys = await this.db.credentials.where('userId').anyOf([...userIds]).primaryKeys()
    await this.db.credentials.bulkDelete(keys)
    return keys.length
  }
}

export const localRepo = new LocalRepository()

export type {
  LocalCredential,
  LocalItem,
  LocalPurchase,
  LocalPurchaseItem,
  LocalSession,
  LocalSessionItem,
  LocalUnit,
  LocalVendor,
  LocalVendorItem,
}
