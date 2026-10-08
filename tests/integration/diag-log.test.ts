import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StockOpsDb } from '~/data/local-db'
import { LocalRepository } from '~/data/local-repo'
import { DIAG_EVENT, DIAG_MESSAGE_MAX } from '~/core/contracts/diag-events'
import { SESSION_STATUS } from '~/core/contracts/constants'

/**
 * Jejak diagnostik adalah satu-satunya hal yang dibaca tim IT ketika sebuah dokumen tidak muncul
 * di admin. Tiga sifatnya load-bearing dan masing-masing diuji di sini: urutannya memakai `id`
 * (bukan jam perangkat yang bisa salah), saringan "hanya masalah" tetap urut waktu walau berjalan
 * di atas index `level`, dan ring buffer membuang yang TERTUA — bukan yang terbaru.
 */

let db: StockOpsDb
let repo: LocalRepository

beforeEach(() => {
  db = new StockOpsDb(`stockops_diag_${Math.random().toString(36).slice(2)}`)
  repo = new LocalRepository(db)
})

afterEach(async () => {
  await db.delete()
})

async function logInfo(message: string): Promise<void> {
  await repo.logEvent({
    level: 'info',
    category: 'sync',
    event: DIAG_EVENT.PUSH_RUN,
    message,
  })
}

describe('logEvent', () => {
  it('menyimpan level, kategori, event, sesi, dan detail', async () => {
    await repo.logEvent({
      level: 'error',
      category: 'sync',
      event: DIAG_EVENT.PUSH_SESSION_REJECTED,
      message: 'Sesi ditolak server (VALIDATION): qty tidak valid',
      sessionId: 'S1',
      detail: { code: 'VALIDATION', lines: 3, qty: 12 },
    })

    const rows = await db.syncLog.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      level: 'error',
      category: 'sync',
      event: 'PUSH_SESSION_REJECTED',
      sessionId: 'S1',
      detail: { code: 'VALIDATION', lines: 3, qty: 12 },
    })
    expect(rows[0]?.at).toBeTruthy()
  })

  it('memotong pesan yang terlalu panjang', async () => {
    await logInfo('x'.repeat(DIAG_MESSAGE_MAX + 50))

    const rows = await db.syncLog.toArray()
    expect(rows[0]?.message).toHaveLength(DIAG_MESSAGE_MAX)
  })
})

describe('recentLogEntries', () => {
  it('mengembalikan yang terbaru lebih dulu, berdasarkan id', async () => {
    await logInfo('pertama')
    await logInfo('kedua')
    await logInfo('ketiga')

    const rows = await repo.recentLogEntries(10)
    expect(rows.map((row) => row.message)).toEqual(['ketiga', 'kedua', 'pertama'])
  })

  it('menghormati limit', async () => {
    await logInfo('a')
    await logInfo('b')
    await logInfo('c')

    expect(await repo.recentLogEntries(2)).toHaveLength(2)
  })

  it('saringan masalah tetap urut waktu walau entri terbaru semuanya info', async () => {
    await repo.logEvent({
      level: 'warn',
      category: 'pull',
      event: DIAG_EVENT.REFRESH_PO_FAILED,
      message: 'warn lama',
    })
    await repo.logEvent({
      level: 'error',
      category: 'sync',
      event: DIAG_EVENT.PUSH_TRANSPORT_FAILED,
      message: 'error baru',
    })
    // Lima entri info sesudahnya: implementasi yang mengandalkan `reverse()` di atas index
    // `level` akan mengembalikan urutan yang salah di sini.
    for (let index = 0; index < 5; index += 1) await logInfo(`info ${index}`)

    const problems = await repo.recentLogEntries(10, true)
    expect(problems.map((row) => row.message)).toEqual(['error baru', 'warn lama'])
  })

  /**
   * `limit` membatasi HASIL, bukan pemindaian. Implementasinya memakai
   * `reverse().filter(...).limit(n)`, jadi kalau `limit` ternyata memotong kursor lebih dulu,
   * pencarian ini akan mengembalikan nol baris — bukan dua — karena tiga puluh entri terbaru
   * semuanya `info`. Test inilah yang memagari semantik itu.
   */
  it('limit menghitung kecocokan, bukan baris yang dilewati', async () => {
    for (const message of ['warn 1', 'error 1', 'warn 2']) {
      await repo.logEvent({
        level: message.startsWith('warn') ? 'warn' : 'error',
        category: 'sync',
        event: DIAG_EVENT.PUSH_SESSION_FAILED,
        message,
      })
    }
    for (let index = 0; index < 30; index += 1) await logInfo(`info ${index}`)

    const problems = await repo.recentLogEntries(2, true)
    expect(problems.map((row) => row.message)).toEqual(['warn 2', 'error 1'])
  })
})

describe('countLogEntries & countProblemLogEntries', () => {
  it('menghitung semua entri dan entri bermasalah secara terpisah', async () => {
    await logInfo('a')
    await repo.logEvent({
      level: 'warn',
      category: 'sync',
      event: DIAG_EVENT.PUSH_SESSION_FAILED,
      message: 'b',
    })
    await repo.logEvent({
      level: 'error',
      category: 'app',
      event: DIAG_EVENT.UNHANDLED_ERROR,
      message: 'c',
    })

    expect(await repo.countLogEntries()).toBe(3)
    expect(await repo.countProblemLogEntries()).toBe(2)
  })
})

describe('pruneSyncLog', () => {
  it('menyisakan entri terbaru dan membuang yang tertua', async () => {
    for (let index = 0; index < 10; index += 1) await logInfo(`entri ${index}`)

    const removed = await repo.pruneSyncLog(4)

    expect(removed).toBe(6)
    const rows = await repo.recentLogEntries(10)
    expect(rows.map((row) => row.message)).toEqual(['entri 9', 'entri 8', 'entri 7', 'entri 6'])
  })

  it('tidak melakukan apa pun saat jumlah entri masih di bawah batas', async () => {
    await logInfo('a')

    expect(await repo.pruneSyncLog(100)).toBe(0)
    expect(await repo.countLogEntries()).toBe(1)
  })
})

describe('clearSyncLog', () => {
  it('mengosongkan tabel dan melaporkan jumlah yang terhapus', async () => {
    await logInfo('a')
    await logInfo('b')

    expect(await repo.clearSyncLog()).toBe(2)
    expect(await repo.countLogEntries()).toBe(0)
  })
})

describe('sessionStatusCounts', () => {
  it('menghitung satu angka per status, termasuk status yang kosong', async () => {
    const first = await repo.createSession({ purchaseId: 'P1', userId: 'U1', deviceId: 'D1' })
    const second = await repo.createSession({ purchaseId: 'P1', userId: 'U1', deviceId: 'D1' })
    await repo.setSessionStatus(second.sessionId, SESSION_STATUS.FAILED)

    const counts = await repo.sessionStatusCounts()

    expect(counts[SESSION_STATUS.RUNNING]).toBe(1)
    expect(counts[SESSION_STATUS.FAILED]).toBe(1)
    expect(counts[SESSION_STATUS.REJECTED]).toBe(0)
    expect(first.status).toBe(SESSION_STATUS.RUNNING)
  })
})
