import {
  getOfflineDb,
  type LocalCredential,
  type LocalItem,
  type LocalPurchase,
  type LocalPurchaseItem,
  type LocalSession,
  type LocalSessionItem,
  type LocalSyncLogEntry,
  type LocalUnit,
  type LocalVendor,
  type LocalVendorItem,
  type StockOpsDb,
} from './local-db'
import { newUuid } from '~/shared/uuid'
import { toLocalDateTime } from '~/shared/receive-date'
import { SESSION_STATUS, type SessionStatus } from '~/shared/constants'
import {
  DIAG_LOG_MAX,
  DIAG_MESSAGE_MAX,
  DIAG_PROBLEM_LEVELS,
  DIAG_PRUNE_EVERY,
  type DiagEntryInput,
} from '~/client/diagnostics/events'
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
  /**
   * True only for an addition that came from the PO item list instead of a scan. Optional, and
   * absent means "scanned": that is both the safe default and what every caller written before this
   * feature meant. `addScannedItem` therefore does not pass it at all.
   */
  pickedManually?: boolean
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

/**
 * Writes since the ring buffer was last trimmed. Module level, not per instance: the trim must
 * happen at most once per DIAG_PRUNE_EVERY writes across the whole app, and more than one
 * `LocalRepository` can exist (the sync tests build their own). The trim itself always runs on
 * the database of whichever instance is writing, so sharing the counter is harmless — but it
 * does make pruning non-deterministic in tests, which is why the tests call `pruneSyncLog()`
 * directly instead of writing a hundred entries.
 */
