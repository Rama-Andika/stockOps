import type { LocalRepository } from '../db/local-repo'
import type { LocalSession, LocalSessionItem } from '../db/local-db'
import type { SyncTransport } from './transport'
import { serverTransport } from './transport'
import {
  DEFAULT_PULL_CHUNK_SIZE,
  MAX_PUSH_SESSIONS,
  PERMANENT_REJECT_CODES,
  PURCHASES_STALE_META_KEY,
  SESSION_STATUS,
} from '~/shared/constants'
import type {
  CredentialFingerprint,
  PullKind,
  ReceiveSessionInput,
  SyncSessionResult,
} from '~/shared/schemas'

/** Maximum timeout for a single sync request before considered failed. */
const SYNC_TIMEOUT_MS = 30_000

/** Maximum wait for ONE pull chunk (a chunk holds at most `limit` rows, 500 by default). */
const PULL_TIMEOUT_MS = 60_000

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = 'Sinkronisasi melebihi batas waktu (timeout).',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** Credentials of every user cached on this device; the server uses them to authenticate the device. */
async function credentialPayload(repo: LocalRepository): Promise<CredentialFingerprint[]> {
  const cached = await repo.listCredentials()
  return cached.map((credential) => ({
    userId: credential.userId,
    loginId: credential.loginId,
    fingerprint: credential.fingerprint,
  }))
}

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

type PullRows = Array<Record<string, unknown>>

/** Downloads every chunk of one kind into memory; nothing is written locally. */
async function fetchAllChunks(
  transport: SyncTransport,
  kind: PullKind,
  chunkSize: number,
  credentials: CredentialFingerprint[],
  timeoutMs: number,
  onProgress?: (event: PullProgressEvent) => void,
): Promise<{ rows: PullRows; total: number }> {
  const rows: PullRows = []
  let offset = 0
  let total = 0
  // Iteration limit as a safeguard against infinite loops.
  for (let guard = 0; guard < 100_000; guard += 1) {
    const result = await withTimeout(
      transport.pull({ kind, offset, limit: chunkSize, credentials }),
      timeoutMs,
      'Unduh data melebihi batas waktu (timeout). Periksa koneksi lalu coba lagi.',
    )
    total = result.total
    for (const row of result.rows) rows.push(row)
    onProgress?.({ kind, fetched: rows.length, total })
    if (result.nextOffset === null) break
    offset = result.nextOffset
  }
  return { rows, total }
}

/**
 * FR-2.1 / FR-2.2 / BR-16: FULL download of master data & CHECKED POs, paginated
 * (chunking) with progress. Everything is downloaded first and only then swapped in
 * with one local transaction, so a dropped connection keeps the previous data intact.
 * Does not touch local receiving sessions.
 */
export async function pullAllData(
  repo: LocalRepository,
  transport: SyncTransport = serverTransport,
  options: {
    chunkSize?: number
    timeoutMs?: number
    onProgress?: (event: PullProgressEvent) => void
  } = {},
): Promise<PullSummary> {
  const chunkSize = options.chunkSize ?? DEFAULT_PULL_CHUNK_SIZE
  const timeoutMs = options.timeoutMs ?? PULL_TIMEOUT_MS
  const credentials = await credentialPayload(repo)

  const collected = {} as Record<PullKind, PullRows>
  const counts: Record<string, number> = {}
  for (const kind of PULL_KIND_ORDER) {
    const { rows, total } = await fetchAllChunks(
      transport,
      kind,
      chunkSize,
      credentials,
      timeoutMs,
      options.onProgress,
    )
    collected[kind] = rows
    counts[kind] = rows.length || total
  }

  await repo.replaceMasterData({
    purchases: collected.purchases as never,
    purchaseItems: collected.purchaseItems as never,
    items: collected.items as never,
    units: collected.units as never,
    vendors: collected.vendors as never,
    vendorItems: collected.vendorItems as never,
  })

  await repo.setMeta(PURCHASES_STALE_META_KEY, '0')
  await repo.setMeta('lastPullAt', new Date().toISOString())
  return { counts, pulledAt: new Date().toISOString() }
}

/** FR-2.3: Refresh PO list without touching ongoing sessions (download first, then swap). */
export async function refreshPurchases(
  repo: LocalRepository,
  transport: SyncTransport = serverTransport,
  options: {
    chunkSize?: number
    timeoutMs?: number
    onProgress?: (event: PullProgressEvent) => void
  } = {},
): Promise<{ purchases: number; purchaseItems: number; removedCount: number; removedNumbers: string[] }> {
  const chunkSize = options.chunkSize ?? DEFAULT_PULL_CHUNK_SIZE
  const timeoutMs = options.timeoutMs ?? PULL_TIMEOUT_MS
  const credentials = await credentialPayload(repo)
  const before = await repo.listPurchases()

  const purchases = await fetchAllChunks(
    transport,
    'purchases',
    chunkSize,
    credentials,
    timeoutMs,
    options.onProgress,
  )
  const purchaseItems = await fetchAllChunks(
    transport,
    'purchaseItems',
    chunkSize,
    credentials,
    timeoutMs,
    options.onProgress,
  )
  await repo.replacePurchases(purchases.rows as never, purchaseItems.rows as never)
  await repo.setMeta(PURCHASES_STALE_META_KEY, '0')

  const after = await repo.listPurchases()
  const afterIds = new Set(after.map((purchase) => purchase.purchaseId))
  const removed = before.filter((purchase) => !afterIds.has(purchase.purchaseId))
  return {
    purchases: purchases.rows.length,
    purchaseItems: purchaseItems.rows.length,
    removedCount: removed.length,
    removedNumbers: removed.map((purchase) => purchase.number ?? purchase.purchaseId),
  }
}


/** Transforms local session into sync payload (FR-5.2, BR-8/BR-12). */
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
 * FR-5.1/5.3/5.5/5.6: Send entire outbox in FIFO order, then
 * update each session status. Local data is never deleted before
 * the server confirms success.
 */
export async function syncOutbox(
  repo: LocalRepository,
  transport: SyncTransport = serverTransport,
  options: { deviceId?: string } = {},
): Promise<SyncOutcome> {
  // FIFO batch within the server limit; the remaining sessions go with the next sync.
  const pending = (await repo.outboxSessions()).slice(0, MAX_PUSH_SESSIONS)
  const emptyOutcome: SyncOutcome = {
    attempted: 0,
    synced: 0,
    failed: 0,
    revokedUserIds: [],
    results: [],
  }
  if (pending.length === 0) return emptyOutcome

  const credentials = await credentialPayload(repo)
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
    const response = await withTimeout(
      transport.push({
        deviceId: options.deviceId ?? payloads[0]!.deviceId,
        sessions: payloads,
        credentials,
      }),
      SYNC_TIMEOUT_MS,
    )

    let synced = 0
    let failed = 0
    for (const result of response.results) {
      if (result.status === 'SYNCED') {
        await repo.markSynced(result.sessionId, {
          receiveId: result.receiveId ?? '',
          number: result.number ?? '',
          overReceive: result.overReceive,
          excessTotal: result.excessTotal,
          replay: result.code === 'IDEMPOTENT_REPLAY',
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
    // FR-5.6: transport failure -> all sessions revert to "Failed — retry".
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

/** Queue summary for indicators (FR-7.2). */
export async function countPendingSessions(repo: LocalRepository): Promise<number> {
  const pending = await repo.db.sessions.where('status').equals(SESSION_STATUS.PENDING).count()
  const failed = await repo.db.sessions.where('status').equals(SESSION_STATUS.FAILED).count()
  return pending + failed
}
