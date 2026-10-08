import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { StockOpsDb, type LocalSession } from '~/data/local-db'
import { SESSION_STATUS } from '~/core/contracts/constants'
import { canEditSession, ownerName } from '~/features/receiving/logic/session-owner'

/**
 * The v1 schema, copied from local-db.ts as it was BEFORE the owner fields were added. It is
 * written out literally on purpose: importing the current schema would make this test open a
 * database that is already v2, and then the upgrade path — the only thing under test — never
 * runs.
 */
const V1_STORES = {
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
}

/** A session row exactly as v1 wrote it: no userFullName, no userLoginId. */
function legacySession(sessionId: string, userId: string, sequence: number) {
  return {
    sessionId,
    purchaseId: 'P1',
    purchaseNumber: 'PO10250001',
    vendorName: 'CV Berkah Jaya',
    userId,
    deviceId: 'D1',
    status: SESSION_STATUS.RUNNING,
    invoiceNumber: '',
    doNumber: '',
    receiveDate: '2026-10-06 08:00:00',
    createdAt: '2026-10-06T01:00:00.000Z',
    updatedAt: '2026-10-06T01:00:00.000Z',
    finalizedAt: null,
    syncedAt: null,
    receiveId: null,
    number: null,
    lastError: null,
    failureCode: null,
    overReceive: false,
    excessTotal: 0,
    sequence,
  }
}

let db: StockOpsDb | undefined

afterEach(async () => {
  if (db) await db.delete()
  db = undefined
})

describe('migrasi Dexie v1 -> v2: nama pemilik sesi', () => {
  it('mengisi nama dari kredensial, dan null bila kredensialnya sudah tidak ada', async () => {
    const name = `stockops_owner_${Math.random().toString(36).slice(2)}`

    const legacy = new Dexie(name)
    legacy.version(1).stores(V1_STORES)
    await legacy.open()
    await legacy.table('credentials').put({
      key: 'D1:U1',
      deviceId: 'D1',
      userId: 'U1',
      loginId: 'op_budi',
      fullName: 'Budi Santoso',
      companyId: '10',
      salt: 'salt',
      passwordHash: 'hash',
      iterations: 1000,
      fingerprint: 'fp',
      lastOnlineLoginAt: '2026-10-01T00:00:00.000Z',
      expiresAt: '2026-10-08T00:00:00.000Z',
    })
    await legacy.table('sessions').bulkPut([
      legacySession('S1', 'U1', 1),
      // U9 has no credential on this device any more — exactly what happens after the admin
      // revokes a user and `removeCredentialsForUsers` deletes the row.
      legacySession('S2', 'U9', 2),
    ])
    legacy.close()

    db = new StockOpsDb(name)
    await db.open()
    expect(db.verno).toBeGreaterThanOrEqual(2)

    const resolved = (await db.sessions.get('S1')) as LocalSession
    expect(resolved.userFullName).toBe('Budi Santoso')
    expect(resolved.userLoginId).toBe('op_budi')
    expect(ownerName(resolved)).toBe('Budi Santoso')

    const orphan = (await db.sessions.get('S2')) as LocalSession
    // Null, bukan undefined: migrasinya memang sudah mencari dan tidak menemukan.
    expect(orphan.userFullName).toBeNull()
    expect(orphan.userLoginId).toBeNull()
    expect(ownerName(orphan)).toBe('Operator lain')

    // Aturannya langsung berlaku pada baris lama: pemilik boleh, yang lain tidak.
    expect(canEditSession(resolved, 'U1')).toBe(true)
    expect(canEditSession(resolved, 'U9')).toBe(false)
    expect(canEditSession(orphan, 'U1')).toBe(false)
  })

  it('migrasi tidak mengubah data sesi yang lain', async () => {
    const name = `stockops_owner_${Math.random().toString(36).slice(2)}`

    const legacy = new Dexie(name)
    legacy.version(1).stores(V1_STORES)
    await legacy.open()
    await legacy.table('sessions').put(legacySession('S1', 'U1', 7))
    legacy.close()

    db = new StockOpsDb(name)
    await db.open()
    const migrated = (await db.sessions.get('S1')) as LocalSession
    expect(migrated.sequence).toBe(7)
    expect(migrated.purchaseNumber).toBe('PO10250001')
    expect(migrated.status).toBe(SESSION_STATUS.RUNNING)
    expect(migrated.receiveDate).toBe('2026-10-06 08:00:00')
  })
})
