import type { LocalRepository } from '~/data/local-repo'
import type { LocalSession, LocalSessionItem } from '~/data/local-db'
import type { SyncTransport } from '~/features/sync/transport'
import { serverTransport } from '~/features/sync/transport'
import {
  DEFAULT_PULL_CHUNK_SIZE,
  MAX_PUSH_SESSIONS,
  PERMANENT_REJECT_CODES,
  PURCHASES_STALE_META_KEY,
  SESSION_STATUS,
} from '~/core/contracts/constants'
import {
  DIAG_EVENT,
  DIAG_LAST_PUSH_META_KEY,
  type DiagEntryInput,
} from '~/core/contracts/diag-events'
import type {
  CredentialFingerprint,
  PullKind,
  PushResult,
  ReceiveSessionInput,
  SyncSessionResult,
} from '~/core/contracts/schemas'

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

/** Logging is diagnostics only: a failing log write must never change the outcome of a session. */
async function safeLog(repo: LocalRepository, entry: DiagEntryInput): Promise<void> {
  try {
    await repo.logEvent(entry)
  } catch {
    // Ignore: see above.
  }
}

/**
 * Total qty a session carried, as the SERVER counted it.
 *
 * Logged with a rejection or a temporary failure because it is the first thing asked after "which
 * document?" — and because it comes from the server's own answer, it also shows when the device
 * and the server disagree. Per-line figures stay out: `purchaseItemId` already identifies a line,
 * and nothing here carries a barcode, because a diagnostics file travels through chat apps.
 */
function sessionQtyTotal(result: SyncSessionResult): number {
  return result.lines.reduce((total, line) => total + line.sessionQty, 0)
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
 * FULL download of master data and receivable POs, chunk by chunk with progress.
 *
 * Full and not incremental, deliberately: there is no change-tracking column to drive a delta
 * sync against, so correctness comes from replacing everything.
 *
 * Everything is fetched first and only then swapped in, in one local transaction. A connection
 * dropping halfway therefore costs the operator a retry, not a device that can no longer
 * resolve a barcode. Receiving sessions are never part of the swap.
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
  // Which half of the download is running. The two halves fail for entirely different reasons — a
  // weak warehouse connection versus a storage quota that cannot hold the swap, which is the
  // typical failure on a PDT — and this is what tells them apart in the exported CSV without
  // anyone having to read the message text. The swap MUST be inside the try: it is the one step
  // that writes ~50k rows, so it is the likeliest to fail, and it used to fail with no trace at all.
  let phase: 'fetch' | 'swap' = 'fetch'
  try {
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

    phase = 'swap'
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
  } catch (error) {
    // Logged here and rethrown unchanged: the caller still decides what the operator is told, but
    // a download that died halfway now leaves a trace even when the operator simply taps again.
    await safeLog(repo, {
      level: 'error',
      category: 'pull',
      event: DIAG_EVENT.PULL_FAILED,
      message: `Unduh data gagal: ${error instanceof Error ? error.message : 'penyebab tidak diketahui'}`,
      detail: { phase, completedKinds: Object.keys(counts).length },
    })
    throw error
  }

  await safeLog(repo, {
    level: 'info',
    category: 'pull',
    event: DIAG_EVENT.PULL_RUN,
    message: `Unduh data selesai: ${counts.purchases ?? 0} PO, ${counts.items ?? 0} barang.`,
    detail: { ...counts },
  })
  return { counts, pulledAt: new Date().toISOString() }
}

/**
 * Refreshes the PO list and its progress figures, leaving the item master and every local
 * session alone. Download first, then swap, for the same reason as the full pull: a failed
 * refresh must leave the operator with the data they had.
 */
export async function refreshPurchases(
  repo: LocalRepository,
  transport: SyncTransport = serverTransport,
  options: {
    chunkSize?: number
    timeoutMs?: number
    onProgress?: (event: PullProgressEvent) => void
  } = {},
): Promise<{
  purchases: number
  purchaseItems: number
  removedCount: number
  removedNumbers: string[]
}> {
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
  await safeLog(repo, {
    level: 'info',
    category: 'pull',
    event: DIAG_EVENT.REFRESH_PO_RUN,
    message: `Daftar PO disegarkan: ${purchases.rows.length} PO aktif, ${removed.length} dihapus.`,
    detail: {
      purchases: purchases.rows.length,
      purchaseItems: purchaseItems.rows.length,
      removed: removed.length,
    },
  })
  return {
    purchases: purchases.rows.length,
    purchaseItems: purchaseItems.rows.length,
    removedCount: removed.length,
    removedNumbers: removed.map((purchase) => purchase.number ?? purchase.purchaseId),
  }
}

