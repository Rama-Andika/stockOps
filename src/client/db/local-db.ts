import Dexie, { type Table } from 'dexie'
import type { SessionStatus } from '~/shared/constants'
import type { DiagCategory, DiagDetail, DiagLevel } from '~/client/diagnostics/events'

export interface LocalPurchase {
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
  updatedAt: string
}

export interface LocalPurchaseItem {
  purchaseItemId: string
  purchaseId: string
  itemMasterId: string
  qty: string
  uomId: string
  receivedQty: string
  updatedAt: string
}

export interface LocalItem {
  itemMasterId: string
  code: string | null
  barcode: string | null
  barcode2: string | null
  barcode3: string | null
  name: string
  uomStockId: string
  uomPurchaseId: string
  updatedAt: string
}

export interface LocalUnit {
  uomId: string
  unit: string
  updatedAt: string
}

export interface LocalVendor {
  vendorId: string
  code: string | null
  name: string
  dueDate: string | null
  updatedAt: string
}

export interface LocalVendorItem {
  vendorItemId: string
  vendorId: string
  itemMasterId: string
  uomPurchase: string
  convQty: string
  updatedAt: string
}

/**
 * A cached credential, keyed per (device, user) because one PDT is shared between operators
 * and each of them must be able to log in offline on it.
 *
 * No password is stored — only its salted hash, plus the server-issued fingerprint used to
 * detect that the password has since been changed in the admin system.
 */
export interface LocalCredential {
  key: string
  deviceId: string
  userId: string
  loginId: string
  fullName: string
  companyId: string
  salt: string
  passwordHash: string
  iterations: number
  fingerprint: string
  lastOnlineLoginAt: string
  expiresAt: string
}

export interface LocalSession {
  sessionId: string
  purchaseId: string
  /** PO number (denormalized) so it displays even if the PO is deleted/CLOSED. */
  purchaseNumber: string | null
  /** Vendor name (denormalized). */
  vendorName: string | null
  userId: string
  /**
   * Owner name, denormalized when the session is created — not looked up at render time. The
   * credential it comes from is deleted from the device when the admin revokes that user
   * (`removeCredentialsForUsers`), and a document should still name the operator who received the
   * goods. `null` only for rows the v1 -> v2 migration could not resolve.
   */
  userFullName: string | null
  userLoginId: string | null
  deviceId: string
  status: SessionStatus
  invoiceNumber: string
  doNumber: string
  receiveDate: string
  createdAt: string
  updatedAt: string
  finalizedAt: string | null
  syncedAt: string | null
  receiveId: string | null
  number: string | null
  lastError: string | null
  failureCode: string | null
  overReceive: boolean
  excessTotal: number
  sequence: number
}

export interface LocalSessionItem {
  lineId: string
  sessionId: string
  purchaseItemId: string
  itemMasterId: string
  barcode: string | null
  qty: number
  uomPurchaseId: string
  uomId: string
  convQty: number
  convFound: boolean
  /**
   * True when any part of this line's qty was added WITHOUT a scan, from the PO item list.
   *
   * Sticky on purpose, and it means "part of this qty was never verified against a barcode", NOT
   * "the current qty is manual": `addOrIncrementLine` merges a scan and a pick for the same PO item
   * into ONE row (unique index `[sessionId+purchaseItemId]`), so a single row can hold qty from both
   * paths. It is only ever lowered again by undoing the very addition that raised it.
   *
   * LOCAL ONLY. `buildSessionPayload` maps session line fields one by one, so this never reaches
   * the server, and `pos_receive_item.memo` keeps carrying only `PDT|OVER`.
   */
  pickedManually: boolean
  createdAt: string
}

export interface LocalMeta {
  key: string
  value: string
}

export interface LocalSyncLogEntry {
  id?: number
  at: string
  level: DiagLevel
  message: string
  sessionId?: string
  /**
   * Which part of the app wrote this entry. Optional because rows written before this existed
   * have none, and because no Dexie version was added to backfill them: these three fields are
   * NOT indexed, and Dexie needs declarations for indexes, not for stored fields.
   */
  category?: DiagCategory
  /**
   * Stable machine code for the kind of event (see DIAG_EVENT). Typed as a plain string rather
   * than as DiagEvent on purpose: every WRITE goes through DiagEntryInput and is checked there,
   * while what comes back OUT of IndexedDB is whatever some app version once wrote — including
   * codes since dropped from the enum.
   */
  event?: string
  /** Small flat payload; see DiagDetail for what may and may not go in it. */
  detail?: DiagDetail
}

