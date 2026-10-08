import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { StockOpsDb } from '~/data/local-db'
import { LocalRepository } from '~/data/local-repo'

/**
 * The v2 schema, copied from local-db.ts as it was BEFORE `pickedManually` existed. It is written
 * out literally on purpose: importing the current schema would make this test open a database that
 * is already v3, and then the upgrade path — the only thing under test — never runs. Same reasoning
 * as tests/integration/session-owner-migration.test.ts.
 */
const V2_STORES = {
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

/** A session line exactly as v2 wrote it: no `pickedManually` at all. */
function legacyLine(lineId: string) {
  return {
    lineId,
    sessionId: 'S1',
    purchaseItemId: `PI-${lineId}`,
    itemMasterId: 'IM1',
    barcode: '8991002103458',
    qty: 3,
    uomPurchaseId: 'U-KRT',
    uomId: 'U-PCS',
    convQty: 12,
    convFound: true,
    createdAt: '2026-10-06T01:00:00.000Z',
  }
}

/** The line input shared by the tests below; only `pickedManually` varies. */
const SCAN_INPUT = {
  purchaseItemId: 'PI1',
  itemMasterId: 'IM1',
  barcode: '8991002103458',
  qty: 2,
  uomPurchaseId: 'U-KRT',
  uomId: 'U-PCS',
  convQty: 12,
  convFound: true,
}

const PICK_INPUT = { ...SCAN_INPUT, barcode: null, qty: 5, pickedManually: true }

let db: StockOpsDb | undefined

afterEach(async () => {
  if (db) await db.delete()
  db = undefined
})

function freshName(): string {
  return `stockops_pick_${Math.random().toString(36).slice(2)}`
}

describe('migrasi Dexie v2 → v3', () => {
  it('mengisi pickedManually = false pada setiap baris yang sudah ada', async () => {
    const name = freshName()
    const legacy = new Dexie(name)
    legacy.version(2).stores(V2_STORES)
    await legacy.open()
    await legacy.table('sessionItems').bulkPut([legacyLine('L1'), legacyLine('L2')])
    legacy.close()

    db = new StockOpsDb(name)
    await db.open()

    const rows = await db.sessionItems.toArray()
    expect(rows).toHaveLength(2)
    // Eksplisit `false`, bukan undefined: tipe tersimpan mendeklarasikannya wajib, dan setiap baris
    // yang ditulis sebelum fitur ini ada memang berasal dari scan.
    expect(rows.map((row) => row.pickedManually)).toEqual([false, false])
  })

  it('pemasangan baru langsung v3 tanpa menjalankan upgrade', async () => {
    db = new StockOpsDb(freshName())
    await db.open()
    const repo = new LocalRepository(db)

    const line = await repo.addOrIncrementLine('S1', SCAN_INPUT)
    expect(line.pickedManually).toBe(false)
  })
})

describe('flag manual pada baris sesi', () => {
  /**
   * `addOrIncrementLine` tidak memvalidasi apa pun dan `touchSession` berhenti diam-diam bila sesinya
   * tidak ada, jadi test-test ini tidak perlu membuat sesi maupun data master. Yang diuji memang
   * hanya penggabungan baris.
   */
  function repoOn(name: string): LocalRepository {
    db = new StockOpsDb(name)
    return new LocalRepository(db)
  }

  it('scan lalu pilih manual: qty digabung dan flag menyala', async () => {
    const repo = repoOn(freshName())

    await repo.addOrIncrementLine('S1', SCAN_INPUT)
    const merged = await repo.addOrIncrementLine('S1', PICK_INPUT)

    expect(merged.qty).toBe(7)
    expect(merged.pickedManually).toBe(true)
    // Satu baris, karena index [sessionId+purchaseItemId] memang unik — inilah alasan flag-nya
    // harus sticky dan bukan "asal qty terakhir".
    expect(await repo.sessionItems('S1')).toHaveLength(1)
  })

  it('pilih manual lalu scan: flag TETAP menyala', async () => {
    const repo = repoOn(freshName())

    await repo.addOrIncrementLine('S1', PICK_INPUT)
    const merged = await repo.addOrIncrementLine('S1', SCAN_INPUT)

    expect(merged.qty).toBe(7)
    // Scan tidak boleh menghapus jejak bahwa sebagian qty baris ini pernah masuk tanpa barcode.
    expect(merged.pickedManually).toBe(true)
  })

  it('dua scan tidak pernah menyalakan flag', async () => {
    const repo = repoOn(freshName())

    await repo.addOrIncrementLine('S1', SCAN_INPUT)
    const merged = await repo.addOrIncrementLine('S1', SCAN_INPUT)

    expect(merged.qty).toBe(4)
    expect(merged.pickedManually).toBe(false)
  })

  it('setLinePickedManually menurunkan flag — jalur undo', async () => {
    const repo = repoOn(freshName())

    const line = await repo.addOrIncrementLine('S1', PICK_INPUT)
    expect(line.pickedManually).toBe(true)

    await repo.setLinePickedManually(line.lineId, false)

    const [stored] = await repo.sessionItems('S1')
    expect(stored?.pickedManually).toBe(false)
    // Qty tidak ikut tersentuh: undo mengurangi qty lewat setLineQty, dan ini hanya soal flag.
    expect(stored?.qty).toBe(5)
  })

  it('setLinePickedManually pada baris yang sudah hilang tidak melempar', async () => {
    const repo = repoOn(freshName())

    await expect(repo.setLinePickedManually('tidak-ada', false)).resolves.toBeUndefined()
  })

  /**
   * `findSessionLine` adalah sumber `pickedBefore` di `processPick`, dan itu satu-satunya alasan
   * method ini ada. Yang dikunci di sini: ia melihat keadaan SESUDAH penambahan sebelumnya, sehingga
   * pick kedua tahu flag-nya sudah menyala dan undo-nya tidak akan menurunkannya.
   *
   * Sebelum perbaikan ini nilai itu dibaca dari snapshot live-query saat baris diketuk; snapshot yang
   * tertinggal satu tick berisi `false`, dan `clearPickedOnUndo = !pickedBefore` membuat undo MENGHAPUS
   * flag pada baris yang qty sisanya tidak pernah discan.
   */
  it('findSessionLine membaca flag SESUDAH penambahan sebelumnya — sumber pickedBefore', async () => {
    const repo = repoOn(freshName())

    expect(await repo.findSessionLine('S1', 'PI1')).toBeUndefined()

    await repo.addOrIncrementLine('S1', PICK_INPUT)
    // Inilah yang dilihat pick KEDUA untuk item yang sama: sudah menyala, jadi pick kedua tidak
    // boleh mengaku dirinya yang menyalakannya.
    expect((await repo.findSessionLine('S1', 'PI1'))?.pickedManually).toBe(true)

    await repo.addOrIncrementLine('S1', PICK_INPUT)
    const merged = await repo.findSessionLine('S1', 'PI1')
    expect(merged?.qty).toBe(10)
    expect(merged?.pickedManually).toBe(true)
  })

  it('findSessionLine tidak tercampur antar sesi maupun antar item PO', async () => {
    const repo = repoOn(freshName())

    await repo.addOrIncrementLine('S1', SCAN_INPUT)

    expect(await repo.findSessionLine('S2', 'PI1')).toBeUndefined()
    expect(await repo.findSessionLine('S1', 'PI2')).toBeUndefined()
    expect((await repo.findSessionLine('S1', 'PI1'))?.qty).toBe(2)
  })
})
