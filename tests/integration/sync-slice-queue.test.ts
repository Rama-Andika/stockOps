import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppStore } from '~/app/store/app-store'
import * as engine from '~/features/sync/engine'
import type { SyncOutcome } from '~/features/sync/engine'

// The store only talks to the server through the engine; replace both so the test controls
// exactly when each task starts and finishes.
vi.mock('~/features/sync/transport', () => ({
  serverTransport: { login: vi.fn(), checkCredentials: vi.fn(), pull: vi.fn(), push: vi.fn() },
}))
vi.mock('~/features/sync/engine', () => ({
  countPendingSessions: vi.fn(async () => 0),
  pullAllData: vi.fn(),
  refreshPurchases: vi.fn(),
  syncOutbox: vi.fn(),
}))

const syncOutbox = vi.mocked(engine.syncOutbox)
const pullAllData = vi.mocked(engine.pullAllData)
const refreshPurchases = vi.mocked(engine.refreshPurchases)

const EMPTY_OUTCOME: SyncOutcome = {
  attempted: 0,
  synced: 0,
  failed: 0,
  revokedUserIds: [],
  results: [],
}
const REFRESHED = { purchases: 2, purchaseItems: 4, removedCount: 0, removedNumbers: [] }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/**
 * Lets pending promise callbacks run. Only used for NEGATIVE checks ("has not started"), AFTER a
 * positive condition was awaited with vi.waitFor, so a slow machine can only make it stricter.
 */
const tick = () => new Promise<void>((done) => setTimeout(done, 20))

beforeEach(() => {
  // isBrowser() needs `window` + `indexedDB`; the store also reads localStorage and navigator.onLine.
  vi.stubGlobal('window', {
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  })
  vi.stubGlobal('navigator', { onLine: true })
  pullAllData.mockResolvedValue({ counts: {}, pulledAt: new Date().toISOString() })
  refreshPurchases.mockResolvedValue(REFRESHED)
  syncOutbox.mockResolvedValue(EMPTY_OUTCOME)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('antrean eksklusif sync / unduh / refresh PO', () => {
  it('refreshPurchases baru mulai setelah sync yang sedang berjalan selesai', async () => {
    const order: string[] = []
    const gate = deferred<SyncOutcome>()
    syncOutbox.mockImplementation(async () => {
      order.push('sync:start')
      const outcome = await gate.promise
      order.push('sync:end')
      return outcome
    })
    refreshPurchases.mockImplementation(async () => {
      order.push('refresh:start')
      order.push('refresh:end')
      return REFRESHED
    })

    const store = createAppStore()
    const syncRun = store.getState().sync()
    const refreshRun = store.getState().refreshPurchases()

    await vi.waitFor(() => expect(order).toEqual(['sync:start']))
    await tick()
    expect(order).toEqual(['sync:start']) // refresh is still waiting its turn

    gate.resolve(EMPTY_OUTCOME)
    await Promise.all([syncRun, refreshRun])
    expect(order).toEqual(['sync:start', 'sync:end', 'refresh:start', 'refresh:end'])
  })

  it('downloadData menunggu sync, tetapi tombol langsung ditandai berjalan', async () => {
    const gate = deferred<SyncOutcome>()
    syncOutbox.mockImplementation(() => gate.promise)

    const store = createAppStore()
    const syncRun = store.getState().sync()
    const downloadRun = store.getState().downloadData()

    await vi.waitFor(() => expect(syncOutbox).toHaveBeenCalledTimes(1))
    await tick()
    expect(store.getState().pullProgress.running).toBe(true) // disabled at once
    expect(pullAllData).not.toHaveBeenCalled() // but the download has not started yet

    gate.resolve(EMPTY_OUTCOME)
    await Promise.all([syncRun, downloadRun])
    expect(pullAllData).toHaveBeenCalledTimes(1)
    expect(store.getState().pullProgress.running).toBe(false)
  })

  it('panggilan refreshPurchases berulang bergabung menjadi satu unduhan', async () => {
    const gate = deferred<typeof REFRESHED>()
    refreshPurchases.mockImplementation(() => gate.promise)

    const store = createAppStore()
    const first = store.getState().refreshPurchases()
    const second = store.getState().refreshPurchases()
    expect(second).toBe(first)

    gate.resolve(REFRESHED)
    await Promise.all([first, second])
    expect(refreshPurchases).toHaveBeenCalledTimes(1)

    // After it finished, a new call starts a new refresh.
    await store.getState().refreshPurchases()
    expect(refreshPurchases).toHaveBeenCalledTimes(2)
  })

  it('panggilan downloadData berulang bergabung menjadi satu unduhan', async () => {
    const gate = deferred<{ counts: Record<string, number>; pulledAt: string }>()
    pullAllData.mockImplementation(() => gate.promise)

    const store = createAppStore()
    const first = store.getState().downloadData()
    const second = store.getState().downloadData()
    expect(second).toBe(first)

    gate.resolve({ counts: {}, pulledAt: new Date().toISOString() })
    await Promise.all([first, second])
    expect(pullAllData).toHaveBeenCalledTimes(1)
    expect(store.getState().pullProgress.running).toBe(false)
  })

  it('setelah unduhan gagal, penanda berjalan dan antrean kembali bersih', async () => {
    pullAllData.mockRejectedValueOnce(new Error('Koneksi terputus'))
    const store = createAppStore()

    const failed = await store.getState().downloadData()
    expect(failed).toEqual({ ok: false, message: 'Koneksi terputus' })
    expect(store.getState().pullProgress.running).toBe(false)

    const again = await store.getState().downloadData() // a fresh download, not the old promise
    expect(again.ok).toBe(true)
    expect(pullAllData).toHaveBeenCalledTimes(2)
  })

  it('subscriber store yang melempar tidak membuat downloadData tersangkut di promise lama', async () => {
    const store = createAppStore()
    let armed = true
    store.subscribe((state) => {
      // Throws exactly once: when the download finishes and "running" flips back to false.
      if (armed && !state.pullProgress.running) {
        armed = false
        throw new Error('subscriber error')
      }
    })

    await expect(store.getState().downloadData()).rejects.toThrow('subscriber error')

    const again = await store.getState().downloadData()
    expect(again.ok).toBe(true)
    expect(pullAllData).toHaveBeenCalledTimes(2) // the second call really downloaded again
  })

  it('refreshPurchases yang gagal tidak meninggalkan promise lama', async () => {
    refreshPurchases.mockRejectedValueOnce(new Error('Koneksi terputus'))
    const store = createAppStore()

    const failed = await store.getState().refreshPurchases()
    expect(failed.ok).toBe(false)

    const again = await store.getState().refreshPurchases()
    expect(again.ok).toBe(true)
    expect(refreshPurchases).toHaveBeenCalledTimes(2)
  })

  it('tugas yang gagal tidak memblokir tugas berikutnya', async () => {
    syncOutbox.mockRejectedValueOnce(new Error('Dexie error'))
    const store = createAppStore()
    await expect(store.getState().sync()).rejects.toThrow('Dexie error')
    expect(store.getState().syncing).toBe(false)

    const result = await store.getState().sync()
    expect(result.ok).toBe(true) // the queue is alive and the next sync ran normally
    expect(syncOutbox).toHaveBeenCalledTimes(2)
  })
})
