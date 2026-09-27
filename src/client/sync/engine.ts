import type { LocalRepository } from '../db/local-repo'
import type { LocalSession, LocalSessionItem } from '../db/local-db'
import type { SyncTransport } from './transport'
import { serverTransport } from './transport'
import { DEFAULT_PULL_CHUNK_SIZE, PERMANENT_REJECT_CODES, SESSION_STATUS } from '~/shared/constants'
import type { PullKind, ReceiveSessionInput, SyncSessionResult } from '~/shared/schemas'

export const PULL_KIND_ORDER: PullKind[] = [
  'units',
  'vendors',
  'items',
  'vendorItems',
  'purchases',
  'purchaseItems',
]

export interface PullProgressEvent {
  kind: PullKind
  fetched: number
  total: number
}

export interface PullSummary {
  counts: Record<string, number>
  pulledAt: string
}

/**
 * FR-2.1 / FR-2.2 / BR-16: unduh PENUH data master & PO CHECKED, bertahap
 * (chunking) dengan progres. Tidak menyentuh sesi penerimaan lokal.
 */
export async function pullAllData(
  repo: LocalRepository,
  transport: SyncTransport = serverTransport,
  options: { chunkSize?: number; onProgress?: (event: PullProgressEvent) => void } = {},
): Promise<PullSummary> {
  const chunkSize = options.chunkSize ?? DEFAULT_PULL_CHUNK_SIZE
  await repo.clearMasterData()

  const counts: Record<string, number> = {}
  for (const kind of PULL_KIND_ORDER) {
    let offset = 0
    let total = 0
    let fetched = 0
    // Batas iterasi sebagai pengaman agar tidak loop tanpa henti.
    for (let guard = 0; guard < 100_000; guard += 1) {
      const result = await transport.pull({ kind, offset, limit: chunkSize })
      total = result.total
      if (result.rows.length > 0) {
        await storeChunk(repo, kind, result.rows)
        fetched += result.rows.length
      }
      options.onProgress?.({ kind, fetched, total })
      if (result.nextOffset === null) break
      offset = result.nextOffset
    }
    counts[kind] = fetched || total
  }

  await repo.setMeta('lastPullAt', new Date().toISOString())
  return { counts, pulledAt: new Date().toISOString() }
}

async function storeChunk(
  repo: LocalRepository,
  kind: PullKind,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  switch (kind) {
    case 'purchases':
      await repo.upsertPurchases(rows as never)
      break
    case 'purchaseItems':
      await repo.upsertPurchaseItems(rows as never)
      break
    case 'items':
      await repo.upsertItems(rows as never)
      break
    case 'units':
      await repo.upsertUnits(rows as never)
      break
    case 'vendors':
      await repo.upsertVendors(rows as never)
      break
    case 'vendorItems':
      await repo.upsertVendorItems(rows as never)
      break
    default:
      break
  }
}

/** FR-2.3: menyegarkan daftar PO tanpa menyentuh sesi yang sedang berjalan. */
export async function refreshPurchases(
  repo: LocalRepository,
  transport: SyncTransport = serverTransport,
  options: { chunkSize?: number; onProgress?: (event: PullProgressEvent) => void } = {},
): Promise<{ purchases: number; purchaseItems: number }> {
  const chunkSize = options.chunkSize ?? DEFAULT_PULL_CHUNK_SIZE
  await repo.clearPurchases()
  let purchases = 0
  let purchaseItems = 0

  for (const kind of ['purchases', 'purchaseItems'] as const) {
    let offset = 0
    for (let guard = 0; guard < 100_000; guard += 1) {
      const result = await transport.pull({ kind, offset, limit: chunkSize })
      if (result.rows.length > 0) {
        await storeChunk(repo, kind, result.rows)
        if (kind === 'purchases') purchases += result.rows.length
        else purchaseItems += result.rows.length
      }
      options.onProgress?.({ kind, fetched: result.rows.length ? offset + result.rows.length : offset, total: result.total })
      if (result.nextOffset === null) break
      offset = result.nextOffset
    }
  }
  return { purchases, purchaseItems }
}

/** Mengubah sesi lokal menjadi payload sinkronisasi (FR-5.2, BR-8/BR-12). */
export function buildSessionPayload(
  session: LocalSession,
  items: readonly LocalSessionItem[],
  purchase: { vendorId: string; locationId: string; companyId: string },
): ReceiveSessionInput {
  return {
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    userId: session.userId,
    purchaseId: session.purchaseId,
    vendorId: purchase.vendorId,
    locationId: purchase.locationId,
    companyId: purchase.companyId,
    receiveDate: session.receiveDate,
    dueDate: null,
    invoiceNumber: session.invoiceNumber,
    doNumber: session.doNumber,
    finalizedAt: session.finalizedAt ?? new Date().toISOString(),
    items: items.map((line) => ({
      clientLineId: line.lineId,
      purchaseItemId: line.purchaseItemId,
      itemMasterId: line.itemMasterId,
      qty: line.qty,
      uomPurchaseId: line.uomPurchaseId,
      uomId: line.uomId,
      convQty: line.convQty,
      convFound: line.convFound,
    })),
  }
}

