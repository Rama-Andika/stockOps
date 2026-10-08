/** Shared domain constants (used by server & client). */

export const PURCHASE_STATUS = {
  DRAFT: 'DRAFT',
  CHECKED: 'CHECKED',
  APPROVED: 'APPROVED',
  CLOSED: 'CLOSED',
} as const

export type PurchaseStatus = (typeof PURCHASE_STATUS)[keyof typeof PURCHASE_STATUS]

/**
 * A PO may only be received while it is CHECKED: approved for the warehouse, not yet closed.
 * This is the single gate used in three places — the pull query, the local PO list, and the
 * server's re-check at sync time. The last one is not redundant: admin can move a PO out of
 * CHECKED while a device is offline with a session already open for it.
 */
export const PULLABLE_PURCHASE_STATUS = PURCHASE_STATUS.CHECKED

/**
 * Receiving documents created here are always DRAFT. Moving one on to CHECKED or APPROVED is
 * the admin website's job, so this app never writes any other status — a document that
 * arrived as DRAFT is what tells the admin team it still needs a human.
 */
export const RECEIVE_STATUS_DRAFT = 'DRAFT'

/**
 * Lifecycle of a receiving session on the device:
 *
 *   RUNNING  -> being filled in; the only state in which lines can be added or edited
 *   PENDING  -> finalized and waiting in the outbox
 *   SYNCING  -> currently being pushed; never persists across runs (see
 *               resetStaleSyncingSessions, which returns leftovers to PENDING)
 *   SYNCED   -> accepted, has an official document number, read-only from here on
 *   FAILED   -> temporary problem (offline, server error); stays in the queue and is retried
 *   REJECTED -> refused permanently (PO closed, deleted or invalid); leaves the queue
 *
 * The split between FAILED and REJECTED is the whole point of this enum: a FAILED session
 * still holds the operator's work and must never be dropped, while retrying a REJECTED one
 * can only fail again. Never test these values by hand to decide whether a session may be
 * edited — ask canEditSession(), which also checks who owns it.
 */
export const SESSION_STATUS = {
  RUNNING: 'RUNNING',
  PENDING: 'PENDING',
  SYNCING: 'SYNCING',
  SYNCED: 'SYNCED',
  FAILED: 'FAILED',
  REJECTED: 'REJECTED',
} as const

export type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS]

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  RUNNING: 'Berjalan',
  PENDING: 'Belum terkirim',
  SYNCING: 'Sedang dikirim',
  SYNCED: 'Sudah masuk sistem',
  FAILED: 'Gagal kirim',
  REJECTED: 'Ditolak server',
}

/**
 * Server failure codes that are PERMANENT: the session is rejected & cannot
 * be retried (e.g., PO closed/deleted, or invalid items).
 */
export const PERMANENT_REJECT_CODES: readonly string[] = [
  'PURCHASE_NOT_FOUND',
  'PURCHASE_NOT_CHECKED',
  'VALIDATION',
]

/**
 * How far a PO has been received, derived from ordered total vs received total across every
 * document and device — not from the sessions on this device alone. OVER is a state the
 * operator is allowed to reach: receiving more than ordered is flagged for admin, never
 * blocked at the scanner.
 */
export const PROGRESS_STATUS = {
  NONE: 'NONE',
  PARTIAL: 'PARTIAL',
  FULL: 'FULL',
  OVER: 'OVER',
} as const

export type ProgressStatus = (typeof PROGRESS_STATUS)[keyof typeof PROGRESS_STATUS]

export const PROGRESS_LABEL: Record<ProgressStatus, string> = {
  NONE: 'Belum diterima',
  PARTIAL: 'Sebagian',
  FULL: 'Lengkap',
  OVER: 'Lebih dari pesanan',
}

/**
 * Rows per request while pulling master data. The first download on a device covers roughly
 * 50k items, which a PDT cannot hold in one response: chunking keeps each request small
 * enough to survive a weak warehouse connection and lets the UI show real progress.
 */
export const DEFAULT_PULL_CHUNK_SIZE = 500

/**
 * Local `meta` key: '1' when the PO list could not be refreshed after a sync (e.g. an
 * IDEMPOTENT_REPLAY) and must be retried; '0' once a refresh/download succeeded.
 */
export const PURCHASES_STALE_META_KEY = 'purchasesStale'

/** Max sessions per push request (validated by the server, enforced by the client outbox). */
export const MAX_PUSH_SESSIONS = 200

/** Max lines per receiving session in a push request. */
export const MAX_SESSION_LINES = 5000

/**
 * Sanity bound for a single scan's qty, in PO units. Not a business rule — a guard rail: without
 * it a stuck scanner or a barcode typed into the qty field writes an absurd qty into the session,
 * which is then pushed and prorated into the document's financial fields. Raise it if a real
 * receipt ever legitimately needs more in ONE line.
 */
export const MAX_SCAN_QTY = 100_000

/**
 * How old local master data may be before an online login re-downloads it in full. There is
 * no incremental sync: a shift that starts with stale items and prices would scan against
 * yesterday's catalogue, so the trade is a slower login once a day against wrong data.
 */
export const MASTER_DATA_STALE_HOURS = 12

/** Column length limit for memo (pos_receive_item.memo = varchar(120)). */
export const MEMO_MAX_LENGTH = 120

/**
 * Prefixes of the two markers this app hides inside existing admin text columns, because it
 * may not add columns of its own. `note` carries the session id and is what makes a re-sent
 * push idempotent; `memo` carries the over-receive flag the admin worklist searches for.
 * Both are parsed again on the way back, here and by the admin team — see src/core/receiving/memo.ts
 * before changing either string.
 */
export const NOTE_SESSION_PREFIX = 'PDT|SESS='
export const MEMO_OVER_PREFIX = 'PDT|OVER'

export const DEVICE_ID_STORAGE_KEY = 'stockops.deviceId'

/** Safe upper bound for ID node to fit in a bigint(20) column. */
export const MAX_BIGINT = 9223372036854775807n