/**
 * Flattens a local session into the push payload.
 *
 * Fields are mapped one by one on purpose rather than spread: device-only state must not leak
 * to the server, and every id goes out as a string, since these values are too large for a
 * JSON number to carry intact. No document number is sent — the server assigns it.
 */
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
 * Sends the outbox oldest first and writes the server's answer onto each session.
 *
 * Nothing local is ever deleted before the server has confirmed it stored the document. The
 * answers are applied per session, so one rejected delivery does not disturb the others, and a
 * session the server said nothing about is marked failed rather than left in limbo.
 */
export async function syncOutbox(
  repo: LocalRepository,
  transport: SyncTransport = serverTransport,
  options: { deviceId?: string } = {},
): Promise<SyncOutcome> {
  // A session left in SYNCING (e.g. the app died mid-push) is in neither the outbox nor the pending
  // count, so it would wait for the next app start. Sync runs never overlap (one queue per store),
  // hence anything still SYNCING at this point is stale: put it back in the queue first.
  try {
    await repo.resetStaleSyncingSessions()
  } catch {
    // Best effort: the sync itself goes on.
  }

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
    await safeLog(repo, {
      level: 'warn',
      category: 'sync',
      event: DIAG_EVENT.PUSH_NO_PAYLOAD,
      message: `Tidak ada dokumen yang bisa dikirim; ${pending.length} sesi di antrean ditandai gagal.`,
      detail: { pending: pending.length },
    })
    return { ...emptyOutcome, attempted: pending.length, failed: pending.length }
  }

  for (const payload of payloads) {
    await repo.markSyncing(payload.sessionId)
  }

  let response: PushResult
  try {
    response = await withTimeout(
      transport.push({
        deviceId: options.deviceId ?? payloads[0]!.deviceId,
        sessions: payloads,
        credentials,
      }),
      SYNC_TIMEOUT_MS,
    )
  } catch (error) {
    // The request itself never landed, so nothing was stored: every session goes back to the
    // queue as a retryable failure. This is the ordinary case in a warehouse, not an error.
    const message = error instanceof Error ? error.message : 'Koneksi ke server gagal.'
    for (const payload of payloads) {
      await repo.markFailed(payload.sessionId, message)
    }
    await safeLog(repo, {
      level: 'error',
      category: 'sync',
      event: DIAG_EVENT.PUSH_TRANSPORT_FAILED,
      message: `Sinkronisasi gagal: ${message}`,
      detail: { sessions: payloads.length },
    })
    return {
      attempted: payloads.length,
      synced: 0,
      failed: payloads.length,
      revokedUserIds: [],
      results: [],
      error: message,
    }
  }

  // The server's answer is in. From here on a local write error must never undo a session the
  // server already stored, so every result is handled on its own.
  let synced = 0
  let failed = 0
  const payloadIds = new Set(payloads.map((payload) => payload.sessionId))
  const answered = new Set<string>()
  const handledResults: SyncSessionResult[] = []
  for (const result of response.results) {
    // Only the first answer for a session that was really sent counts. An unknown id or a second
    // answer (a faulty server or an incompatible version) must not inflate synced/failed.
    if (!payloadIds.has(result.sessionId) || answered.has(result.sessionId)) {
      await safeLog(repo, {
        level: 'warn',
        category: 'sync',
        event: DIAG_EVENT.PUSH_RESULT_IGNORED,
        message: `Hasil sinkronisasi diabaikan (sesi tidak dikenal atau ganda): ${result.sessionId}`,
      })
      continue
    }
    answered.add(result.sessionId)
    handledResults.push(result)
    try {
      if (result.status === 'SYNCED') {
        await repo.markSynced(result.sessionId, {
          receiveId: result.receiveId ?? '',
          number: result.number ?? '',
          overReceive: result.overReceive,
          excessTotal: result.excessTotal,
          replay: result.code === 'IDEMPOTENT_REPLAY',
        })
        synced += 1
        // Only the exception is logged, never every success. One push may carry 200 documents, so
        // an entry per accepted document would fill the whole ring buffer with rows nobody reads
        // and push out the failures the trail exists for; the per-run summary further down carries
        // the totals instead. A document accepted WITH an over-receive keeps its own entry,
        // because that is the one admin comes back about — as a warning, not an error, since
        // over-receive is flagged, not refused.
        if (result.overReceive) {
          await safeLog(repo, {
            level: 'warn',
            category: 'sync',
            event: DIAG_EVENT.PUSH_SESSION_OVER_RECEIVE,
            message: `Dokumen ${result.number ?? '-'} masuk dengan kelebihan terima.`,
            sessionId: result.sessionId,
            detail: {
              number: result.number ?? null,
              excessTotal: result.excessTotal,
              lines: result.lines.length,
              overLines: result.lines.filter((line) => line.overReceive).length,
            },
          })
        }
      } else {
        const code = result.code ?? ''
        const message = result.message ?? 'Gagal sinkronisasi.'
        if (PERMANENT_REJECT_CODES.includes(code)) {
          await repo.markRejected(result.sessionId, message, code)
          await safeLog(repo, {
            level: 'error',
            category: 'sync',
            event: DIAG_EVENT.PUSH_SESSION_REJECTED,
            message: `Sesi ditolak server (${code}): ${message}`,
            sessionId: result.sessionId,
            detail: { code, lines: result.lines.length, qty: sessionQtyTotal(result) },
          })
        } else {
          await repo.markFailed(result.sessionId, message, code)
          await safeLog(repo, {
            level: 'warn',
            category: 'sync',
            event: DIAG_EVENT.PUSH_SESSION_FAILED,
            message,
            sessionId: result.sessionId,
            detail: {
              code: code || null,
              lines: result.lines.length,
              qty: sessionQtyTotal(result),
            },
          })
        }
        failed += 1
      }
    } catch {
      // The local write failed (e.g. a storage error). The session must not stay in SYNCING:
      // it goes back to the queue (markFailed never overrides a SYNCED session), and the next
      // sync receives IDEMPOTENT_REPLAY from the server.
      failed += 1
      await repo
        .markFailed(
          result.sessionId,
          'Gagal menyimpan hasil sinkronisasi di perangkat. Akan dicoba lagi.',
        )
        .catch(() => undefined)
    }
  }

  // A session the server did not answer for must not stay in SYNCING until the app restarts.
  for (const payload of payloads) {
    if (answered.has(payload.sessionId)) continue
    failed += 1
    await repo
      .markFailed(
        payload.sessionId,
        'Server tidak mengembalikan hasil untuk sesi ini. Akan dicoba lagi.',
      )
      .catch(() => undefined)
  }

  // One summary per run. With the per-session entries above covering everything that was NOT
  // accepted, this is what makes a 2000-entry ring buffer last: a quiet day costs one row.
  await safeLog(repo, {
    level: failed > 0 ? 'warn' : 'info',
    category: 'sync',
    event: DIAG_EVENT.PUSH_RUN,
    message: `Kirim selesai: ${synced} berhasil, ${failed} gagal dari ${payloads.length} dokumen.`,
    detail: { attempted: payloads.length, synced, failed },
  })
  // Diagnostics only, shown on the screen as "Kirim terakhir". It records that a push RAN and got
  // an answer — not that every document in it succeeded.
  try {
    await repo.setMeta(DIAG_LAST_PUSH_META_KEY, new Date().toISOString())
  } catch {
    // Bookkeeping must never fail a sync.
  }
  // A trim on every push run that got an ANSWER from the server, so a device that writes few log
  // entries still gets trimmed without waiting for DIAG_PRUNE_EVERY. Deliberately not a guarantee
  // for every call: the two early returns above (nothing to send, and a transport failure) skip
  // it, so a device offline all day is still bounded by DIAG_PRUNE_EVERY alone.
  try {
    await repo.pruneSyncLog()
  } catch {
    // Same reason as above.
  }

  if (response.revoked.length > 0) {
    try {
      await repo.removeCredentialsForUsers(response.revoked.map((entry) => entry.userId))
    } catch {
      // The server reports the revocation again on the next sync.
    }
  }

  return {
    attempted: payloads.length,
    synced,
    failed,
    revokedUserIds: response.revoked.map((entry) => entry.userId),
    results: handledResults,
  }
}

/**
 * How many sessions are still waiting to reach the server, for the queue badge in the app bar.
 * Counts PENDING and FAILED together: to the operator both mean "not in the system yet".
 */
export async function countPendingSessions(repo: LocalRepository): Promise<number> {
  const pending = await repo.db.sessions.where('status').equals(SESSION_STATUS.PENDING).count()
  const failed = await repo.db.sessions.where('status').equals(SESSION_STATUS.FAILED).count()
  return pending + failed
}