export interface SyncOutcome {
  attempted: number
  synced: number
  failed: number
  revokedUserIds: string[]
  results: SyncSessionResult[]
  error?: string
}

/**
 * FR-5.1/5.3/5.5/5.6: mengirim seluruh isi outbox secara FIFO, lalu
 * memperbarui status setiap sesi. Data lokal tidak pernah dihapus sebelum
 * server mengonfirmasi sukses.
 */
export async function syncOutbox(
  repo: LocalRepository,
  transport: SyncTransport = serverTransport,
  options: { deviceId?: string } = {},
): Promise<SyncOutcome> {
  const pending = await repo.outboxSessions()
  const emptyOutcome: SyncOutcome = {
    attempted: 0,
    synced: 0,
    failed: 0,
    revokedUserIds: [],
    results: [],
  }
  if (pending.length === 0) return emptyOutcome

  const credentials = await repo.listCredentials()
  const payloads: ReceiveSessionInput[] = []

  for (const session of pending) {
    const purchase = await repo.getPurchase(session.purchaseId)
    const items = await repo.sessionItems(session.sessionId)
    if (!purchase || items.length === 0) {
      await repo.markFailed(
        session.sessionId,
        !purchase ? 'Data PO tidak tersedia di device.' : 'Sesi tidak memiliki item.',
      )
      continue
    }
    payloads.push(
      buildSessionPayload(session, items, {
        vendorId: purchase.vendorId,
        locationId: purchase.locationId,
        companyId: purchase.companyId,
      }),
    )
  }

  if (payloads.length === 0) {
    return { ...emptyOutcome, attempted: pending.length, failed: pending.length }
  }

  for (const payload of payloads) {
    await repo.markSyncing(payload.sessionId)
  }

  try {
    const response = await transport.push({
      deviceId: options.deviceId ?? payloads[0]!.deviceId,
      sessions: payloads,
      credentials: credentials.map((credential) => ({
        userId: credential.userId,
        loginId: credential.loginId,
        fingerprint: credential.fingerprint,
      })),
    })

    let synced = 0
    let failed = 0
    for (const result of response.results) {
      if (result.status === 'SYNCED') {
        await repo.markSynced(result.sessionId, {
          receiveId: result.receiveId ?? '',
          number: result.number ?? '',
          overReceive: result.overReceive,
          excessTotal: result.excessTotal,
        })
        await repo.log(
          result.overReceive ? 'error' : 'info',
          result.overReceive
            ? `Sesi tersinkron dengan over-receive: ${result.message ?? ''}`
            : `Sesi tersinkron: ${result.number ?? ''}`,
          result.sessionId,
        )
        synced += 1
      } else {
        const code = result.code ?? ''
        const message = result.message ?? 'Gagal sinkronisasi.'
        if (PERMANENT_REJECT_CODES.includes(code)) {
          await repo.markRejected(result.sessionId, message, code)
          await repo.log('error', `Sesi ditolak server (${code}): ${message}`, result.sessionId)
        } else {
          await repo.markFailed(result.sessionId, message, code)
          await repo.log('error', message, result.sessionId)
        }
        failed += 1
      }
    }

    if (response.revoked.length > 0) {
      await repo.removeCredentialsForUsers(response.revoked.map((entry) => entry.userId))
    }

    return {
      attempted: payloads.length,
      synced,
      failed,
      revokedUserIds: response.revoked.map((entry) => entry.userId),
      results: response.results,
    }
  } catch (error) {
    // FR-5.6: kegagalan transport -> semua sesi kembali "Gagal — coba lagi".
    const message = error instanceof Error ? error.message : 'Koneksi ke server gagal.'
    for (const payload of payloads) {
      await repo.markFailed(payload.sessionId, message)
    }
    await repo.log('error', `Sinkronisasi gagal: ${message}`)
    return {
      attempted: payloads.length,
      synced: 0,
      failed: payloads.length,
      revokedUserIds: [],
      results: [],
      error: message,
    }
  }
}

/** Ringkasan antrian untuk indikator (FR-7.2). */
export async function countPendingSessions(repo: LocalRepository): Promise<number> {
  const pending = await repo.db.sessions.where('status').equals(SESSION_STATUS.PENDING).count()
  const failed = await repo.db.sessions.where('status').equals(SESSION_STATUS.FAILED).count()
  return pending + failed
}
