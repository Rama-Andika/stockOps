/**
 * Vocabulary of the diagnostics trail: levels, categories, event codes, and the handful of limits
 * that keep it from growing without bound.
 *
 * It imports nothing, on purpose: `local-db.ts` reads the types from here, so anything imported
 * into this module would end up inside the Dexie schema's import graph.
 *
 * An event code is NOT an internal detail. It travels out of the device as a column in the CSV
 * export that the IT team opens in a spreadsheet, so renaming one silently breaks every filter
 * built on an earlier export. Add codes; do not rename them.
 */

/**
 * `warn` is what makes the screen's filter worth having. Timeouts and a PO refresh that will be
 * retried are NORMAL on a warehouse floor; logging them as errors paints everything red exactly
 * when someone needs to find the one entry that matters.
 */
export type DiagLevel = 'info' | 'warn' | 'error'

/** The levels the screen's filter and the problem counter treat as "a problem". */
export const DIAG_PROBLEM_LEVELS: readonly DiagLevel[] = ['warn', 'error']

export type DiagCategory = 'sync' | 'pull' | 'pwa' | 'app'

export const DIAG_EVENT = {
  /** One summary per push run: how many documents went, how many landed. */
  PUSH_RUN: 'PUSH_RUN',
  /** The push request itself never reached the server, so nothing was stored. */
  PUSH_TRANSPORT_FAILED: 'PUSH_TRANSPORT_FAILED',
  /** Sessions were queued but none could be turned into a payload (missing PO, no lines). */
  PUSH_NO_PAYLOAD: 'PUSH_NO_PAYLOAD',
  /** The server refused a session permanently; it has left the queue. */
  PUSH_SESSION_REJECTED: 'PUSH_SESSION_REJECTED',
  /** A temporary failure; the session stays in the queue and is retried. */
  PUSH_SESSION_FAILED: 'PUSH_SESSION_FAILED',
  /** Accepted, but with more received than ordered — flagged for admin, not refused. */
  PUSH_SESSION_OVER_RECEIVE: 'PUSH_SESSION_OVER_RECEIVE',
  /** An answer for a session that was not sent, or a second answer for one that was. */
  PUSH_RESULT_IGNORED: 'PUSH_RESULT_IGNORED',
  /** A full master-data download finished. */
  PULL_RUN: 'PULL_RUN',
  /** A full master-data download died halfway. */
  PULL_FAILED: 'PULL_FAILED',
  /** The PO list was refreshed. */
  REFRESH_PO_RUN: 'REFRESH_PO_RUN',
  /** The manual "Refresh PO" button failed. */
  REFRESH_PO_FAILED: 'REFRESH_PO_FAILED',
  /** The automatic refresh after a sync failed; `purchasesStale` is now raised. */
  REFRESH_PO_RETRY_PENDING: 'REFRESH_PO_RETRY_PENDING',
  /** A new service worker reached `waiting`: a new version is installed but not yet active. */
  SW_UPDATE_READY: 'SW_UPDATE_READY',
  /** An uncaught error reached `window.onerror`. */
  UNHANDLED_ERROR: 'UNHANDLED_ERROR',
  /** A promise rejected with nobody listening. */
  UNHANDLED_REJECTION: 'UNHANDLED_REJECTION',
  /** Somebody emptied the log from the diagnostics screen. */
  LOG_CLEARED: 'LOG_CLEARED',
} as const

export type DiagEvent = (typeof DIAG_EVENT)[keyof typeof DIAG_EVENT]

/**
 * The structured payload stored next to an entry. Deliberately FLAT and primitive-only: it is
 * written straight into IndexedDB and read back out into a CSV cell as JSON, and a nested object
 * would make that cell unreadable in a spreadsheet.
 *
 * It may carry qty figures, document numbers and ids. It must NOT carry barcodes: within this
 * trail's scope a barcode adds nothing `purchaseItemId` does not already answer, and the export
 * travels through chat apps.
 */
export type DiagDetail = Record<string, string | number | boolean | null>

export interface DiagEntryInput {
  level: DiagLevel
  category: DiagCategory
  event: DiagEvent
  message: string
  sessionId?: string
  detail?: DiagDetail
}

/** How many entries the ring buffer keeps. Roughly a week of ordinary use on one PDT. */
export const DIAG_LOG_MAX = 2000

/**
 * Writes between two prune checks. The log is written inside the push loop, which touches
 * hundreds of rows, so counting the table on every write would put a query in the hot path. The
 * price is that the table may sit slightly above DIAG_LOG_MAX between checks.
 */
export const DIAG_PRUNE_EVERY = 100

/** Hard cap on a stored message. Server error strings can be long; the screen shows two lines. */
export const DIAG_MESSAGE_MAX = 300

/** Hard cap on a stored stack trace, applied where it is produced, not where it is exported. */
export const DIAG_STACK_MAX = 500

/** Local `meta` key: when a push run last got an answer from the server. Diagnostics only. */
export const DIAG_LAST_PUSH_META_KEY = 'lastPushAt'
