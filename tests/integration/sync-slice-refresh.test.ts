import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localRepo } from '~/data/local-repo'
import { createAppStore } from '~/app/store/app-store'
import * as engine from '~/features/sync/engine'
import type { SyncOutcome } from '~/features/sync/engine'
import { PURCHASES_STALE_META_KEY } from '~/core/contracts/constants'

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
const refreshPurchases = vi.mocked(engine.refreshPurchases)

const EMPTY_OUTCOME: SyncOutcome = {
  attempted: 0,
  synced: 0,
  failed: 0,
  revokedUserIds: [],
  results: [],
}

/** One session answered with IDEMPOTENT_REPLAY: the PO list must be refreshed from the server. */
const REPLAY_OUTCOME: SyncOutcome = {
  attempted: 1,
  synced: 1,
  failed: 0,
  revokedUserIds: [],
  results: [
    {
      sessionId: 'session-replay-1',
      status: 'SYNCED',
      receiveId: '1',
      number: 'IN10250001',
      overReceive: false,
      excessTotal: 0,
      lines: [],
      code: 'IDEMPOTENT_REPLAY',
    },
  ],
}

beforeEach(async () => {
  vi.stubGlobal('window', {
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  })
  vi.stubGlobal('navigator', { onLine: true })
  await localRepo.setMeta(PURCHASES_STALE_META_KEY, '0')
  syncOutbox.mockResolvedValue(EMPTY_OUTCOME)
  refreshPurchases.mockResolvedValue({
    purchases: 2,
    purchaseItems: 4,
    removedCount: 0,
    removedNumbers: [],
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('refresh PO setelah sync (replay)', () => {
  it('kegagalan refresh dicatat, diberitahukan ke operator, dan tidak menggagalkan sync', async () => {
    syncOutbox.mockResolvedValue(REPLAY_OUTCOME)
    refreshPurchases.mockRejectedValue(new Error('Koneksi terputus'))

    const result = await createAppStore().getState().sync()

    expect(result.ok).toBe(true) // the session itself was synced
    expect(result.message).toContain('1 sesi tersinkron')
    expect(result.message).toContain('Daftar PO belum diperbarui')
    expect(await localRepo.getMeta(PURCHASES_STALE_META_KEY)).toBe('1')
    const logs = await localRepo.db.syncLog.toArray()
    expect(logs.some((entry) => entry.message.includes('Refresh PO gagal'))).toBe(true)
  })

  it('sync berikutnya mengulang refresh walau tidak ada sesi, lalu membersihkan penanda', async () => {
    await localRepo.setMeta(PURCHASES_STALE_META_KEY, '1')
    syncOutbox.mockResolvedValue(EMPTY_OUTCOME)

    const result = await createAppStore().getState().sync()

    expect(refreshPurchases).toHaveBeenCalledTimes(1)
    expect(await localRepo.getMeta(PURCHASES_STALE_META_KEY)).toBe('0')
    expect(result.message).toBe('Tidak ada data yang perlu dikirim.')
  })

  it('refresh yang masih gagal pada percobaan ulang membiarkan penanda menyala', async () => {
    await localRepo.setMeta(PURCHASES_STALE_META_KEY, '1')
    refreshPurchases.mockRejectedValue(new Error('Masih offline'))

    const result = await createAppStore().getState().sync()

    expect(await localRepo.getMeta(PURCHASES_STALE_META_KEY)).toBe('1')
    expect(result.message).toContain('Daftar PO belum diperbarui')
  })

  it('penanda sudah menyala SELAMA refresh berjalan dan dibersihkan setelah berhasil', async () => {
    // Crash safety: if the app dies in the middle of the refresh, the flag is already there.
    syncOutbox.mockResolvedValue(REPLAY_OUTCOME)
    let flagDuringRefresh: string | null = null
    refreshPurchases.mockImplementation(async () => {
      flagDuringRefresh = await localRepo.getMeta(PURCHASES_STALE_META_KEY)
      return { purchases: 2, purchaseItems: 4, removedCount: 0, removedNumbers: [] }
    })

    const result = await createAppStore().getState().sync()

    expect(flagDuringRefresh).toBe('1')
    expect(await localRepo.getMeta(PURCHASES_STALE_META_KEY)).toBe('0')
    expect(result.message).not.toContain('Daftar PO belum diperbarui')
  })

  it('setelah push gagal (outcome.error), refresh tidak diulang dan penanda tetap menyala', async () => {
    await localRepo.setMeta(PURCHASES_STALE_META_KEY, '1')
    syncOutbox.mockResolvedValue({
      ...EMPTY_OUTCOME,
      attempted: 1,
      failed: 1,
      error: 'Sinkronisasi melebihi batas waktu (timeout).',
    })

    const result = await createAppStore().getState().sync()

    expect(refreshPurchases).not.toHaveBeenCalled()
    expect(await localRepo.getMeta(PURCHASES_STALE_META_KEY)).toBe('1')
    expect(result.ok).toBe(false)
  })

  it('user aktif dicabut: refresh dilewati tetapi diingat untuk sync berikutnya', async () => {
    const store = createAppStore()
    store.setState({
      user: { userId: '1200001', loginId: 'pdt', fullName: 'PDT', companyId: '0' },
    })
    syncOutbox.mockResolvedValue({
      ...REPLAY_OUTCOME,
      revokedUserIds: ['1200001'],
    })

    await store.getState().sync()

    expect(refreshPurchases).not.toHaveBeenCalled()
    expect(await localRepo.getMeta(PURCHASES_STALE_META_KEY)).toBe('1')
  })

  it('tanpa replay dan tanpa penanda, daftar PO tidak diunduh ulang', async () => {
    syncOutbox.mockResolvedValue({ ...EMPTY_OUTCOME, attempted: 1, synced: 1 })

    await createAppStore().getState().sync()

    expect(refreshPurchases).not.toHaveBeenCalled()
  })
})
