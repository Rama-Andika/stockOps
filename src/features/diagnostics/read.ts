import { localRepo } from '~/data/local-repo'
import type { LocalSyncLogEntry } from '~/data/local-db'
import {
  PURCHASES_STALE_META_KEY,
  SESSION_STATUS,
  type SessionStatus,
} from '~/core/contracts/constants'
import { APP_BUILD_TIME, APP_VERSION } from '~/app/app-version'
import { DIAG_EVENT, DIAG_LAST_PUSH_META_KEY, DIAG_LOG_MAX } from '~/core/contracts/diag-events'

/**
 * Everything the diagnostics screen and the CSV export read, in one place.
 *
 * Read-only on purpose. In particular `deviceId` comes from `getMeta('deviceId')` and NOT from
 * `ensureDeviceId()`: opening a diagnostics screen must never write anything.
 */

export interface DiagnosticsSnapshot {
  deviceId: string | null
  appVersion: string
  appBuildTime: string
  online: boolean
  statusCounts: Record<SessionStatus, number>
  lastPushAt: string | null
  lastPullAt: string | null
  purchasesStale: boolean
  totalEntries: number
  problemEntries: number
  logMax: number
}

/** One queued/finished document, flattened for the CSV so `csv.ts` needs no Dexie types. */
export interface DiagnosticsSessionRow {
  sessionId: string
  status: SessionStatus
  purchaseNumber: string | null
  vendorName: string | null
  updatedAt: string
  number: string | null
  failureCode: string | null
  lastError: string | null
  lines: number
  overReceive: boolean
  excessTotal: number
  userLoginId: string | null
}

export interface DiagnosticsView {
  snapshot: DiagnosticsSnapshot
  entries: LocalSyncLogEntry[]
}

export interface DiagnosticsExport {
  snapshot: DiagnosticsSnapshot
  sessions: DiagnosticsSessionRow[]
  /** Oldest first — the opposite of the screen. See `buildDiagnosticsCsv`. */
  entries: LocalSyncLogEntry[]
}

function emptyStatusCounts(): Record<SessionStatus, number> {
  const counts = {} as Record<SessionStatus, number>
  for (const status of Object.values(SESSION_STATUS)) counts[status] = 0
  return counts
}

/**
 * The fallback `useLive` renders with. It must be a module constant — but not for the reason it
 * looks like: `useLiveQuery` does no structural comparison at all, it only reads the default once
 * into a ref. The reason is `useLive` itself, which returns `result ?? fallback`, so a fallback
 * built inline would hand the screen a NEW object identity on every render until the first query
 * resolves.
 */
export const EMPTY_DIAGNOSTICS: DiagnosticsView = {
  snapshot: {
    deviceId: null,
    appVersion: APP_VERSION,
    appBuildTime: APP_BUILD_TIME,
    online: false,
    statusCounts: emptyStatusCounts(),
    lastPushAt: null,
    lastPullAt: null,
    purchasesStale: false,
    totalEntries: 0,
    problemEntries: 0,
    logMax: DIAG_LOG_MAX,
  },
  entries: [],
}

async function readSnapshot(): Promise<DiagnosticsSnapshot> {
  const [deviceId, lastPushAt, lastPullAt, stale] = await Promise.all([
    localRepo.getMeta('deviceId'),
    localRepo.getMeta(DIAG_LAST_PUSH_META_KEY),
    localRepo.getMeta('lastPullAt'),
    localRepo.getMeta(PURCHASES_STALE_META_KEY),
  ])
  const [statusCounts, totalEntries, problemEntries] = await Promise.all([
    localRepo.sessionStatusCounts(),
    localRepo.countLogEntries(),
    localRepo.countProblemLogEntries(),
  ])
  return {
    deviceId,
    appVersion: APP_VERSION,
    appBuildTime: APP_BUILD_TIME,
    // Guarded: this module is also reachable during the SPA prerender in Node.
    online: typeof navigator === 'undefined' ? false : navigator.onLine,
    statusCounts,
    lastPushAt,
    lastPullAt,
    purchasesStale: stale === '1',
    totalEntries,
    problemEntries,
    logMax: DIAG_LOG_MAX,
  }
}

export async function readDiagnostics(options: {
  limit: number
  onlyProblems: boolean
}): Promise<DiagnosticsView> {
  const [snapshot, entries] = await Promise.all([
    readSnapshot(),
    localRepo.recentLogEntries(options.limit, options.onlyProblems),
  ])
  return { snapshot, entries }
}

/**
 * Everything that goes into one exported file. Separate from `readDiagnostics` on purpose: the
 * session list and the full 2000-entry log are needed once, on a button press, and have no place
 * in a live query that re-runs on every Dexie write.
 */
export async function collectDiagnosticsExport(): Promise<DiagnosticsExport> {
  const snapshot = await readSnapshot()
  const [sessions, lineCounts] = await Promise.all([
    localRepo.listSessions(),
    localRepo.countItemsBySession(),
  ])
  // `recentLogEntries` answers newest first; the CSV is written oldest first so a spreadsheet
  // reads one timeline forward.
  const newestFirst = await localRepo.recentLogEntries(snapshot.logMax, false)
  return {
    snapshot,
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId,
      status: session.status,
      purchaseNumber: session.purchaseNumber,
      vendorName: session.vendorName,
      updatedAt: session.updatedAt,
      number: session.number,
      failureCode: session.failureCode,
      lastError: session.lastError,
      lines: lineCounts.get(session.sessionId) ?? 0,
      overReceive: session.overReceive,
      excessTotal: session.excessTotal,
      userLoginId: session.userLoginId,
    })),
    entries: [...newestFirst].reverse(),
  }
}

export async function clearDiagnosticsLog(): Promise<number> {
  const removed = await localRepo.clearSyncLog()
  // Written AFTER the wipe, so the trail records its own emptying. Without it a log that starts
  // mid-story looks like data loss, and the next question becomes "kenapa lognya hilang?".
  await localRepo.logEvent({
    level: 'info',
    category: 'app',
    event: DIAG_EVENT.LOG_CLEARED,
    message: `Log diagnostik dihapus (${removed} entri).`,
  })
  return removed
}