export class StockOpsDb extends Dexie {
  purchases!: Table<LocalPurchase, string>
  purchaseItems!: Table<LocalPurchaseItem, string>
  items!: Table<LocalItem, string>
  units!: Table<LocalUnit, string>
  vendors!: Table<LocalVendor, string>
  vendorItems!: Table<LocalVendorItem, string>
  credentials!: Table<LocalCredential, string>
  sessions!: Table<LocalSession, string>
  sessionItems!: Table<LocalSessionItem, string>
  meta!: Table<LocalMeta, string>
  syncLog!: Table<LocalSyncLogEntry, number>

  constructor(name = 'stockops') {
    super(name)
    this.version(1).stores({
      purchases: 'purchaseId, number, vendorName, status',
      purchaseItems: 'purchaseItemId, purchaseId, itemMasterId',
      items: 'itemMasterId, code, barcode, barcode2, barcode3',
      units: 'uomId, unit',
      vendors: 'vendorId, name',
      vendorItems: 'vendorItemId, vendorId, itemMasterId, [vendorId+itemMasterId], uomPurchase',
      credentials: 'key, userId, deviceId, expiresAt',
      sessions: 'sessionId, purchaseId, status, sequence, updatedAt',
      sessionItems: 'lineId, sessionId, purchaseItemId, [sessionId+purchaseItemId]',
      meta: 'key',
      syncLog: '++id, at, level',
    })

    // v2 only adds two NON-INDEXED fields to `sessions` (userFullName, userLoginId). Dexie needs
    // declarations for indexes, not for stored fields, so the store line below is deliberately
    // identical to v1: this version exists for the backfill, not for a schema change. It is
    // restated rather than omitted so the newest version's schema is readable in one place.
    //
    // No index on `userId` on purpose: both call sites that care about ownership already hold the
    // whole array in memory (`listSessions()` for the receiving list, `runningSessions()` for the
    // PO banner) and filter it with `splitByOwner`. An index nothing queries would only cost write
    // time on every scan.
    this.version(2)
      .stores({
        sessions: 'sessionId, purchaseId, status, sequence, updatedAt',
      })
      .upgrade(async (tx) => {
        // Runs ONLY when an existing v1 database is opened. A fresh install (and every
        // `new StockOpsDb(...)` in the tests) is created at v2 directly and never calls this.
        const credentials = await tx.table<LocalCredential>('credentials').toArray()
        const byUserId = new Map(credentials.map((row) => [row.userId, row]))
        await tx
          .table<LocalSession>('sessions')
          .toCollection()
          .modify((session) => {
            const credential = byUserId.get(session.userId)
            // Explicit null, never left undefined: a session whose owner credential was already
            // revoked and deleted must read as "Operator lain", and `ownerName` treats both the
            // same — but a stored null says the migration DID look.
            session.userFullName = credential?.fullName ?? null
            session.userLoginId = credential?.loginId ?? null
          })
      })

    // v3 adds ONE non-indexed field to `sessionItems` (pickedManually). Like v2, the store line
    // below is deliberately identical to the one above it: this version exists for the backfill,
    // not for a schema change. It is restated rather than omitted so the newest version's schema
    // stays readable in one place.
    //
    // No index on `pickedManually` on purpose: nothing queries by it. Both readers (the item tab
    // and the review recap) already hold the session's lines in memory, and an index nothing
    // queries would only cost write time on every single scan.
    this.version(3)
      .stores({
        sessionItems: 'lineId, sessionId, purchaseItemId, [sessionId+purchaseItemId]',
      })
      .upgrade(async (tx) => {
        // Runs ONLY when an existing v1/v2 database is opened. A fresh install (and every
        // `new StockOpsDb(...)` in the tests) is created at v3 directly and never calls this.
        //
        // Explicit `false`, never left undefined: every line written before this feature existed
        // came from a scan, and the type declares the field as required, so the UI may read it
        // without a fallback.
        await tx
          .table<LocalSessionItem>('sessionItems')
          .toCollection()
          .modify((line) => {
            line.pickedManually = false
          })
      })
  }
}

/**
 * Dexie instance is created LAZILY. Important reason: TanStack Start SPA shell
 * is prerendered in Node (without `indexedDB`), so this module must not
 * establish an IndexedDB connection upon import.
 */
let offlineDbInstance: StockOpsDb | undefined

export function getOfflineDb(): StockOpsDb {
  if (!offlineDbInstance) {
    offlineDbInstance = new StockOpsDb()
  }
  return offlineDbInstance
}

export function createTestDb(name: string): StockOpsDb {
  return new StockOpsDb(name)
}
