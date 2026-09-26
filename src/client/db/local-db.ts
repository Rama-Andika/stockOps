import Dexie, { type Table } from 'dexie'
import type { SessionStatus } from '~/shared/constants'

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
 * Kredensial offline per (device, user) — FR-1.4.
 * Password TIDAK disimpan; hanya hash bersalt + fingerprint (BR-19).
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
  userId: string
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
  createdAt: string
}

export interface LocalMeta {
  key: string
  value: string
}

export interface LocalSyncLogEntry {
  id?: number
  at: string
  level: 'info' | 'error'
  message: string
  sessionId?: string
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
  }
}

/**
 * Instance Dexie dibuat LAZAT. Alasannya penting: shell SPA TanStack Start
 * di-prerender di Node (tanpa `indexedDB`), sehingga modul ini tidak boleh
 * membuat koneksi IndexedDB saat di-import.
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
