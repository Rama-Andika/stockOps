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

/** Complete download of master/PO data, applied to the local tables in one transaction. */
export interface MasterDataSnapshot {
  purchases: PurchaseRowInput[]
  purchaseItems: PurchaseItemRowInput[]
  items: ItemRowInput[]
  units: Array<{ uomId: string; unit: string }>
  vendors: Array<{ vendorId: string; code: string | null; name: string; dueDate: string | null }>
  vendorItems: Array<{
    vendorItemId: string
    vendorId: string
    itemMasterId: string
    uomPurchase: string
    convQty: string
  }>
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * `meta` key holding the session screen's active tab. One source of truth: the screen writes it,
 * and both delete paths below remove it. A literal copy in either place would eventually drift.
 */
export function sessionTabKey(sessionId: string): string {
  return `sessionTab:${sessionId}`
}

/**
 * Local data repository (Dexie). One instance per database; `offlineDb`
 * is used by the app, while tests may create separate instances.
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

  /** Identity of this device (used for per-device credentials — FR-1.4). */
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
   * FR-2.2: Re-downloading MUST NOT delete receiving documents that have not yet
   * been synchronized. Therefore only master/PO tables are cleared.
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

  /** FR-2.3: Only refreshes PO list (without touching item master). */
  async clearPurchases(): Promise<void> {
    await this.db.transaction('rw', [this.db.purchases, this.db.purchaseItems], async () => {
      await this.db.purchases.clear()
      await this.db.purchaseItems.clear()
    })
  }

  /**
   * FR-2.2: Atomically replaces ALL master/PO tables with a fully downloaded snapshot.
   * Called only after every chunk arrived, so a dropped connection never leaves the
   * device with partial or empty master data. Receiving sessions are not touched.
   */
  async replaceMasterData(snapshot: MasterDataSnapshot): Promise<void> {
    const at = nowIso()
    await this.db.transaction(
      'rw',
      [this.db.purchases, this.db.purchaseItems, this.db.items, this.db.units, this.db.vendors, this.db.vendorItems],
      async () => {
        await this.db.purchases.clear()
        await this.db.purchaseItems.clear()
        await this.db.items.clear()
        await this.db.units.clear()
        await this.db.vendors.clear()
        await this.db.vendorItems.clear()
        await this.db.purchases.bulkPut(snapshot.purchases.map((row) => ({ ...row, updatedAt: at })))
        await this.db.purchaseItems.bulkPut(snapshot.purchaseItems.map((row) => ({ ...row, updatedAt: at })))
        await this.db.items.bulkPut(snapshot.items.map((row) => ({ ...row, updatedAt: at })))
        await this.db.units.bulkPut(snapshot.units.map((row) => ({ ...row, updatedAt: at })))
        await this.db.vendors.bulkPut(snapshot.vendors.map((row) => ({ ...row, updatedAt: at })))
        await this.db.vendorItems.bulkPut(snapshot.vendorItems.map((row) => ({ ...row, updatedAt: at })))
      },
    )
  }