let logWritesSincePrune = 0

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

  /**
   * This device's own id, minted once and kept in `meta`. Credentials are cached per
   * (device, user), and the id also travels in the session marker so a document can be traced
   * back to the PDT that recorded it.
   */
  async ensureDeviceId(): Promise<string> {
    const existing = await this.getMeta('deviceId')
    if (existing) return existing
    const deviceId = newUuid()
    await this.setMeta('deviceId', deviceId)
    return deviceId
  }

  /**
   * The ONE way an entry enters the diagnostics trail.
   *
   * Everything funnels through here so that truncation and the ring buffer cannot be bypassed by
   * a new call site. It must never throw at its callers: writing the trail is diagnostics, and a
   * failed write may not change the outcome of a receiving session — `safeLog` in the sync engine
   * and `recordDiag` in the trail module both swallow, and `syncOutbox` relies on it.
   */
  async logEvent(entry: DiagEntryInput): Promise<void> {
    logWritesSincePrune += 1
    await this.db.syncLog.add({
      at: nowIso(),
      level: entry.level,
      message: entry.message.slice(0, DIAG_MESSAGE_MAX),
      sessionId: entry.sessionId,
      category: entry.category,
      event: entry.event,
      detail: entry.detail,
    })
    if (logWritesSincePrune < DIAG_PRUNE_EVERY) return
    logWritesSincePrune = 0
    try {
      await this.pruneSyncLog()
    } catch {
      // The entry is already stored; a failed trim must not turn a successful write into an error.
    }
  }

  /**
   * Ring buffer: keeps the newest `max` entries and deletes the rest.
   *
   * Ordering is by primary key, never by `at`. `++id` is monotonic; `at` comes from the device
   * clock, which on a PDT can be wrong or jump, so trimming by `at` would delete the wrong rows
   * on exactly the day someone needs the log. `Table.limit()` walks the primary key ascending, so
   * the first `count - max` keys ARE the oldest entries, and `primaryKeys()` reads keys only.
   */
  async pruneSyncLog(max: number = DIAG_LOG_MAX): Promise<number> {
    const count = await this.db.syncLog.count()
    if (count <= max) return 0
    const oldest = await this.db.syncLog.limit(count - max).primaryKeys()
    await this.db.syncLog.bulkDelete(oldest)
    return oldest.length
  }

  async countLogEntries(): Promise<number> {
    return this.db.syncLog.count()
  }

  /** How many entries are warn or error — the figure the diagnostics screen leads with. */
  async countProblemLogEntries(): Promise<number> {
    return this.db.syncLog
      .where('level')
      .anyOf([...DIAG_PROBLEM_LEVELS])
      .count()
  }

  /**
   * Newest entries first, at most `limit` of them.
   *
   * Both branches walk the PRIMARY KEY backwards, which is already newest-first, and let Dexie
   * stop once `limit` rows have been produced. The problem-only branch must NOT use
   * `where('level')`: that walks the LEVEL index, so the order would be by level rather than by
   * time, and an earlier version therefore read every matching row and sorted in memory — up to
   * 2000 rows (stack traces included) materialised and 90% discarded on every re-run of the live
   * query, which fires on every Dexie commit while the screen is open.
   *
   * `filter` is applied before `limit` counts a row, so the limit caps RESULTS, not the scan
   * (locked by the "saringan masalah" case in tests/client/diag-log.test.ts, where the newest rows
   * are all `info`). The predicate asks DIAG_PROBLEM_LEVELS instead of testing `!== 'info'` so
   * that this list and `countProblemLogEntries` can never disagree about what "a problem" is.
   */
  async recentLogEntries(limit: number, onlyProblems = false): Promise<LocalSyncLogEntry[]> {
    const newestFirst = this.db.syncLog.reverse()
    if (!onlyProblems) return newestFirst.limit(limit).toArray()
    return newestFirst
      .filter((row) => DIAG_PROBLEM_LEVELS.includes(row.level))
      .limit(limit)
      .toArray()
  }

  /** Empties the trail and reports how many entries went. Touches no session and no master data. */
  async clearSyncLog(): Promise<number> {
    const removed = await this.db.syncLog.count()
    await this.db.syncLog.clear()
    return removed
  }

  /**
   * One count per session status, for the diagnostics snapshot. Six index counts rather than one
   * pass over the table: `status` is indexed, so each count is answered by the index alone and the
   * rows themselves are never read.
   */
  async sessionStatusCounts(): Promise<Record<SessionStatus, number>> {
    const counts = {} as Record<SessionStatus, number>
    for (const status of Object.values(SESSION_STATUS)) {
      counts[status] = await this.db.sessions.where('status').equals(status).count()
    }
    return counts
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
   * Clears master and PO tables only. Re-downloading data MUST NOT touch receiving sessions:
   * an unsent session is work the operator did with goods on the dock, and it exists nowhere
   * else yet.
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

  /**
   * Clears the PO tables alone, for a PO-list refresh. The item master is left in place: it is
   * the expensive half of a download and it changes far less often than PO progress does.
   */
  async clearPurchases(): Promise<void> {
    await this.db.transaction('rw', [this.db.purchases, this.db.purchaseItems], async () => {
      await this.db.purchases.clear()
      await this.db.purchaseItems.clear()
    })
  }

  /**
   * Swaps ALL master and PO tables for a fully downloaded snapshot, in one transaction.
   * Called only once every chunk has arrived, so a connection dropping mid-download leaves the
   * old data intact instead of a device that can no longer resolve a barcode. Receiving
   * sessions are never part of the swap.
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

  /**
   * Swaps the PO list in one transaction, leaving the item master alone. Same reason as
   * `replaceMasterData`: download first, then replace, so a failed refresh costs nothing.
   */
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
   * No status filter is needed — the local `purchases` table only ever holds POs that may be
   * received: the pull fetches CHECKED ones only, and refreshPurchases drops those that have
   * since closed. A purchase
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

  /**
   * Resolves what the scanner typed: all three barcode columns first, then the item code as a
   * fallback for a label that is too damaged to scan. Exact matches only — a partial code must
   * not resolve to a neighbouring item.
   */
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
    /**
     * Owner name, stored on the session. Optional because roughly forty-five calls in
     * `tests/client/` pass only the three ids, and a required field would turn a product change
     * into a mass test edit. The one caller in the app (`routes/pos/$purchaseId.tsx`) always
     * passes both.
     */
    userFullName?: string | null
    userLoginId?: string | null
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
      // `?? null`, never left undefined: the row is read back by `ownerName`, and a stored null is
      // what the migration writes too, so both paths produce the same "Operator lain".
      userFullName: input.userFullName ?? null,
      userLoginId: input.userLoginId ?? null,
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

  /**
   * Running sessions, newest first. The order matters and is therefore decided here, once: the PO
   * list shows `[0]` as "the session to continue" and the send-status screen lists them all, so
   * two callers would otherwise be free to disagree about which one is current. `sequence` is the
   * monotonic counter assigned by `createSession`.
   */
  async runningSessions(): Promise<LocalSession[]> {
    const running = await this.db.sessions
      .where('status')
      .equals(SESSION_STATUS.RUNNING)
      .toArray()
    return running.sort((a, b) => b.sequence - a.sequence)
  }

  /**
   * How many lines each session holds, keyed by sessionId. One pass over the table instead of one
   * query per session, because the send-status screen needs the count for every row at once.
   * Sessions with no lines are absent from the map, so read it with `?? 0`.
   */
  async countItemsBySession(): Promise<Map<string, number>> {
    const counts = new Map<string, number>()
    // `eachKey` over the sessionId index, not `each` over the table: the only field needed is the
    // key itself, and `each` deserializes every full record to read it. On a device holding a few
    // hundred unpurged documents that is tens of thousands of objects materialised on the main
    // thread, on the one screen whose job is to answer "did my work land" quickly.
    await this.db.sessionItems.orderBy('sessionId').eachKey((key) => {
      const sessionId = String(key)
      counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1)
    })
    return counts
  }

  /**
   * The lines of one session. Everything the operator scans lives in IndexedDB from the first
   * scan, so a session survives the app being killed, the device being rebooted or a shift
   * ending, and can be picked up again where it stopped.
   */
  async sessionItems(sessionId: string): Promise<LocalSessionItem[]> {
    return this.db.sessionItems.where('sessionId').equals(sessionId).toArray()
  }

  /**
   * The session's line for one PO item, or `undefined` when it has none yet. At most one can exist:
   * `[sessionId+purchaseItemId]` is what `addOrIncrementLine` merges on.
   *
   * It exists so a caller can learn the line's state as the DATABASE has it, immediately before
   * adding to it — which is the only honest source for "was this line already flagged as manual?".
   * A live-query snapshot can be a Dexie tick behind, and for that question being behind is not
   * harmless: it would make undo clear a flag that an earlier pick had legitimately raised.
   */
  async findSessionLine(
    sessionId: string,
    purchaseItemId: string,
  ): Promise<LocalSessionItem | undefined> {
    return this.db.sessionItems
      .where('[sessionId+purchaseItemId]')
      .equals([sessionId, purchaseItemId])
      .first()
  }

  async addOrIncrementLine(sessionId: string, input: NewLineInput): Promise<LocalSessionItem> {
    // One transaction: two concurrent adds for the same PO item must merge into one line.
    return this.db.transaction('rw', [this.db.sessionItems, this.db.sessions], async () => {
      const existing = await this.db.sessionItems
        .where('[sessionId+purchaseItemId]')
        .equals([sessionId, input.purchaseItemId])
        .first()

      if (existing) {
        // The manual flag only ever goes UP here. A line that once received qty without a barcode
        // keeps saying so even when later scans add to it, because that is what the flag claims:
        // "part of this qty was never scanned". The only place it comes back down is undo of the
        // addition that raised it (`handleUndo` in routes/sessions/$sessionId.tsx), through
        // `setLinePickedManually` below.
        const updated: LocalSessionItem = {
          ...existing,
          qty: dec2(existing.qty + input.qty),
          pickedManually: existing.pickedManually || Boolean(input.pickedManually),
        }
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
        pickedManually: Boolean(input.pickedManually),
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

  /**
   * Sets the manual flag on one line. The ONLY caller is undo in the scan cockpit, and the only
   * value it ever passes is `false`: a pick that is taken back must not leave a line claiming that
   * part of its qty was never scanned when, after the undo, all of it was. A badge that lies is
   * worse than no badge, because the whole point of the flag is the audit trail.
   *
   * A separate write rather than a parameter on `setLineQty`: the two are independent, every other
   * caller of `setLineQty` would have to learn about a flag it has no opinion on, and the worst case
   * when this second write fails is a line that stays flagged — the conservative direction.
   */
  async setLinePickedManually(lineId: string, pickedManually: boolean): Promise<void> {
    await this.db.transaction('rw', [this.db.sessionItems, this.db.sessions], async () => {
      const line = await this.db.sessionItems.get(lineId)
      if (!line) return
      await this.db.sessionItems.put({ ...line, pickedManually })
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

  /**
   * Closes a session for editing and puts it in the outbox, where it waits to be pushed. This
   * is the point of no return for the operator: the invoice and DO numbers are required here
   * because the server will not accept the document without them.
   */
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

  /**
   * The outbox: sessions waiting to be pushed, oldest first by `sequence`.
   *
   * The order is load-bearing. One push carries a limited number of sessions, so without
   * oldest-first a device with a long queue could starve its earliest delivery indefinitely.
   *
   * SYNCING is deliberately absent. Sync runs never overlap, so anything still marked SYNCING
   * is a leftover from a crashed run; `resetStaleSyncingSessions` returns those to PENDING at
   * the start of every run, which is what puts them back in this list.
   */
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
   * Records the server's answer: the official id and document number, after which the session
   * is read-only on the device — it exists centrally now and local edits would be a lie.
   *
   * Idempotent and atomic. A session that is already SYNCED is left untouched, because the
   * same answer arriving twice (a replay, a retried push) would otherwise count its qty into
   * the local received totals a second time.
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

  /**
   * A TEMPORARY failure: the session stays in the queue with its lines intact and is retried
   * on the next sync. Nothing is ever deleted here — being offline, or a server having a bad
   * minute, must not cost the operator a delivery they already counted.
   */
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

  /**
   * Frees storage by deleting sessions that are already in the central system. Only SYNCED
   * ones: anything still in the queue exists on this device and nowhere else. The screen asks
   * the operator to confirm first, since nothing here can be undone.
   */
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

  /* --------- Progress: how much of a PO has been received so far --------- */

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

  /**
   * Drops the cached credentials of users the server has revoked. Takes a list, because
   * revocation covers every user cached on this shared PDT and not just whoever is signed in.
   */
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