  /** FR-2.3: Atomically replaces the PO list (item master untouched). */
  async replacePurchases(
    purchases: readonly PurchaseRowInput[],
    purchaseItems: readonly PurchaseItemRowInput[],
  ): Promise<void> {
    const at = nowIso()
    await this.db.transaction('rw', [this.db.purchases, this.db.purchaseItems], async () => {
      await this.db.purchases.clear()
      await this.db.purchaseItems.clear()
      await this.db.purchases.bulkPut(purchases.map((row) => ({ ...row, updatedAt: at })))
      await this.db.purchaseItems.bulkPut(purchaseItems.map((row) => ({ ...row, updatedAt: at })))
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
   * PO list + progress summary (computed in a single pass, not per PO).
   * Progress = synced qty (server snapshot) + unsent local session qty.
   */
  async listPurchaseSummaries(): Promise<
    Array<
      LocalPurchase & {
        orderedTotal: number
        serverReceivedTotal: number
        localPendingTotal: number
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
      const serverReceivedTotal = serverReceived.get(purchase.purchaseId) ?? 0
      const localPendingTotal = localPending.get(purchase.purchaseId) ?? 0
      const totalReceivedTotal = dec2(serverReceivedTotal + localPendingTotal)
      return {
        ...purchase,
        orderedTotal,
        serverReceivedTotal,
        localPendingTotal,
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

  /**
   * Other POs on this device that contain the given item, newest first. Used when a scan resolves
   * to a known item that is not on the PO being received: the operator can be told where it DOES
   * belong instead of only where it does not.
   *
   * `rows` holds at most `limit` POs, newest first; `total` counts ALL of them. They are separate
   * because the scan card names one PO and reports the rest as a count — deriving that count from
   * `rows.length` capped it at `limit - 1`, so an item on nine other POs was shown as "+4".
   *
   * No status filter is needed — the local `purchases` table only ever holds CHECKED POs (BR-1:
   * the pull fetches only those, and refreshPurchases removes the ones that closed). A purchase
   * item whose PO is not in the table at all is dropped by the `Boolean` filter below; since
   * `replacePurchases` rewrites both tables in one transaction that cannot happen today, so the
   * filter is defensive — but it is also what keeps `total` counting only POs that really exist.
   */
  async findPurchasesWithItem(
    itemMasterId: string,
    excludePurchaseId: string,
    limit = 5,
  ): Promise<{
    rows: Array<{ purchaseId: string; number: string | null; vendorName: string }>
    total: number
  }> {
    const itemRows = await this.db.purchaseItems.where('itemMasterId').equals(itemMasterId).toArray()
    const ids = [...new Set(itemRows.map((row) => row.purchaseId))].filter(
      (id) => id !== excludePurchaseId,
    )
    if (ids.length === 0) return { rows: [], total: 0 }

    const purchases = await this.db.purchases.bulkGet(ids)
    const found = purchases
      .filter((purchase): purchase is LocalPurchase => Boolean(purchase))
      // `purchDate` is stored as 'YYYY-MM-DD HH:mm:ss', so plain string order is date order.
      .sort((a, b) => (b.purchDate ?? '').localeCompare(a.purchDate ?? ''))

    return {
      rows: found.slice(0, limit).map((purchase) => ({
        purchaseId: purchase.purchaseId,
        number: purchase.number,
        vendorName: purchase.vendorName,
      })),
      // Taken before the slice on purpose: `limit` caps what is listed, not what is reported.
      total: found.length,
    }
  }

  /** FR-4.3: Match barcode/barcode_2/barcode_3; B-4: fallback to item code. */
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

  /** FR-4.6: Unfinalized session is stored locally & can be resumed. */
  async sessionItems(sessionId: string): Promise<LocalSessionItem[]> {
    return this.db.sessionItems.where('sessionId').equals(sessionId).toArray()
  }

  async addOrIncrementLine(sessionId: string, input: NewLineInput): Promise<LocalSessionItem> {
    // One transaction: two concurrent adds for the same PO item must merge into one line.
    return this.db.transaction('rw', [this.db.sessionItems, this.db.sessions], async () => {
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
    })
  }

  async setLineQty(lineId: string, qty: number): Promise<void> {
    await this.db.transaction('rw', [this.db.sessionItems, this.db.sessions], async () => {
      const line = await this.db.sessionItems.get(lineId)
      if (!line) return
      if (qty <= 0) {
        await this.db.sessionItems.delete(lineId)
      } else {
        await this.db.sessionItems.put({ ...line, qty: dec2(qty) })
      }
      await this.touchSession(line.sessionId)
    })
  }

  async removeLine(lineId: string): Promise<void> {
    await this.db.transaction('rw', [this.db.sessionItems, this.db.sessions], async () => {
      const line = await this.db.sessionItems.get(lineId)
      if (!line) return
      await this.db.sessionItems.delete(lineId)
      await this.touchSession(line.sessionId)
    })
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

  /** FR-4.7: Finalization -> enters "Pending Synchronization" outbox. */
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

  /** FR-5.1: FIFO queue of pending/failed sessions. */
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

  /** Reset sessions stuck in SYNCING state (e.g. app closed mid-sync). */
  async resetStaleSyncingSessions(): Promise<number> {
    // One transaction: the sessions are read and rewritten atomically, so a session that
    // markSynced finishes in between can never be flipped back to FAILED by a stale snapshot.
    return this.db.transaction('rw', this.db.sessions, async () => {
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
    })
  }

  /**
   * FR-5.5/FR-4.8: Store official number & lock session (read-only).
   * Idempotent and atomic: a session that is already SYNCED is left untouched, so a
   * double push can never count its qty twice.
   */
  async markSynced(
    sessionId: string,
    result: {
      receiveId: string
      number: string
      overReceive: boolean
      excessTotal: number
      /** true when the server answered IDEMPOTENT_REPLAY (the document already existed). */
      replay?: boolean
    },
  ): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.sessions, this.db.sessionItems, this.db.purchaseItems],
      async () => {
        const session = await this.db.sessions.get(sessionId)
        if (!session || session.status === SESSION_STATUS.SYNCED) return

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

        // Fix for "Received" regression bug: once SYNCED, the session qty leaves
        // localPending, but the server snapshot (receivedQty) is not refreshed yet.
        // Add the qty locally so the "Received" number does not drop; the next pull
        // overwrites it. Skipped on replay: the document came from an earlier request
        // whose qty may already be in the snapshot, so sync() refreshes the PO list instead.
        if (result.replay) return
        const lines = await this.db.sessionItems.where('sessionId').equals(sessionId).toArray()
        for (const line of lines) {
          const purchaseItem = await this.db.purchaseItems.get(line.purchaseItemId)
          if (!purchaseItem) continue
          const current = Number(purchaseItem.receivedQty ?? 0)
          await this.db.purchaseItems.put({
            ...purchaseItem,
            receivedQty: String(dec2(current + line.qty)),
          })
        }
      },
    )
  }

  /** FR-5.6: TEMPORARY failure -> remains in queue, data is not deleted. */
  async markFailed(sessionId: string, error: string, code?: string | null): Promise<void> {
    await this.db.transaction('rw', this.db.sessions, async () => {
      const session = await this.db.sessions.get(sessionId)
      // A session the server already stored must never go back to the queue (it would only replay).
      if (!session || session.status === SESSION_STATUS.SYNCED) return
      await this.db.sessions.put({
        ...session,
        status: SESSION_STATUS.FAILED,
        lastError: error,
        failureCode: code ?? null,
        updatedAt: nowIso(),
      })
    })
  }

  /** PERMANENT rejection (PO closed/deleted/validation): terminal, exits queue. */
  async markRejected(sessionId: string, error: string, code: string): Promise<void> {
    await this.db.transaction('rw', this.db.sessions, async () => {
      const session = await this.db.sessions.get(sessionId)
      if (!session || session.status === SESSION_STATUS.SYNCED) return
      await this.db.sessions.put({
        ...session,
        status: SESSION_STATUS.REJECTED,
        lastError: error,
        failureCode: code,
        updatedAt: nowIso(),
      })
    })
  }

  /** FR-8.2: Clear synced sessions (with UI confirmation). */
  async deleteSyncedSessions(): Promise<number> {
    const synced = await this.db.sessions.where('status').equals(SESSION_STATUS.SYNCED).toArray()
    const ids = synced.map((session) => session.sessionId)
    await this.db.transaction(
      'rw',
      [this.db.sessions, this.db.sessionItems, this.db.meta],
      async () => {
        for (const id of ids) {
          await this.db.sessionItems.where('sessionId').equals(id).delete()
        }
        await this.db.sessions.bulkDelete(ids)
        // This is the path most sessions actually take (synced, then cleared from Settings), so
        // without it the tab keys leak for the overwhelming majority of sessions.
        await this.db.meta.bulkDelete(ids.map((id) => sessionTabKey(id)))
      },
    )
    return ids.length
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.sessions, this.db.sessionItems, this.db.meta],
      async () => {
        await this.db.sessionItems.where('sessionId').equals(sessionId).delete()
        await this.db.sessions.delete(sessionId)
        // UI state parked on this session; without this the `meta` table grows by one permanent
        // row per session ever opened.
        await this.db.meta.delete(sessionTabKey(sessionId))
      },
    )
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

  /** BR-19: Revocation applies to all cached users. */
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
